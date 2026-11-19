import { requireSession } from "@/lib/auth";
import { GoogleId, runTool, toDoc } from "@/lib/google";
import { handle } from "@/lib/http";

export const GET = handle(async (req, ctx: RouteContext<"/api/google/docs/[id]">) => {
  const s = await requireSession(req, "integrations:google");
  const document_id = GoogleId.parse((await ctx.params).id);
  return Response.json(toDoc(await runTool(s.user.id, "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT", { document_id })));
});
