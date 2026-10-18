import { authorize } from "@/lib/auth";
import { mergeActors } from "@/lib/actors";
import { handle, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { ActorMerge } from "@/lib/schemas";

export const POST = handle(async (req, ctx: RouteContext<"/api/actors/[id]/merge">) => {
  await authorize(req, "actors:manage");
  const { id } = await ctx.params;
  const { intoId } = await parseBody(req, ActorMerge);
  const into = await prisma().$transaction((tx) => mergeActors(tx, id, intoId));
  return Response.json({ id: into.id, name: into.name });
});
