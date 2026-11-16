import { requireSession } from "@/lib/auth";
import { userAccounts } from "@/lib/composio";
import { GOOGLE_TOOLKITS, googleStatuses } from "@/lib/google-toolkits";
import { handle } from "@/lib/http";

// The signed-in user's connection status per Google toolkit.
export const GET = handle(async (req) => {
  const s = await requireSession(req, "integrations:google");
  return Response.json(googleStatuses(await userAccounts(s.user.id, GOOGLE_TOOLKITS)));
});
