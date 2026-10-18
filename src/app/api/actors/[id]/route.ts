import { authorize } from "@/lib/auth";
import { deleteActor, renameActor } from "@/lib/actors";
import { handle, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { ActorRename } from "@/lib/schemas";

export const PATCH = handle(async (req, ctx: RouteContext<"/api/actors/[id]">) => {
  await authorize(req, "actors:manage");
  const { id } = await ctx.params;
  const { name } = await parseBody(req, ActorRename);
  const a = await prisma().$transaction((tx) => renameActor(tx, id, name));
  return Response.json({ id: a.id, name: a.name });
});

export const DELETE = handle(async (req, ctx: RouteContext<"/api/actors/[id]">) => {
  await authorize(req, "actors:manage");
  const { id } = await ctx.params;
  await prisma().$transaction((tx) => deleteActor(tx, id));
  return Response.json({ ok: true });
});
