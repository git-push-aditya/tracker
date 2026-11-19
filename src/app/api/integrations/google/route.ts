import { requireSession } from "@/lib/auth";
import { userAccounts } from "@/lib/composio";
import { forgetSession } from "@/lib/google";
import { GOOGLE_TOOLKITS, googleStatuses } from "@/lib/google-toolkits";
import { handle } from "@/lib/http";

// The signed-in user's connection status per Google toolkit.
export const GET = handle(async (req) => {
  const s = await requireSession(req, "integrations:google");
  forgetSession(s.user.id); // Settings polls this after an OAuth return: pick up new connections on the next call
  return Response.json(googleStatuses(await userAccounts(s.user.id, GOOGLE_TOOLKITS)));
});
