import { authorize } from "@/lib/auth";
import { taskInclude, toTask } from "@/lib/data-source";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { TaskInput } from "@/lib/schemas";
import { statusToDb } from "@/lib/status";
import { ownerColumns } from "@/lib/actors";
import { logTaskEvents } from "@/lib/task-events";
import { assertDepsExist } from "@/lib/task-deps";

export const POST = handle(async (req) => {
  const session = await authorize(req, "task:create");
  const { dependsOn, start, end, status, ...rest } = await parseBody(req, TaskInput);
  const deps = [...new Set(dependsOn)];
  const task = await prisma().$transaction(async (tx) => {
    if (!(await tx.workstream.findUnique({ where: { id: rest.workstreamId }, select: { id: true } })))
      throw new HttpError(400, "Unknown workstream");
    await assertDepsExist(tx, deps);
    const max = await tx.task.aggregate({ where: { workstreamId: rest.workstreamId }, _max: { position: true } });
    const created = await tx.task.create({
      data: {
        ...rest,
        ...(await ownerColumns(tx, rest.owner)),
        start: new Date(start),
        end: new Date(end),
        status: statusToDb(status),
        position: (max._max.position ?? -1) + 1,
        dependsOn: { createMany: { data: deps.map((dependsOnId) => ({ dependsOnId })) } },
      },
      include: taskInclude,
    });
    if (created.status === "DONE") await logTaskEvents(tx, "COMPLETED", session?.user.username ?? null, [created]);
    return created;
  });
  return Response.json(toTask(task), { status: 201 });
});
