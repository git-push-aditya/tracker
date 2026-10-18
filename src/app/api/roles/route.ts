import { authorize } from "@/lib/auth";
import { handle, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { roleSelect, toRole } from "@/lib/roles";
import { RoleCreate } from "@/lib/schemas";

export const GET = handle(async (req) => {
  await authorize(req, "roles:read");
  const roles = await prisma().role.findMany({ orderBy: { name: "asc" }, select: roleSelect });
  return Response.json({ roles: roles.map(toRole) });
});

export const POST = handle(async (req) => {
  await authorize(req, "roles:manage");
  const { name, description, permissionKeys } = await parseBody(req, RoleCreate);
  const role = await prisma().role.create({
    data: { name, description, permissions: { create: [...new Set(permissionKeys)].map((key) => ({ permission: { connect: { key } } })) } },
    select: roleSelect,
  });
  return Response.json(toRole(role), { status: 201 });
});
