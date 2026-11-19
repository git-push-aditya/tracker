import { requireSession } from "@/lib/auth";
import { handle, HttpError, parseBody } from "@/lib/http";
import { createArgs, NewPage, notionTool, toCreated } from "@/lib/notion";
import { takeQuota } from "@/lib/quota";

// Create a page in the user's Notion: private by default, or under a page they picked. POST, so authorize() already
// blocks cross-origin requests. Never retried: if the response is lost the page may still exist.
export const POST = handle(async (req) => {
  const s = await requireSession(req, "integrations:notion");
  const body = await parseBody(req, NewPage);
  takeQuota(`notion-create:${s.user.id}`, 30, "Page creation");
  try {
    return Response.json(toCreated(await notionTool(s.user.id, body.ws, req.nextUrl.origin, "notion-create-pages", createArgs(body))));
  } catch (e) {
    if (e instanceof HttpError && e.code === "NOTION_UNAVAILABLE")
      throw new HttpError(502, "Couldn't confirm the page was created. Check Notion before trying again.");
    throw e;
  }
});
