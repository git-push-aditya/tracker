import { requireSession } from "@/lib/auth";
import { params, runTool, SearchParams, toDocList } from "@/lib/google";
import { handle } from "@/lib/http";

// Recently modified (optionally only shared with me) docs, or a name search.
export const GET = handle(async (req) => {
  const s = await requireSession(req, "integrations:google");
  const { q, page, shared } = SearchParams.parse(params(req));
  const data = await runTool(s.user.id, "GOOGLEDOCS_SEARCH_DOCUMENTS", { query: q || undefined, page_token: page, max_results: 20, shared_with_me: !!shared, response_detail: "full" });
  return Response.json(toDocList(data));
});
