import type { Prisma } from "@/generated/prisma/client";

export const roleSelect = {
  id: true, name: true, description: true, isSystem: true,
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleSelect;

export const toRole = (r: Prisma.RoleGetPayload<{ select: typeof roleSelect }>) => ({
  id: r.id, name: r.name, description: r.description, isSystem: r.isSystem,
  permissionKeys: r.permissions.map((p) => p.permission.key).sort(),
  userCount: r._count.users,
});
