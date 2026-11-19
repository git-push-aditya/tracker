import { authorize } from "@/lib/auth";
import { resolveMany, actorKey } from "@/lib/actors";
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
  const { workstreams, people: extraPeople, history } = (() => {
    try {
      return normalizeImport(raw);
    } catch (e) {
      throw e instanceof ImportError ? new HttpError(400, e.message) : e;
    }
  })();

  // every task at every depth, with its parent and its position among its siblings
  type T = (typeof workstreams)[number]["tasks"][number];
  type Flat = { w: (typeof workstreams)[number]; t: T; position: number; parentId: string | null; depth: number };
  const walk = (w: Flat["w"], list: T[], parentId: string | null, depth: number): Flat[] =>
    list.flatMap((t, position) => [{ w, t, position, parentId, depth }, ...walk(w, t.subtasks ?? [], t.id, depth + 1)]);
  const flat = workstreams.flatMap((w) => walk(w, w.tasks, null, 0));

  await prisma().$transaction(
    async (tx) => {
      // tasks that the import doesn't bring back count as deleted (a re-import of an export keeps its ids, so those don't)
      const keep = new Set(flat.map((f) => f.t.id));
      const old = await tx.task.findMany({ select: { id: true, name: true, owner: true, ownerId: true, workstreamId: true, parentId: true } });
      await logTaskEvents(tx, "DELETED", session?.user.username ?? null, old.filter((t) => !keep.has(t.id)), "Removed by import");
      await tx.workstream.deleteMany(); // cascades tasks and dependencies
      // owners in the file become actors (find-or-create), so an import can't reintroduce duplicate spellings
      // plus the file's people list, so owners with no work yet survive a restore
      const people = await resolveMany(tx, [...extraPeople, ...workstreams.map((w) => w.owner), ...flat.map((f) => f.t.owner)]);
      const who = (name: string) => { const a = people.get(actorKey(name)); return { owner: a?.name ?? "", ownerId: a?.id ?? null }; };
      await tx.workstream.createMany({
        data: workstreams.map((w, position) => ({ id: w.id, name: w.name, color: w.color, ...who(w.owner), goal: w.goal, position, createdAt: w.createdAt })),
      });
      const row = ({ w, t, position, parentId }: Flat) => ({
        id: t.id, workstreamId: w.id, parentId, name: t.name, ...who(t.owner),
        start: new Date(t.start), end: new Date(t.end), progress: t.progress,
        status: statusToDb(t.status), isMilestone: t.isMilestone, description: t.description, position, createdAt: t.createdAt,
      });
      // one level at a time, so each subtask's parent already exists (the FK)
      for (let depth = 0; flat.some((f) => f.depth === depth); depth++)
        await tx.task.createMany({ data: flat.filter((f) => f.depth === depth).map(row) });
      await tx.taskDependency.createMany({
        data: flat.flatMap(({ t }) => t.dependsOn.map((dependsOnId) => ({ taskId: t.id, dependsOnId }))),
      });
      // History is an audit trail: merged, never replaced. Rows already here (same id) are left alone, so
      // re-importing a backup doesn't duplicate it. Owners link to an existing person by name, else none.
      await tx.taskEvent.createMany({
        data: history.map((e) => ({ ...e, at: new Date(e.at), ownerId: people.get(actorKey(e.owner))?.id ?? null })),
        skipDuplicates: true,
      });
    },
    { timeout: 30000 },
  );
  return Response.json({ ok: true, workstreams: workstreams.length, tasks: flat.length, history: history.length });
});
