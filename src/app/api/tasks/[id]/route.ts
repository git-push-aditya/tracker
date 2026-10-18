import { authorize } from "@/lib/auth";
import { taskInclude, toTask } from "@/lib/data-source";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { TaskUpdate } from "@/lib/schemas";
import { statusToDb } from "@/lib/status";
import { ownerColumns } from "@/lib/actors";
import { logTaskEvents } from "@/lib/task-events";
import { assertDepsExist } from "@/lib/task-deps";

export const PUT = handle(async (req, ctx: RouteContext<"/api/tasks/[id]">) => {
  const session = await authorize(req, "task:update");
  const { id } = await ctx.params;
  const { expectedUpdatedAt, dependsOn, start, end, status, ...rest } = await parseBody(req, TaskUpdate);
  const deps = [...new Set(dependsOn)];
  if (deps.includes(id)) throw new HttpError(400, "A task can't depend on itself");

  const task = await prisma().$transaction(async (tx) => {
    const current = await tx.task.findUnique({ where: { id }, select: { workstreamId: true, status: true } });
    if (!current) throw new HttpError(404, "Task not found");
    if (!(await tx.workstream.findUnique({ where: { id: rest.workstreamId }, select: { id: true } })))
      throw new HttpError(400, "Unknown workstream");
    await assertDepsExist(tx, deps);

    const owner = await ownerColumns(tx, rest.owner);
    const moved = current.workstreamId !== rest.workstreamId; // moving → end of the target workstream
    const max = moved ? await tx.task.aggregate({ where: { workstreamId: rest.workstreamId }, _max: { position: true } }) : null;
    const { count } = await tx.task.updateMany({
      where: { id, updatedAt: new Date(expectedUpdatedAt) },
      data: {
        ...rest,
        ...owner,
        start: new Date(start),
        end: new Date(end),
        status: statusToDb(status),
        ...(max && { position: (max._max.position ?? -1) + 1 }),
      },
    });
    if (!count) throw new HttpError(409, "Changed by someone else — reload to see their version");

    await tx.taskDependency.deleteMany({ where: { taskId: id } });
    await tx.taskDependency.createMany({ data: deps.map((dependsOnId) => ({ taskId: id, dependsOnId })) });
    const updated = await tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
    if (updated.status === "DONE" && current.status !== "DONE") await logTaskEvents(tx, "COMPLETED", session?.user.username ?? null, [updated]);
    return updated;
  });
  return Response.json(toTask(task));
});

export const DELETE = handle(async (req, ctx: RouteContext<"/api/tasks/[id]">) => {
  const session = await authorize(req, "task:delete");
  const { id } = await ctx.params;
  await prisma().$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id }, select: { id: true, name: true, owner: true, ownerId: true, workstreamId: true } });
    if (!task) throw new HttpError(404, "Task not found");
    await logTaskEvents(tx, "DELETED", session?.user.username ?? null, [task]);
    await tx.task.delete({ where: { id } }); // deps cascade
  });
  return Response.json({ ok: true });
});
