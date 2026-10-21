import assert from "node:assert/strict";
import { test } from "node:test";
import { toDay } from "./date";
import { arrowPath, headerTiers, layoutGantt, timeRange } from "./gantt-layout";

const d = (s: string) => toDay(s);

test("header tiers per zoom", () => {
  const start = d("2026-08-01"), end = d("2026-11-01");
  const q = headerTiers(d("2026-07-01"), d("2027-01-01"), "quarter");
  assert.deepEqual(q.top.map((c) => c.l), ["Q3 2026", "Q4 2026"]);
  assert.deepEqual(q.bot.map((c) => c.l), ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  const w = headerTiers(start, end, "week");
  assert.equal(w.bot.length, end - start);
  assert.deepEqual(w.bot.slice(0, 3).map((c) => [c.l, !!c.we]), [["1", true], ["2", true], ["3", false]]); // 1 Aug 2026 is a Saturday
  const m = headerTiers(start, end, "month"); // 1 Aug 2026 = Saturday → blank lead cell, then Mondays
  assert.deepEqual([m.bot[0].l, m.bot[1].l, m.bot[2].l], ["", "3", "10"]);
  assert.equal(m.bot.at(-1)!.e, end); // last week cell clipped to the range
});

test("time range spans whole calendar years around the data and today", () => {
  const r = timeRange([{ start: "2026-09-10", end: "2026-10-20" }], d("2027-02-02"));
  assert.equal(r.start, d("2025-01-01")); // 1 year before the earliest year (2026)
  assert.equal(r.end, d("2029-01-01")); // 2 years past the latest year (2027)
});

test("arrow path: both shapes", () => {
  assert.equal(arrowPath({ xe: 100, y: 22 }, { xs: 200, y: 66 }), "M100 22 H108 V66 H198"); // room: simple elbow
  assert.equal(arrowPath({ xe: 100, y: 22 }, { xs: 105, y: 66 }), "M100 22 H108 V44 H93 V66 H103"); // overlap, dependent below
  assert.equal(arrowPath({ xe: 100, y: 66 }, { xs: 105, y: 22 }), "M100 66 H108 V44 H93 V22 H103"); // overlap, dependent above
});

test("layout rows, collapse and arrows", () => {
  const t = (id: string, start: string, end: string, dependsOn: string[] = []) =>
    ({ id, name: id, owner: "", start, end, progress: 50, status: "In progress" as const, isMilestone: false, dependsOn, description: "" });
  const ws = [{ id: "w", name: "W", color: "#2a78d6", owner: "", goal: "", tasks: [t("a", "2026-09-01", "2026-09-10"), t("b", "2026-09-20", "2026-09-30", ["a"])] }];
  const open = layoutGantt({ workstreams: ws, zoom: "month", today: d("2026-09-15"), collapsed: [] });
  assert.equal(open.rows.length, 3);
  assert.equal(open.height, 40 + 44 * 2);
  assert.equal(open.paths.length, 1);
  const closed = layoutGantt({ workstreams: ws, zoom: "month", today: d("2026-09-15"), collapsed: ["w"] });
  assert.deepEqual([closed.rows.length, closed.height, closed.paths.length], [1, 40, 0]);
});
