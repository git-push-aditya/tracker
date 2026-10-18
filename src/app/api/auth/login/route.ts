import { assertSameOrigin, clientIp, createSession, DUMMY_HASH, verifyPassword } from "@/lib/auth";
import { isRateLimited, LOGIN_WINDOW_MS } from "@/lib/auth-rules";
import { isDemoMode } from "@/lib/data-source";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { LoginInput } from "@/lib/schemas";

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  if (isDemoMode()) throw new HttpError(503, "Demo mode: no login");
  const { username, password } = await parseBody(req, LoginInput);
  const db = prisma();
  const key = `${username}|${clientIp(req)}`;

  const now = Date.now();
  await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now - LOGIN_WINDOW_MS) } } });
  const failures = await db.loginAttempt.count({ where: { key } });
  if (isRateLimited(failures)) throw new HttpError(429, "Too many attempts, try again in 15 minutes");

  const user = await db.user.findUnique({ where: { username } });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.isActive || !ok) {
    await db.loginAttempt.create({ data: { key } });
    throw new HttpError(401, "Invalid username or password");
  }

  await db.loginAttempt.deleteMany({ where: { key } });
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }); // lazy cleanup
  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(now) } });
  return Response.json({ mustChangePassword: user.mustChangePassword });
});
