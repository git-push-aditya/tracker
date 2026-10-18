// Pure guard logic (no DB access) so it can be unit-tested; route handlers stay thin.
import type { PermissionKey } from "./permissions";

export const MAX_FAILED_LOGINS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const can = (permissions: readonly string[], key: PermissionKey) => permissions.includes(key);

export const isRateLimited = (failureCount: number) => failureCount >= MAX_FAILED_LOGINS;

export type UserChange =
  | { type: "delete" }
  | { type: "update"; isActive?: boolean; isAdmin?: boolean }; // isAdmin = role after the change

export type Verdict = "ok" | "SELF_DELETE" | "LAST_ADMIN";

export function checkUserChange(a: {
  actorId: string;
  target: { id: string; isActive: boolean; isAdmin: boolean };
  change: UserChange;
  activeAdminCount: number;
}): Verdict {
  const { actorId, target, change, activeAdminCount } = a;
  const deactivates = change.type === "delete" || change.isActive === false;
  if (target.id === actorId && deactivates) return "SELF_DELETE";
  const losesAdmin = deactivates || (change.type === "update" && change.isAdmin === false);
  if (target.isAdmin && target.isActive && losesAdmin && activeAdminCount <= 1) return "LAST_ADMIN";
  return "ok";
}
