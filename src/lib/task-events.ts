import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;
// parentId: set for a subtask, so its entry says whose it was. note: extra text for this one row.
type Snap = { id: string; name: string; owner: string; ownerId?: string | null; workstreamId: string; parentId?: string | null; note?: string };

// Writes into TaskEvent from inside the same transaction as the change, so the log can't drift from the data.
export async function logTaskEvents(
  tx: Tx, type: "COMPLETED" | "DELETED", actor: string | null, tasks: Snap[], note = "",
) {
  if (!tasks.length) return;
  const names = new Map((await tx.workstream.findMany({ where: { id: { in: [...new Set(tasks.map((t) => t.workstreamId))] } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]));
  const parents = new Map((await tx.task.findMany({ where: { id: { in: [...new Set(tasks.flatMap((t) => (t.parentId ? [t.parentId] : [])))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const noteOf = (t: Snap) => [t.parentId && parents.has(t.parentId) ? `Subtask of "${parents.get(t.parentId)}"` : "", t.note ?? "", note].filter(Boolean).join(" · ");
  await tx.taskEvent.createMany({
    data: tasks.map((t) => ({
      type, actor, note: noteOf(t), taskId: t.id, taskName: t.name, owner: t.owner, ownerId: t.ownerId ?? null,
      workstreamId: t.workstreamId, workstreamName: names.get(t.workstreamId) ?? t.workstreamId,
    })),
  });
}
