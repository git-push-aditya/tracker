import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { cache } from "react";
import { Prisma } from "@/generated/prisma/client";
import { can } from "./auth-rules";
import { isDemoMode } from "./data-source";
import { HttpError, isConnectionError } from "./http";
import type { PermissionKey } from "./permissions";
import { prisma } from "./prisma";

export const COOKIE = "pc_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
// Fixed hash so unknown usernames still cost one bcrypt compare (no timing oracle).
export const DUMMY_HASH = "$2b$12$fiwIZdeRZWLcD8IZPmU20O4e1cKbomtDmFCX9R/Y0DlqjxlZfgL9q";

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type Session = {
  sessionId: string;
  user: { id: string; username: string; role: string; mustChangePassword: boolean };
  permissions: string[];
};

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await prisma().session.create({ data: { tokenHash: sha256(token), userId, expiresAt } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

// One query: cookie → session + user + role + permission keys. Cached per request.
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await prisma().session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } } } },
  });
  if (!s) return null;
  if (s.expiresAt <= new Date()) {
    await prisma().session.delete({ where: { id: s.id } }).catch(() => {}); // lazy cleanup
    return null;
  }
  if (!s.user.isActive) return null;
  return {
    sessionId: s.id,
    user: { id: s.user.id, username: s.user.username, role: s.user.role.name, mustChangePassword: s.user.mustChangePassword },
    permissions: s.user.role.permissions.map((rp) => rp.permission.key),
  };
});

export function assertSameOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let ok = false;
  try {
    ok = !!host && new URL(req.headers.get("origin") ?? "").host === host;
  } catch {}
  if (!ok) throw new HttpError(403, "Cross-origin request blocked");
}

export const clientIp = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

// Call at the top of every route handler.
//   key = null → any logged-in user. In demo mode only dashboard:read is served (no session); everything else is 503.
export async function authorize(
  req: NextRequest,
  key: PermissionKey | null,
  opts: { allowMustChange?: boolean } = {},
): Promise<Session | null> {
  if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
  if (isDemoMode()) {
    if (key === "dashboard:read") return null;
    throw new HttpError(503, "Demo mode: not available");
  }
  const session = await getSession();
  if (!session) throw new HttpError(401, "Not signed in");
  if (session.user.mustChangePassword && !opts.allowMustChange)
    throw new HttpError(403, "Password change required", "PASSWORD_CHANGE_REQUIRED");
  if (key && !can(session.permissions, key)) throw new HttpError(403, "Forbidden");
  return session;
}

// authorize() for routes that always have a session (never dashboard:read)
export async function requireSession(req: NextRequest, key: PermissionKey | null, opts?: { allowMustChange?: boolean }) {
  return (await authorize(req, key, opts))!;
}

// Serializable transaction, retried once on a serialization conflict (P2034).
export async function serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma().$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      if (attempt || (e as { code?: string }).code !== "P2034") throw e;
    }
  }
}

// For pages: the session, null when signed out, or "down" when the DB can't be reached
// (retried once, which covers a transient connection failure). Pages show a Retry panel for "down".
export async function sessionOrDown(): Promise<Session | null | "down"> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getSession();
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      if (attempt) return "down";
    }
  }
}

// Shape returned by GET /api/auth/me and prefetched into the client cache
export const meResponse = (s: Session) => ({ user: s.user, permissions: s.permissions });
