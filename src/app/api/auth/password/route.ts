import { authorize, hashPassword, verifyPassword } from "@/lib/auth";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { PasswordChange } from "@/lib/schemas";

export const PATCH = handle(async (req) => {
  const s = (await authorize(req, null, { allowMustChange: true }))!;
  const { currentPassword, newPassword } = await parseBody(req, PasswordChange);
  const db = prisma();
  const user = await db.user.findUniqueOrThrow({ where: { id: s.user.id } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new HttpError(400, "Current password is incorrect");
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } }),
    db.session.deleteMany({ where: { userId: user.id, id: { not: s.sessionId } } }),
  ]);
  return Response.json({ ok: true });
});
