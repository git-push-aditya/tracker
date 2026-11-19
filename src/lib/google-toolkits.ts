import { z } from "zod";

// Client-safe (no Composio SDK import), shared by the API and Settings.
// No googledrive: Docs and Sheets have their own search tools, and Drive would add a consent screen and a restricted scope.
export const GOOGLE_TOOLKITS = ["gmail", "googlecalendar", "googledocs", "googlesheets"] as const;
export const GoogleToolkit = z.enum(GOOGLE_TOOLKITS);
export type GoogleToolkit = z.infer<typeof GoogleToolkit>;
export type GoogleStatus = "connected" | "expired" | "none";

export const GOOGLE_LABELS: Record<GoogleToolkit, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googledocs: "Google Docs",
  googlesheets: "Google Sheets",
};

// ACTIVE wins; EXPIRED means "reconnect"; anything else (half-finished, failed, revoked) counts as not connected.
export function googleStatuses(accounts: { toolkit: { slug: string }; status: string }[]): Record<GoogleToolkit, GoogleStatus> {
  const out = Object.fromEntries(GOOGLE_TOOLKITS.map((t) => [t, "none"])) as Record<GoogleToolkit, GoogleStatus>;
  for (const a of accounts) {
    const t = a.toolkit.slug as GoogleToolkit;
    if (!(t in out)) continue;
    if (a.status === "ACTIVE") out[t] = "connected";
    else if (a.status === "EXPIRED" && out[t] === "none") out[t] = "expired";
  }
  return out;
}
