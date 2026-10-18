import { authorize } from "@/lib/auth";
import { isDemoMode } from "@/lib/data-source";
import { handle } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req) => {
  await authorize(req, "dashboard:read");
  if (isDemoMode()) return Response.json({ actors: [] });
  const actors = await prisma().actor.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { tasks: true, workstreams: true } } } });
  return Response.json({ actors: actors.map((a) => ({ id: a.id, name: a.name, taskCount: a._count.tasks, workstreamCount: a._count.workstreams })) });
});
