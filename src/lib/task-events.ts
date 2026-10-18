import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;
type Snap = { id: string; name: string; owner: string; workstreamId: string };

// Writes into TaskEvent from inside the same transaction as the change, so the log can't drift from the data.
export async function logTaskEvents(
  tx: Tx, type: "COMPLETED" | "DELETED", actor: string | null, tasks: Snap[], note = "",
) {
  if (!tasks.length) return;
  const names = new Map((await tx.workstream.findMany({ where: { id: { in: [...new Set(tasks.map((t) => t.workstreamId))] } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]));
  await tx.taskEvent.createMany({
    data: tasks.map((t) => ({
      type, actor, note, taskId: t.id, taskName: t.name, owner: t.owner,
      workstreamId: t.workstreamId, workstreamName: names.get(t.workstreamId) ?? t.workstreamId,
    })),
  });
}
