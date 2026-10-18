import { authorize } from "@/lib/auth";
import { handle, HttpError } from "@/lib/http";
import { ImportError, normalizeImport } from "@/lib/import";
import { prisma } from "@/lib/prisma";
import { logTaskEvents } from "@/lib/task-events";
import { statusToDb } from "@/lib/status";

export const POST = handle(async (req) => {
  const session = await authorize(req, "data:import");
  const raw = await req.json().catch(() => {
    throw new HttpError(400, "Body must be valid JSON");
  });
  const { workstreams } = (() => {
    try {
      return normalizeImport(raw);
    } catch (e) {
      throw e instanceof ImportError ? new HttpError(400, e.message) : e;
    }
  })();

  await prisma().$transaction(
    async (tx) => {
      // tasks that the import doesn't bring back count as deleted (a re-import of an export keeps its ids, so those don't)
      const keep = new Set(workstreams.flatMap((w) => w.tasks.map((t) => t.id)));
      const old = await tx.task.findMany({ select: { id: true, name: true, owner: true, workstreamId: true } });
      await logTaskEvents(tx, "DELETED", session?.user.username ?? null, old.filter((t) => !keep.has(t.id)), "Removed by import");
      await tx.workstream.deleteMany(); // cascades tasks and dependencies
      await tx.workstream.createMany({
        data: workstreams.map((w, position) => ({ id: w.id, name: w.name, color: w.color, owner: w.owner, goal: w.goal, position })),
      });
      const tasks = workstreams.flatMap((w) => w.tasks.map((t, position) => ({ w, t, position })));
      await tx.task.createMany({
        data: tasks.map(({ w, t, position }) => ({
          id: t.id, workstreamId: w.id, name: t.name, owner: t.owner,
          start: new Date(t.start), end: new Date(t.end), progress: t.progress,
          status: statusToDb(t.status), isMilestone: t.isMilestone, description: t.description, position,
        })),
      });
      await tx.taskDependency.createMany({
        data: tasks.flatMap(({ t }) => t.dependsOn.map((dependsOnId) => ({ taskId: t.id, dependsOnId }))),
      });
    },
    { timeout: 20000 },
  );
  return Response.json({ ok: true, workstreams: workstreams.length, tasks: workstreams.reduce((n, w) => n + w.tasks.length, 0) });
});
