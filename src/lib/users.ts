import type { Prisma } from "@/generated/prisma/client";

export const userSelect = {
  id: true, username: true, isActive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true,
  role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect; // never passwordHash

export const toUser = (u: Prisma.UserGetPayload<{ select: typeof userSelect }>) => ({
  id: u.id, username: u.username, isActive: u.isActive, mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
  role: u.role,
});
