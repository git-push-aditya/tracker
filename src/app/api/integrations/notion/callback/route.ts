import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handle, HttpError } from "@/lib/http";
import { checkPending, exchangeCode, NOTION_ISSUER, PENDING_COOKIE, toConnection } from "@/lib/notion-auth";

// Notion redirects here after Allow. This GET writes data, so the CSRF defence is the state (bound to this user, in
// our sealed httpOnly cookie) plus PKCE, not authorize()'s same-origin check (which only covers non-GET requests).
// Always ends on Settings: ?connected=notion (a hint; Settings re-checks) or ?notion_error=<code>.
export const GET = handle(async (req) => {
  // A browser landing here signed out (session expired during the Allow screen) goes to the login page, not raw JSON
  const s = await requireSession(req, "integrations:notion").catch((e) => {
    if (e instanceof HttpError && e.status === 401) return null;
    throw e;
  });
  if (!s) return NextResponse.redirect(new URL("/login", req.nextUrl.origin), 303);
  const q = req.nextUrl.searchParams;
  const back = (param: string, value: string) => {
    const res = NextResponse.redirect(new URL(`/v2/settings?${param}=${value}`, req.nextUrl.origin), 303);
    res.cookies.delete({ name: PENDING_COOKIE, path: "/api/integrations/notion" });
    return res;
  };
  const pending = checkPending(req.cookies.get(PENDING_COOKIE)?.value, q.get("state"), s.user.id);
  if (!pending) return back("notion_error", "expired");
  // Notion's own error codes (cancelled, guest, workspace admin hasn't approved us) map to messages in Settings
  const error = q.get("error");
  if (error) return back("notion_error", error === "access_denied" ? "denied" : "refused");
  const code = q.get("code");
  if (!code || (q.has("iss") && q.get("iss") !== NOTION_ISSUER)) return back("notion_error", "failed");
  try {
    const row = toConnection(await exchangeCode(req.nextUrl.origin, code, pending.verifier));
    await prisma().notionConnection.upsert({
      where: { userId_workspaceId: { userId: s.user.id, workspaceId: row.workspaceId } },
      create: { userId: s.user.id, ...row },
      update: row, // reconnecting the same workspace: fresh tokens, keeps its place in the list
    });
  } catch (e) {
    console.error("Notion connect failed", e instanceof HttpError ? e.status : e instanceof Error ? e.name : "error"); // never the message: it may echo token data
    return back("notion_error", "failed");
  }
  return back("connected", "notion");
});
