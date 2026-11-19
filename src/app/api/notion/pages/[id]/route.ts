import { requireSession } from "@/lib/auth";
import { handle } from "@/lib/http";
import { NotionId, notionTool, toPage } from "@/lib/notion";

// One page as markdown (Notion's <content> part), plus title, icon and link.
export const GET = handle(async (req, ctx: RouteContext<"/api/notion/pages/[id]">) => {
  const s = await requireSession(req, "integrations:notion");
  const id = NotionId.parse((await ctx.params).id);
  const ws = req.nextUrl.searchParams.get("ws")?.slice(0, 40) || undefined;
  return Response.json(toPage(await notionTool(s.user.id, ws, req.nextUrl.origin, "notion-fetch", { id })));
});
