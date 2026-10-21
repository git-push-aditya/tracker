import type { Prisma } from "@/generated/prisma/client";
import { HttpError } from "./http";
import { promoteSlot, rollupProgress } from "./subtasks";
import { statusFromDb } from "./status";

type Tx = Prisma.TransactionClient;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Row lock, so concurrent writes on one parent's family are checked one after another. Always lock parent before child. */
export const lockTask = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`;

/** Locks and returns a task that can take subtasks (exists, isn't itself a subtask). */
export async function lockParent(tx: Tx, parentId: string) {
  await lockTask(tx, parentId);
  const p = await tx.task.findUnique({ where: { id: parentId }, select: { id: true, workstreamId: true, status: true, end: true, parentId: true } });
  if (!p) throw new HttpError(400, "Unknown parent task");
  if (p.parentId) throw new HttpError(400, "A subtask can't have subtasks");
  return { id: p.id, workstreamId: p.workstreamId, status: statusFromDb(p.status), end: day(p.end) };
}

export async function subtasksOf(tx: Tx, parentId: string) {
  const rows = await tx.task.findMany({ where: { parentId }, select: { status: true, progress: true, end: true } });
  return rows.map((r) => ({ status: statusFromDb(r.status), progress: r.progress, end: day(r.end) }));
}

/** Keeps the parent's stored progress equal to its subtasks' average (R1). No-op once it has none (R7: keeps the last value).
 *  Raw SQL so the derived change doesn't bump updatedAt and 409 someone who is editing the parent. */
export async function syncParentProgress(tx: Tx, parentId: string | null) {
  if (!parentId) return;
  const subs = await subtasksOf(tx, parentId);
  if (!subs.length) return;
  const p = rollupProgress(subs);
  // a Done parent must stay at 100% (DB CHECK): if the average dropped, it is no longer done
  await tx.$executeRaw`UPDATE "Task" SET progress = ${p}, status = CASE WHEN status = 'DONE' AND ${p} < 100 THEN 'IN_PROGRESS'::"TaskStatus" ELSE status END WHERE id = ${parentId}`;
}

/** Turns a subtask into a top-level task in place: dates and attributes untouched, slotted by start/end among its
 *  workstream's top-level tasks (`skip`: one to ignore, e.g. a parent about to be deleted). The caller holds the parent lock.
 *  With `expectedUpdatedAt`, returns false if the subtask changed meanwhile. */
export async function detachSubtask(tx: Tx, id: string, opts: { skip?: string; expectedUpdatedAt?: Date } = {}) {
  const cur = await tx.task.findUniqueOrThrow({ where: { id }, select: { workstreamId: true, start: true, end: true } });
  const top = await tx.task.findMany({ where: { workstreamId: cur.workstreamId, parentId: null, ...(opts.skip && { id: { not: opts.skip } }) }, select: { position: true, start: true, end: true } });
  const slot = promoteSlot(top.map((t) => ({ position: t.position, start: day(t.start), end: day(t.end) })), { start: day(cur.start), end: day(cur.end) });
  // raw: a position shift isn't an edit, so it must not bump updatedAt and 409 whoever is editing those tasks
  await tx.$executeRaw`UPDATE "Task" SET position = position + 1 WHERE "workstreamId" = ${cur.workstreamId} AND "parentId" IS NULL AND position >= ${slot}`;
  const { count } = await tx.task.updateMany({ where: { id, ...(opts.expectedUpdatedAt && { updatedAt: opts.expectedUpdatedAt }) }, data: { parentId: null, position: slot } });
  return count > 0;
}
