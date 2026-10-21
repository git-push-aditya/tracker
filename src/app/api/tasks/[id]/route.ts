import { authorize } from "@/lib/auth";
import { taskInclude, toTask } from "@/lib/data-source";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { TaskUpdate } from "@/lib/schemas";
import { statusToDb } from "@/lib/status";
import { parentChangeError, reopensParent, rollupProgress, subtaskChangeError } from "@/lib/subtasks";
import { detachSubtask, lockParent, lockTask, subtasksOf, syncParentProgress } from "@/lib/subtasks-db";
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
    const current = await tx.task.findUnique({ where: { id }, select: { workstreamId: true, status: true, parentId: true } });
    if (!current) throw new HttpError(404, "Task not found");

    // subtask rules (parent is locked before the child, always)
    let progress = rest.progress;
    if (current.parentId) {
      if (rest.workstreamId !== current.workstreamId) throw new HttpError(400, "Move the parent task instead");
      if (deps.length) throw new HttpError(400, "A subtask can't have dependencies");
      const parent = await lockParent(tx, current.parentId);
      const err = subtaskChangeError(parent, { end });
      if (err) throw new HttpError(400, err);
      if (reopensParent(parent.status, status)) await tx.task.update({ where: { id: parent.id }, data: { status: "IN_PROGRESS" } });
    }
    await lockTask(tx, id);
    const subs = await subtasksOf(tx, id);
    if (subs.length) {
      const err = parentChangeError(subs, { status, end });
      if (err) throw new HttpError(400, err);
      progress = rollupProgress(subs); // R1: not editable while it has subtasks
    }
    if (!(await tx.workstream.findUnique({ where: { id: rest.workstreamId }, select: { id: true } })))
      throw new HttpError(400, "Unknown workstream");
    await assertDepsExist(tx, deps);

    const owner = await ownerColumns(tx, rest.owner);
    const moved = current.workstreamId !== rest.workstreamId; // moving → end of the target workstream
    const max = moved ? await tx.task.aggregate({ where: { workstreamId: rest.workstreamId, parentId: null }, _max: { position: true } }) : null;
    const { count } = await tx.task.updateMany({
      where: { id, updatedAt: new Date(expectedUpdatedAt) },
      data: {
        ...rest,
        progress,
        ...owner,
        start: new Date(start),
        end: new Date(end),
        status: statusToDb(status),
        ...(max && { position: (max._max.position ?? -1) + 1 }),
      },
    });
    if (!count) throw new HttpError(409, "Changed by someone else — reload to see their version");

    if (moved && subs.length) await tx.task.updateMany({ where: { parentId: id }, data: { workstreamId: rest.workstreamId } });
    await syncParentProgress(tx, current.parentId);
    await tx.taskDependency.deleteMany({ where: { taskId: id } });
    await tx.taskDependency.createMany({ data: deps.map((dependsOnId) => ({ taskId: id, dependsOnId })) });
    const updated = await tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
    if (updated.status === "DONE" && current.status !== "DONE") await logTaskEvents(tx, "COMPLETED", session?.user.username ?? null, [updated]);
    return updated;
  });
  return Response.json(toTask(task));
});

// DELETE /api/tasks/:id[?subtasks=keep]  A parent's subtasks are deleted with it, or with ?subtasks=keep they become
// standalone tasks (dates and details unchanged, slotted by date) before the parent goes.
export const DELETE = handle(async (req, ctx: RouteContext<"/api/tasks/[id]">) => {
  const session = await authorize(req, "task:delete");
  const { id } = await ctx.params;
  const keep = req.nextUrl.searchParams.get("subtasks") === "keep";
  await prisma().$transaction(async (tx) => {
    const snap = { id: true, name: true, owner: true, ownerId: true, workstreamId: true, parentId: true } as const;
    const task = await tx.task.findUnique({ where: { id }, select: snap });
    if (!task) throw new HttpError(404, "Task not found");
    if (task.parentId) await lockParent(tx, task.parentId);
    await lockTask(tx, id);
    const subs = await tx.task.findMany({ where: { parentId: id }, select: snap, orderBy: [{ start: "asc" }, { end: "asc" }, { position: "asc" }] });
    const actor = session?.user.username ?? null;
    if (keep && subs.length) {
      await logTaskEvents(tx, "DELETED", actor, [task], "Subtasks kept as tasks");
      for (const s of subs) await detachSubtask(tx, s.id, { skip: id });
    } else {
      await logTaskEvents(tx, "DELETED", actor, [task, ...subs.map((s) => ({ ...s, note: "deleted with its parent" }))]);
    }
    await tx.task.delete({ where: { id } }); // deps cascade; subtasks too unless detached above
    await syncParentProgress(tx, task.parentId);
  });
  return Response.json({ ok: true });
});
