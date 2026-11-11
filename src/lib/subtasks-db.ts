import type { Prisma } from "@/generated/prisma/client";
import { HttpError } from "./http";
import { canHaveChildren, MAX_DEPTH, promoteSlot, rollupProgress } from "./subtasks";
import { statusFromDb } from "./status";

type Tx = Prisma.TransactionClient;
const day = (d: Date) => d.toISOString().slice(0, 10);
const CONFLICT = "Changed by someone else — reload to see their version";

/** Row lock, so concurrent writes on one family are checked one after another. Always lock from the top down. */
export const lockTask = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`;

/** Ids of a task's ancestors, top-level first (empty for a top-level task). */
export async function ancestorIds(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE up AS (
      SELECT p.id, p."parentId", 1 AS lvl FROM "Task" t JOIN "Task" p ON p.id = t."parentId" WHERE t.id = ${id}
      UNION ALL
      SELECT p.id, p."parentId", up.lvl + 1 FROM up JOIN "Task" p ON p.id = up."parentId" WHERE up.lvl <= ${MAX_DEPTH}
    ) SELECT id FROM up ORDER BY lvl DESC`;
  return rows.map((r) => r.id);
}

/** Ids of every task below `id`, at any depth. */
export async function descendantIds(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE down AS (
      SELECT id, 1 AS lvl FROM "Task" WHERE "parentId" = ${id}
      UNION ALL
      SELECT t.id, down.lvl + 1 FROM down JOIN "Task" t ON t."parentId" = down.id WHERE down.lvl <= ${MAX_DEPTH}
    ) SELECT id FROM down`;
  return rows.map((r) => r.id);
}

/** Locks a task and all its ancestors, top first, and returns the ancestor ids. The chain is re-read once locked:
 *  if a promote moved the task meanwhile, this is a 409 rather than a check against the wrong parent. */
export async function lockChain(tx: Tx, id: string) {
  const ups = await ancestorIds(tx, id);
  for (const a of [...ups, id]) await lockTask(tx, a);
  const again = await ancestorIds(tx, id);
  if (again.join() !== ups.join()) throw new HttpError(409, CONFLICT);
  return ups;
}

/** Locks a parent (and its ancestors) and returns what the subtask rules need. `adding`: a new child is about to be
 *  created under it, so it must have room for one more level (R8). */
export async function lockParent(tx: Tx, parentId: string, opts: { adding?: boolean } = {}) {
  const exists = await tx.task.findUnique({ where: { id: parentId }, select: { id: true } });
  if (!exists) throw new HttpError(400, "Unknown parent task");
  const ancestors = await lockChain(tx, parentId);
  const p = await tx.task.findUniqueOrThrow({ where: { id: parentId }, select: { id: true, workstreamId: true, status: true, end: true } });
  if (opts.adding && !canHaveChildren(ancestors.length))
    throw new HttpError(400, `Subtasks can only go ${MAX_DEPTH} levels deep`);
  return { id: p.id, workstreamId: p.workstreamId, status: statusFromDb(p.status), end: day(p.end), ancestors };
}

export async function subtasksOf(tx: Tx, parentId: string) {
  const rows = await tx.task.findMany({ where: { parentId }, select: { status: true, progress: true, end: true } });
  return rows.map((r) => ({ status: statusFromDb(r.status), progress: r.progress, end: day(r.end) }));
}

/** R6: an unfinished child under `parentId` reopens every Done task from there up. Call with the chain already locked. */
export async function reopenAncestors(tx: Tx, parentId: string) {
  const chain = [...(await ancestorIds(tx, parentId)), parentId];
  await tx.task.updateMany({ where: { id: { in: chain }, status: "DONE" }, data: { status: "IN_PROGRESS" } });
}

/** Keeps each stored progress equal to its subtasks' average (R1), from `parentId` up to the top-level task, so a change
 *  deep down reaches every level. A level with no subtasks left is skipped (R7: keeps its last value).
 *  Raw SQL so the derived change doesn't bump updatedAt and 409 someone who is editing that task. */
export async function syncAncestors(tx: Tx, parentId: string | null) {
  if (!parentId) return;
  const chain = [parentId, ...(await ancestorIds(tx, parentId)).reverse()]; // bottom-up: each level reads the one below
  for (const id of chain) {
    const subs = await subtasksOf(tx, id);
    if (!subs.length) continue;
    const p = rollupProgress(subs);
    // a Done task must stay at 100% (DB CHECK): if the average dropped, it is no longer done
    await tx.$executeRaw`UPDATE "Task" SET progress = ${p}, status = CASE WHEN status = 'DONE' AND ${p} < 100 THEN 'IN_PROGRESS'::"TaskStatus" ELSE status END WHERE id = ${id}`;
  }
}

/** Moves a subtask up one level in place, dates and attributes untouched (D3/D4). Under a top-level parent it becomes a
 *  task, slotted by start/end among its workstream's top-level tasks (`skip`: one to ignore, e.g. a parent about to be
 *  deleted); deeper, it becomes the last child of its grandparent. Its own subtasks move with it. The caller holds the
 *  chain lock. With `expectedUpdatedAt`, returns false if the subtask changed meanwhile. */
export async function moveUp(tx: Tx, id: string, opts: { skip?: string; expectedUpdatedAt?: Date } = {}) {
  const cur = await tx.task.findUniqueOrThrow({ where: { id }, select: { workstreamId: true, start: true, end: true, parent: { select: { parentId: true } } } });
  const to = cur.parent?.parentId ?? null;
  let slot: number;
  if (to) {
    const max = await tx.task.aggregate({ where: { parentId: to }, _max: { position: true } });
    slot = (max._max.position ?? -1) + 1;
  } else {
    const top = await tx.task.findMany({ where: { workstreamId: cur.workstreamId, parentId: null, ...(opts.skip && { id: { not: opts.skip } }) }, select: { position: true, start: true, end: true } });
    slot = promoteSlot(top.map((t) => ({ position: t.position, start: day(t.start), end: day(t.end) })), { start: day(cur.start), end: day(cur.end) });
    // raw: a position shift isn't an edit, so it must not bump updatedAt and 409 whoever is editing those tasks
    await tx.$executeRaw`UPDATE "Task" SET position = position + 1 WHERE "workstreamId" = ${cur.workstreamId} AND "parentId" IS NULL AND position >= ${slot}`;
  }
  const { count } = await tx.task.updateMany({ where: { id, ...(opts.expectedUpdatedAt && { updatedAt: opts.expectedUpdatedAt }) }, data: { parentId: to, position: slot } });
  return count > 0;
}
