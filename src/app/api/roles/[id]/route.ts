import { authorize } from "@/lib/auth";
import { handle, HttpError, parseBody } from "@/lib/http";
import { ALL_PERMISSION_KEYS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { roleSelect, toRole } from "@/lib/roles";
import { RolePatch } from "@/lib/schemas";

export const PATCH = handle(async (req, ctx: RouteContext<"/api/roles/[id]">) => {
  await authorize(req, "roles:manage");
  const { id } = await ctx.params;
  const body = await parseBody(req, RolePatch);
  const db = prisma();
  const role = await db.role.findUnique({ where: { id } });
  if (!role) throw new HttpError(404, "Role not found");
  if (role.isSystem && body.name !== undefined && body.name !== role.name) throw new HttpError(409, "System role names are locked");
  const keys = body.permissionKeys && [...new Set(body.permissionKeys)];
  if (role.name === "admin" && keys && keys.length !== ALL_PERMISSION_KEYS.length)
    throw new HttpError(409, "The admin role always has every permission");

  const updated = await db.$transaction(async (tx) => {
    await tx.role.update({ where: { id }, data: { name: body.name, description: body.description } });
    if (keys) {
      const perms = await tx.permission.findMany({ where: { key: { in: keys } } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) });
    }
    return tx.role.findUniqueOrThrow({ where: { id }, select: roleSelect });
  });
  return Response.json(toRole(updated));
});

export const DELETE = handle(async (req, ctx: RouteContext<"/api/roles/[id]">) => {
  await authorize(req, "roles:manage");
  const { id } = await ctx.params;
  const db = prisma();
  const role = await db.role.findUnique({ where: { id }, select: { isSystem: true, _count: { select: { users: true } } } });
  if (!role) throw new HttpError(404, "Role not found");
  if (role.isSystem) throw new HttpError(409, "System roles can't be deleted");
  if (role._count.users) throw new HttpError(409, "Role is still assigned to users");
  await db.role.delete({ where: { id } });
  return Response.json({ ok: true });
});
