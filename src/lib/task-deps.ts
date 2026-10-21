import type { Prisma } from "@/generated/prisma/client";
import { HttpError } from "./http";

export async function assertDepsExist(tx: Prisma.TransactionClient, ids: string[]) {
  if (!ids.length) return;
  // subtasks can't be depended on (only top-level tasks), so they count as unknown
  if ((await tx.task.count({ where: { id: { in: ids }, parentId: null } })) !== ids.length) throw new HttpError(400, "Unknown dependency");
}
