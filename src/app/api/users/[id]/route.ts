import { authorize, hashPassword, serializable } from "@/lib/auth";
import { checkUserChange } from "@/lib/auth-rules";
import { handle, HttpError, parseBody } from "@/lib/http";
import { UserPatch } from "@/lib/schemas";
import { toUser, userSelect } from "@/lib/users";

const REFUSALS = {
  SELF_DELETE: "You can't delete or deactivate yourself",
  LAST_ADMIN: "There must always be at least one active admin",
} as const;

// Admin count + guard + change run in one Serializable transaction, so two admins
// demoting each other at the same moment can't leave zero admins.

export const PATCH = handle(async (req, ctx: RouteContext<"/api/users/[id]">) => {
  const actor = (await authorize(req, "users:manage"))!;
  const { id } = await ctx.params;
  const body = await parseBody(req, UserPatch);
  const passwordHash = body.password ? await hashPassword(body.password) : undefined;

  const user = await serializable(async (tx) => {
    const target = await tx.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw new HttpError(404, "User not found");
    const newRole = body.roleId ? await tx.role.findUnique({ where: { id: body.roleId } }) : null;
    if (body.roleId && !newRole) throw new HttpError(400, "Unknown role");
    const verdict = checkUserChange({
      actorId: actor.user.id,
      target: { id, isActive: target.isActive, isAdmin: target.role.name === "admin" },
      change: { type: "update", isActive: body.isActive, isAdmin: newRole ? newRole.name === "admin" : undefined },
      activeAdminCount: await tx.user.count({ where: { isActive: true, role: { name: "admin" } } }),
    });
    if (verdict !== "ok") throw new HttpError(409, REFUSALS[verdict], verdict);

    await tx.session.deleteMany({ where: { userId: id } }); // any change ends the target's sessions
    return tx.user.update({
      where: { id },
      data: {
        roleId: body.roleId,
        isActive: body.isActive,
        ...(passwordHash && { passwordHash, mustChangePassword: true }),
      },
      select: userSelect,
    });
  });
  return Response.json(toUser(user));
});

export const DELETE = handle(async (req, ctx: RouteContext<"/api/users/[id]">) => {
  const actor = (await authorize(req, "users:manage"))!;
  const { id } = await ctx.params;
  await serializable(async (tx) => {
    const target = await tx.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw new HttpError(404, "User not found");
    const verdict = checkUserChange({
      actorId: actor.user.id,
      target: { id, isActive: target.isActive, isAdmin: target.role.name === "admin" },
      change: { type: "delete" },
      activeAdminCount: await tx.user.count({ where: { isActive: true, role: { name: "admin" } } }),
    });
    if (verdict !== "ok") throw new HttpError(409, REFUSALS[verdict], verdict);
    await tx.user.delete({ where: { id } }); // sessions cascade
  });
  return Response.json({ ok: true });
});
