import { requireSession } from "@/lib/auth";
import { params, runTool, SearchParams, toSheetList } from "@/lib/google";
import { handle } from "@/lib/http";

// Recently modified (optionally only shared with me) spreadsheets, or a name search.
export const GET = handle(async (req) => {
  const s = await requireSession(req, "integrations:google");
  const { q, page, shared } = SearchParams.parse(params(req));
  const data = await runTool(s.user.id, "GOOGLESHEETS_SEARCH_SPREADSHEETS", { query: q || undefined, page_token: page, max_results: 20, shared_with_me: !!shared });
  return Response.json(toSheetList(data));
});
