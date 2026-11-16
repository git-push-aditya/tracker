import { authorize } from "@/lib/auth";
import { taskInclude, toTask } from "@/lib/data-source";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { lockChain, moveUp, syncAncestors } from "@/lib/subtasks-db";
import { z } from "zod";

const Body = z.object({ expectedUpdatedAt: z.iso.datetime() });

// Moves a subtask up one level in place: same row, dates and attributes untouched. Under a top-level parent it becomes
// a task slotted by start/end date; deeper it becomes a subtask of its grandparent. Its own subtasks go with it.
export const POST = handle(async (req, ctx: RouteContext<"/api/tasks/[id]/promote">) => {
  await authorize(req, "task:update");
  const { id } = await ctx.params;
  const { expectedUpdatedAt } = await parseBody(req, Body);

  const task = await prisma().$transaction(async (tx) => {
    const current = await tx.task.findUnique({ where: { id }, select: { parentId: true } });
    if (!current?.parentId) throw new HttpError(404, "Subtask not found");
    await lockChain(tx, id);

    if (!(await moveUp(tx, id, { expectedUpdatedAt: new Date(expectedUpdatedAt) }))) throw new HttpError(409, "Changed by someone else — reload to see their version");
    await syncAncestors(tx, current.parentId); // the old parent, then up through the new one
    return tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
  });
  return Response.json(toTask(task));
});
