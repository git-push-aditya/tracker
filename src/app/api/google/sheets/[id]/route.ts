import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { GoogleId, params, runTool, toValues } from "@/lib/google";
import { handle } from "@/lib/http";

// A1 range, optionally sheet-qualified ("Sheet1!A1:F20"). Default: top-left of the first sheet.
const Range = z.object({ range: z.string().max(100).regex(/^[^\n\r]+$/).default("A1:Z50") });

export const GET = handle(async (req, ctx: RouteContext<"/api/google/sheets/[id]">) => {
  const s = await requireSession(req, "integrations:google");
  const spreadsheet_id = GoogleId.parse((await ctx.params).id);
  const { range } = Range.parse(params(req));
  return Response.json(toValues(await runTool(s.user.id, "GOOGLESHEETS_VALUES_GET", { spreadsheet_id, range })));
});
