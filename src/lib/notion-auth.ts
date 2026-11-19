import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { seal, unseal } from "./crypto";
import { HttpError } from "./http";

// OAuth against Notion's hosted MCP server: one Allow click, access to everything the user can see.
// See docs/notion-integration-implementation.md (phase 0 has the confirmed shapes).
export const NOTION_ISSUER = "https://mcp.notion.com";
export const NOTION_RESOURCE = "https://mcp.notion.com/mcp";
const TOKEN_URL = `${NOTION_ISSUER}/token`; // also the advertised revocation endpoint

// Production: our client ID metadata document's URL is the client_id (fixed identity for Enterprise admins).
// Local dev has no public URL, so it uses a one-time dynamic registration kept in NOTION_CLIENT_ID.
export const clientId = (origin: string) => process.env.NOTION_CLIENT_ID || `${origin}/oauth/notion-client.json`;
export const redirectUri = (origin: string) => `${origin}/api/integrations/notion/callback`;

// The in-flight sign-in (CSRF state + PKCE verifier + who started it), sealed into a short-lived httpOnly cookie.
export const PENDING_COOKIE = "notion_oauth";
export const PENDING_TTL_S = 600;
const Pending = z.object({ state: z.string(), verifier: z.string(), userId: z.string(), exp: z.number() });

export function startSignIn(origin: string, userId: string, now = Date.now()) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  const url = new URL(`${NOTION_ISSUER}/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code", client_id: clientId(origin), redirect_uri: redirectUri(origin), state, resource: NOTION_RESOURCE,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  })) url.searchParams.set(k, v);
  return { url: url.toString(), cookie: seal(JSON.stringify({ state, verifier, userId, exp: now + PENDING_TTL_S * 1000 })) };
}

// The pending sign-in, only if the cookie is intact, unexpired, and belongs to this user and this state.
export function checkPending(cookie: string | undefined, state: string | null, userId: string, now = Date.now()) {
  let p;
  try {
    p = Pending.parse(JSON.parse(unseal(cookie ?? "")));
  } catch {
    return null;
  }
  return p.state === state && p.userId === userId && p.exp > now ? p : null;
}

const Token = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  workspace_id: z.string().min(1),
  workspace_name: z.string().nullish(),
  workspace_icon: z.string().nullish(),
});

// The DB row for a token response: tokens sealed, expiry absolute.
export function toConnection(raw: unknown, now = Date.now()) {
  const r = Token.safeParse(raw);
  if (!r.success) throw new HttpError(502, "Unexpected response from Notion");
  const t = r.data;
  return {
    workspaceId: t.workspace_id,
    workspace: t.workspace_name?.trim() || "Notion workspace",
    icon: t.workspace_icon || null,
    accessToken: seal(t.access_token),
    refreshToken: seal(t.refresh_token),
    expiresAt: new Date(now + t.expires_in * 1000),
  };
}

async function tokenRequest(body: Record<string, string>) {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = (json as { error?: string }).error;
    console.error("Notion token endpoint", r.status, error); // never the body: it may hold tokens
    // invalid_grant = the grant is gone (revoked, 180 days old, or a rotated token replayed): final, never retry
    if (error === "invalid_grant") throw new HttpError(409, "Reconnect this Notion workspace in Settings", "NOTION_RECONNECT");
    throw new HttpError(502, "Notion sign-in failed");
  }
  return json;
}

const Refreshed = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive() });

// New sealed tokens for a refresh token. Notion rotates the refresh token every time, so the caller must save both
// atomically (see freshToken in notion.ts, which holds a row lock).
export async function refreshTokens(origin: string, sealedRefresh: string, now = Date.now()) {
  const r = Refreshed.safeParse(await tokenRequest({ grant_type: "refresh_token", refresh_token: unseal(sealedRefresh), client_id: clientId(origin), resource: NOTION_RESOURCE }));
  if (!r.success) throw new HttpError(502, "Unexpected response from Notion");
  return { accessToken: seal(r.data.access_token), refreshToken: seal(r.data.refresh_token), expiresAt: new Date(now + r.data.expires_in * 1000) };
}

// Refresh a minute early so a token never expires mid-request.
export const needsRefresh = (expiresAt: Date, now = Date.now()) => expiresAt.getTime() - now < 60_000;

export const exchangeCode = (origin: string, code: string, verifier: string) =>
  tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri(origin), client_id: clientId(origin), resource: NOTION_RESOURCE });

// Best effort: Notion answered 200 and refused the token straight after in the phase 0 spike.
// Never throws: a disconnect must still delete our row (even if the key changed and the token can't be unsealed).
export async function revoke(origin: string, sealedRefresh: string) {
  try {
    await tokenRequest({ token: unseal(sealedRefresh), token_type_hint: "refresh_token", client_id: clientId(origin) });
  } catch {}
}
