import { authorize } from "@/lib/auth";
import { taskInclude, toTask } from "@/lib/data-source";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { TaskInput } from "@/lib/schemas";
import { statusToDb } from "@/lib/status";
import { reopensParent, subtaskChangeError } from "@/lib/subtasks";
import { lockParent, syncParentProgress } from "@/lib/subtasks-db";
import { ownerColumns } from "@/lib/actors";
import { logTaskEvents } from "@/lib/task-events";
import { assertDepsExist } from "@/lib/task-deps";

export const POST = handle(async (req) => {
  const session = await authorize(req, "task:create");
  const { dependsOn, start, end, status, parentId, ...rest } = await parseBody(req, TaskInput);
  const deps = [...new Set(dependsOn)];
  const task = await prisma().$transaction(async (tx) => {
    if (parentId) {
      if (deps.length) throw new HttpError(400, "A subtask can't have dependencies");
      const parent = await lockParent(tx, parentId);
      const err = subtaskChangeError(parent, { end });
      if (err) throw new HttpError(400, err);
      rest.workstreamId = parent.workstreamId; // a subtask lives in its parent's workstream
      if (reopensParent(parent.status, status)) await tx.task.update({ where: { id: parentId }, data: { status: "IN_PROGRESS" } });
    }
    if (!(await tx.workstream.findUnique({ where: { id: rest.workstreamId }, select: { id: true } })))
      throw new HttpError(400, "Unknown workstream");
    await assertDepsExist(tx, deps);
    // position: among the workstream's tasks, or among this parent's subtasks
    const max = await tx.task.aggregate({ where: { workstreamId: rest.workstreamId, parentId: parentId ?? null }, _max: { position: true } });
    const created = await tx.task.create({
      data: {
        ...rest,
        parentId: parentId ?? null,
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
    await syncParentProgress(tx, parentId ?? null);
    return created;
  });
  return Response.json(toTask(task), { status: 201 });
});
