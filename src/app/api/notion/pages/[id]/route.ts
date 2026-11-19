import { requireSession } from "@/lib/auth";
import { handle, HttpError, parseBody } from "@/lib/http";
import { EditPage, NotionId, notionTool, renameArgs, replaceArgs, toPage } from "@/lib/notion";
import { takeQuota } from "@/lib/quota";

// One page as markdown (Notion's <content> part), plus title, icon and link.
export const GET = handle(async (req, ctx: RouteContext<"/api/notion/pages/[id]">) => {
  const s = await requireSession(req, "integrations:notion");
  const id = NotionId.parse((await ctx.params).id);
  const ws = req.nextUrl.searchParams.get("ws")?.slice(0, 40) || undefined;
  return Response.json(toPage(await notionTool(s.user.id, ws, req.nextUrl.origin, "notion-fetch", { id })));
});

// Save an edited title and/or body. Refuses (409) if the page changed in Notion after the editor opened, so nobody's
// newer edits are overwritten. Only sends what changed. Notion itself refuses a body that would delete child pages.
export const PATCH = handle(async (req, ctx: RouteContext<"/api/notion/pages/[id]">) => {
  const s = await requireSession(req, "integrations:notion");
  const id = NotionId.parse((await ctx.params).id);
  const body = await parseBody(req, EditPage);
  takeQuota(`notion-edit:${s.user.id}`, 60, "Page edit");
  const run = (name: string, args: Record<string, unknown>) => notionTool(s.user.id, body.ws, req.nextUrl.origin, name, args);
  const cur = toPage(await run("notion-fetch", { id }));
  if (cur.kind !== "page") throw new HttpError(400, "Only pages can be edited here");
  if (cur.edited !== body.loadedAt)
    throw new HttpError(409, "This page changed in Notion after you opened it. Copy your text, reload the page, and edit again.", "NOTION_PAGE_CHANGED");
  const changed: string[] = [];
  if (body.title !== cur.title) { await run("notion-update-page", renameArgs(id, body.title)); changed.push("title"); }
  if (body.markdown.trim() !== cur.markdown) { await run("notion-update-page", replaceArgs(id, body.markdown)); changed.push("content"); }
  return Response.json({ changed });
});
