import { authorize } from "@/lib/auth";
import { toWorkstream, workstreamInclude } from "@/lib/data-source";
import { ownerColumns } from "@/lib/actors";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { logTaskEvents } from "@/lib/task-events";
import { WorkstreamUpdate } from "@/lib/schemas";

export const PUT = handle(async (req, ctx: RouteContext<"/api/workstreams/[id]">) => {
  await authorize(req, "workstream:update");
  const { id } = await ctx.params;
  const { expectedUpdatedAt, ...data } = await parseBody(req, WorkstreamUpdate);
  const db = prisma();
  const { count } = await db.workstream.updateMany({ where: { id, updatedAt: new Date(expectedUpdatedAt) }, data: { ...data, ...(await ownerColumns(db, data.owner)) } });
  if (!count) {
    if (!(await db.workstream.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, "Workstream not found");
    throw new HttpError(409, "Changed by someone else — reload to see their version");
  }
  return Response.json(toWorkstream(await db.workstream.findUniqueOrThrow({ where: { id }, include: workstreamInclude })));
});

export const DELETE = handle(async (req, ctx: RouteContext<"/api/workstreams/[id]">) => {
  const session = await authorize(req, "workstream:delete");
  const { id } = await ctx.params;
  await prisma().$transaction(async (tx) => {
    const ws = await tx.workstream.findUnique({ where: { id }, select: { id: true, tasks: { select: { id: true, name: true, owner: true, ownerId: true, workstreamId: true } } } });
    if (!ws) throw new HttpError(404, "Workstream not found");
    await logTaskEvents(tx, "DELETED", session?.user.username ?? null, ws.tasks, "Workstream deleted");
    await tx.workstream.delete({ where: { id } }); // tasks + deps cascade
  });
  return Response.json({ ok: true });
});
