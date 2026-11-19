import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { seal, unseal } from "./crypto";
import { checkPending, startSignIn, toConnection } from "./notion-auth";

// Both are read at call time, not import time
process.env.NOTION_TOKEN_KEY = randomBytes(32).toString("base64");
delete process.env.NOTION_CLIENT_ID;

test("seal/unseal round-trips; tampering and a wrong key are rejected", () => {
  const s = seal("secret-token");
  assert.notEqual(s, seal("secret-token")); // fresh IV each time
  assert.equal(unseal(s), "secret-token");
  const [iv, tag, data] = s.split(".");
  const flipped = Buffer.from(data, "base64url"); flipped[0] ^= 1;
  assert.throws(() => unseal([iv, tag, flipped.toString("base64url")].join(".")));
  assert.throws(() => unseal(s, randomBytes(32).toString("base64")));
  assert.throws(() => seal("x", "too-short"), /isn't configured/);
});

test("startSignIn builds a PKCE URL with our metadata-document client_id; checkPending binds state, user and expiry", () => {
  const now = 1_000_000;
  const { url, cookie } = startSignIn("https://pc.example", "u1", now);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://mcp.notion.com/authorize");
  assert.equal(u.searchParams.get("client_id"), "https://pc.example/oauth/notion-client.json");
  assert.equal(u.searchParams.get("redirect_uri"), "https://pc.example/api/integrations/notion/callback");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("resource"), "https://mcp.notion.com/mcp");
  const state = u.searchParams.get("state");
  assert.ok(checkPending(cookie, state, "u1", now + 1000)?.verifier);
  assert.equal(checkPending(cookie, "other-state", "u1", now), null);
  assert.equal(checkPending(cookie, state, "someone-else", now), null);
  assert.equal(checkPending(cookie, state, "u1", now + 601_000), null);
  assert.equal(checkPending("garbage", state, "u1", now), null);
  assert.equal(checkPending(undefined, state, "u1", now), null);
});

test("toConnection seals tokens and stores an absolute expiry; bad shapes are a 502", () => {
  const row = toConnection({ access_token: "a", refresh_token: "r", expires_in: 28800, token_type: "bearer", workspace_id: "w1", workspace_name: " Acme ", workspace_icon: null }, 0);
  assert.deepEqual({ ...row, accessToken: unseal(row.accessToken), refreshToken: unseal(row.refreshToken) },
    { workspaceId: "w1", workspace: "Acme", icon: null, accessToken: "a", refreshToken: "r", expiresAt: new Date(28_800_000) });
  assert.equal(toConnection({ access_token: "a", refresh_token: "r", expires_in: 1, workspace_id: "w" }).workspace, "Notion workspace");
  assert.throws(() => toConnection({ access_token: "a" }), (e: { status?: number }) => e.status === 502);
});
