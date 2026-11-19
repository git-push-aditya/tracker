import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { handle } from "@/lib/http";
import { FOLDERS, notionTool, toList, toSearch } from "@/lib/notion";

const Params = z.object({
  ws: z.string().max(40).optional(), // a NotionConnection id; unknown or missing = the default workspace
  folder: z.enum(Object.keys(FOLDERS) as [keyof typeof FOLDERS]).default("recent"),
  q: z.string().trim().max(200).default(""),
  cursor: z.string().max(2000).optional(),
});

// A folder (recent / private / shared / favorites), or a title and content search when q is set.
// Search needs a non-empty query on Free and Plus plans, so browsing goes through the folders.
export const GET = handle(async (req) => {
  const s = await requireSession(req, "integrations:notion");
  const p = Params.parse(Object.fromEntries(req.nextUrl.searchParams));
  const run = (name: string, args: Record<string, unknown>) => notionTool(s.user.id, p.ws, req.nextUrl.origin, name, args);
  if (p.q) return Response.json(toSearch(await run("notion-search", { query: p.q, query_type: "internal", page_size: 25 })));
  return Response.json(toList(await run(FOLDERS[p.folder], { limit: 50, ...(p.cursor && { cursor: p.cursor }) })));
});
