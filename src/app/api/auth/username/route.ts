import { authorize, verifyPassword } from "@/lib/auth";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { UsernameChange } from "@/lib/schemas";

// Used by /v2 settings. A taken name surfaces as 409 via handle() (Prisma P2002).
export const PATCH = handle(async (req) => {
  const s = (await authorize(req, null))!;
  const { currentPassword, username } = await parseBody(req, UsernameChange);
  const db = prisma();
  const user = await db.user.findUniqueOrThrow({ where: { id: s.user.id } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new HttpError(400, "Current password is incorrect");
  await db.user.update({ where: { id: user.id }, data: { username } });
  return Response.json({ username });
});
