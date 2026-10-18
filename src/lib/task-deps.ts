import type { Prisma } from "@/generated/prisma/client";
import { HttpError } from "./http";

export async function assertDepsExist(tx: Prisma.TransactionClient, ids: string[]) {
  if (!ids.length) return;
  if ((await tx.task.count({ where: { id: { in: ids } } })) !== ids.length) throw new HttpError(400, "Unknown dependency");
}
