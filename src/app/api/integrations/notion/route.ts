import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/http";
import { PENDING_COOKIE, PENDING_TTL_S, startSignIn } from "@/lib/notion-auth";

// This user's connected Notion workspaces, oldest first: the first one is the default.
export const GET = handle(async (req) => {
  const s = await requireSession(req, "integrations:notion");
  const rows = await prisma().notionConnection.findMany({
    where: { userId: s.user.id }, orderBy: { createdAt: "asc" }, select: { id: true, workspace: true, icon: true },
  });
  return Response.json(rows);
});

// Start connecting a workspace (or another one): returns Notion's sign-in URL. Connecting a workspace that is
// already connected just refreshes its tokens in the callback.
export const POST = handle(async (req) => {
  const s = await requireSession(req, "integrations:notion");
  const { url, cookie } = startSignIn(req.nextUrl.origin, s.user.id);
  const res = NextResponse.json({ redirectUrl: url });
  res.cookies.set(PENDING_COOKIE, cookie, {
    httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", maxAge: PENDING_TTL_S, path: "/api/integrations/notion",
  });
  return res;
});
