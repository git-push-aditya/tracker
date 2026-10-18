import { authorize, hashPassword } from "@/lib/auth";
import { handle, HttpError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { toUser, userSelect } from "@/lib/users";
import { UserCreate } from "@/lib/schemas";

export const GET = handle(async (req) => {
  await authorize(req, "users:read");
  const users = await prisma().user.findMany({ orderBy: { username: "asc" }, select: userSelect });
  return Response.json({ users: users.map(toUser) });
});

export const POST = handle(async (req) => {
  await authorize(req, "users:manage");
  const { username, password, roleId, isActive } = await parseBody(req, UserCreate);
  const db = prisma();
  if (!(await db.role.findUnique({ where: { id: roleId }, select: { id: true } }))) throw new HttpError(400, "Unknown role");
  const user = await db.user.create({
    data: { username, passwordHash: await hashPassword(password), roleId, isActive, mustChangePassword: true },
    select: userSelect,
  });
  return Response.json(toUser(user), { status: 201 });
});
