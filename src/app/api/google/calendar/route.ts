import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { params, runTool, toEvents } from "@/lib/google";
import { handle } from "@/lib/http";

const DAY = 864e5;
const Range = z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() });

// Primary calendar, recurring events expanded. Default window: now → 14 days.
export const GET = handle(async (req) => {
  const s = await requireSession(req, "integrations:google");
  const r = Range.parse(params(req));
  const timeMin = r.from ?? new Date().toISOString();
  const timeMax = r.to ?? new Date(Date.parse(timeMin) + 14 * DAY).toISOString();
  const data = await runTool(s.user.id, "GOOGLECALENDAR_EVENTS_LIST", {
    timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 100,
  });
  return Response.json(toEvents(data));
});
