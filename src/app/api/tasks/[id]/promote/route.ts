import { authorize } from "@/lib/auth";
import { taskInclude, toTask } from "@/lib/data-source";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { detachSubtask, lockParent, syncParentProgress } from "@/lib/subtasks-db";
import { z } from "zod";

const Body = z.object({ expectedUpdatedAt: z.iso.datetime() });

// Turns a subtask into a top-level task in place: same row, dates and attributes untouched, slotted by start/end date.
export const POST = handle(async (req, ctx: RouteContext<"/api/tasks/[id]/promote">) => {
  await authorize(req, "task:update");
  const { id } = await ctx.params;
  const { expectedUpdatedAt } = await parseBody(req, Body);

  const task = await prisma().$transaction(async (tx) => {
    const current = await tx.task.findUnique({ where: { id }, select: { parentId: true } });
    if (!current?.parentId) throw new HttpError(404, "Subtask not found");
    await lockParent(tx, current.parentId);

    if (!(await detachSubtask(tx, id, { expectedUpdatedAt: new Date(expectedUpdatedAt) }))) throw new HttpError(409, "Changed by someone else — reload to see their version");
    await syncParentProgress(tx, current.parentId);
    return tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
  });
  return Response.json(toTask(task));
});
