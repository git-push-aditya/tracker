import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req) => {
  await authorize(req, "roles:read");
  const permissions = await prisma().permission.findMany({ orderBy: { key: "asc" }, select: { key: true, description: true } });
  return Response.json({ permissions });
});
