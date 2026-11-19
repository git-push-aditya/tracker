import { requireSession } from "@/lib/auth";
import { composio, removeAccount, userAccounts } from "@/lib/composio";
import { forgetSession } from "@/lib/google";
import { GoogleToolkit } from "@/lib/google-toolkits";
import { handle, HttpError } from "@/lib/http";

// Start connecting: returns Composio's hosted sign-in URL. Keeps at most one account per toolkit per user.
export const POST = handle(async (req, ctx: RouteContext<"/api/integrations/google/[toolkit]">) => {
  const s = await requireSession(req, "integrations:google");
  const toolkit = GoogleToolkit.parse((await ctx.params).toolkit);
  forgetSession(s.user.id); // its connections are about to change
  const accounts = await userAccounts(s.user.id, [toolkit]);
  if (accounts.some((a) => a.status === "ACTIVE")) throw new HttpError(409, "Already connected");
  await Promise.all(accounts.map((a) => removeAccount(a.id))); // stale expired / half-finished attempts
  // Built on the server, never taken from the request body. The query param is only a hint: Settings re-checks via GET.
  const callbackUrl = new URL(`/v2/settings?connected=${toolkit}`, req.nextUrl.origin).toString();
  const session = await composio().create(s.user.id, { toolkits: [toolkit] });
  const { redirectUrl } = await session.authorize(toolkit, { callbackUrl });
  if (!redirectUrl) throw new HttpError(502, "Google sign-in link unavailable");
  return Response.json({ redirectUrl });
});

// Disconnect: deletes this user's accounts for the toolkit (filtered by our userId, so never someone else's).
export const DELETE = handle(async (req, ctx: RouteContext<"/api/integrations/google/[toolkit]">) => {
  const s = await requireSession(req, "integrations:google");
  const toolkit = GoogleToolkit.parse((await ctx.params).toolkit);
  forgetSession(s.user.id); // its connections are about to change
  const accounts = await userAccounts(s.user.id, [toolkit]);
  await Promise.all(accounts.map((a) => removeAccount(a.id)));
  return Response.json({ ok: true });
});
