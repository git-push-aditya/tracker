import { Composio } from "@composio/core";
import type { GoogleToolkit } from "./google-toolkits";
import { HttpError } from "./http";

// Composio holds each user's Google tokens; its userId is our User.id. See docs/google-integration-implementation.md.
let client: Composio | undefined;
export function composio() {
  if (!process.env.COMPOSIO_API_KEY) throw new HttpError(503, "Google integration isn't configured");
  // The SDK reads COMPOSIO_API_KEY itself. No usage analytics, no "upgrade available" log on every cold start.
  return (client ??= new Composio({ allowTracking: false, disableVersionCheck: true }));
}

// All of one user's connected accounts for the given toolkits (any status). A handful per user, so one page is plenty.
export async function userAccounts(userId: string, toolkits: readonly GoogleToolkit[]) {
  const r = await composio().connectedAccounts.list({ userIds: [userId], toolkitSlugs: [...toolkits], limit: 100 });
  return r.items;
}

// Disconnect: revoke the Google grant (best effort; not every toolkit supports it), then remove the account from Composio.
export async function removeAccount(id: string) {
  await composio().connectedAccounts.revoke(id).catch(() => {});
  await composio().connectedAccounts.delete(id);
}
