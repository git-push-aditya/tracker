import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handle, HttpError } from "@/lib/http";
import { revoke } from "@/lib/notion-auth";

// Disconnect one workspace: revoke at Notion (best effort), then delete the row. Scoped to this user's rows.
export const DELETE = handle(async (req, ctx: RouteContext<"/api/integrations/notion/[id]">) => {
  const s = await requireSession(req, "integrations:notion");
  const row = await prisma().notionConnection.findFirst({ where: { id: (await ctx.params).id, userId: s.user.id } });
  if (!row) throw new HttpError(404, "Not found");
  await revoke(req.nextUrl.origin, row.refreshToken);
  await prisma().notionConnection.delete({ where: { id: row.id } });
  return Response.json({ ok: true });
});
