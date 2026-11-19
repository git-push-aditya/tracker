import { HttpError } from "./http";

// Per-user caps on outward actions (sending mail, creating Notion pages), counted over the last hour.
// ponytail: per-process memory, so each server instance counts on its own; move to the DB (like LoginAttempt) if abuse matters.
const HOUR = 3_600_000, hits = new Map<string, number[]>();
export function takeQuota(key: string, cap: number, what: string, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= cap) throw new HttpError(429, `${what} limit reached (${cap} per hour), try again later`);
  hits.set(key, [...recent, now]);
}
