import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleToolkit, googleStatuses } from "./google-toolkits";

const acc = (slug: string, status: string) => ({ toolkit: { slug }, status });

test("googleStatuses: ACTIVE wins, EXPIRED needs reconnect, the rest is none", () => {
  const s = googleStatuses([
    acc("gmail", "EXPIRED"), acc("gmail", "ACTIVE"), // reconnected: old expired row still around
    acc("googlecalendar", "EXPIRED"),
    acc("googledocs", "INITIATED"), acc("googlesheets", "REVOKED"),
    acc("github", "ACTIVE"), acc("googledrive", "ACTIVE"), // not ours
  ]);
  assert.deepEqual(s, { gmail: "connected", googlecalendar: "expired", googledocs: "none", googlesheets: "none" });
});

test("GoogleToolkit rejects unknown slugs", () => {
  assert.equal(GoogleToolkit.safeParse("gmail").success, true);
  assert.equal(GoogleToolkit.safeParse("github").success, false);
});
