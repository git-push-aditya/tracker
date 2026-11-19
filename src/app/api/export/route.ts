import { authorize } from "@/lib/auth";
import { getDashboard, isDemoMode } from "@/lib/data-source";
import { handle, HttpError } from "@/lib/http";
import { EXPORT_FORMAT } from "@/lib/import";
import { prisma } from "@/lib/prisma";

type Node = { id: string; updatedAt?: string; subtasks?: Node[] };

// Everything POST /api/import can restore: workstreams with every task level, dependencies and descriptions,
// all people (owners), the history log, and created dates. Accounts and roles are left out on purpose:
// they hold password hashes and are managed per environment.
export const GET = handle(async (req) => {
  await authorize(req, "dashboard:read");
  if (isDemoMode()) throw new HttpError(404, "Demo mode exports from the browser");
  const db = prisma();
  const [{ workstreams }, wsRows, taskRows, actors, events] = await Promise.all([
    getDashboard(),
    db.workstream.findMany({ select: { id: true, createdAt: true } }),
    db.task.findMany({ select: { id: true, createdAt: true } }),
    db.actor.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    db.taskEvent.findMany({ orderBy: [{ at: "asc" }, { id: "asc" }], omit: { ownerId: true } }), // ids differ per DB; import re-links by name
  ]);
  const created = new Map([...wsRows, ...taskRows].map((r) => [r.id, r.createdAt.toISOString()]));
  // updatedAt is an edit-conflict token, meaningless in another database (undefined drops it from the JSON)
  const clean = (n: Node): object => ({ ...n, updatedAt: undefined, createdAt: created.get(n.id), subtasks: n.subtasks?.map(clean) });
  return Response.json({
    ...EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    workstreams: workstreams.map((w) => ({ ...clean(w), tasks: w.tasks.map(clean) })),
    people: actors.map((a) => a.name),
    history: events,
  });
});
