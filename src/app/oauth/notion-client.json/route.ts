import { clientId, redirectUri } from "@/lib/notion-auth";
import { handle } from "@/lib/http";

// OAuth client ID metadata document: its own URL is our Notion client_id, so Notion (and Enterprise admins approving
// us) always see the same app. Public on purpose; holds no secrets.
export const GET = handle(async (req) => {
  const origin = req.nextUrl.origin;
  return Response.json({
    client_id: clientId(origin),
    client_name: "Prime Care Tracker",
    client_uri: origin,
    redirect_uris: [redirectUri(origin)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});
