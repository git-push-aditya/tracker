import assert from "node:assert/strict";
import { test } from "node:test";
import { toDay } from "@/lib/date";
import type { Task, Workstream } from "@/lib/schemas";
import { attentionRows } from "@/lib/attention";

const t = (id: string, end: string, status: Task["status"] = "In progress"): Task =>
  ({ id, name: id, owner: "", start: "2026-10-01", end, progress: 0, status, isMilestone: false, dependsOn: [], description: "" });
const wss: Workstream[] = [{ id: "w", name: "W", color: "#000000", owner: "", goal: "", tasks: [t("late", "2026-10-20"), t("today", "2026-10-22"), t("soon", "2026-10-23"), t("risk", "2026-11-30", "At risk")] }];
const today = toDay("2026-10-22");

test("due-date filter can be switched off so only status filters apply", () => {
  const ids = (statuses: Task["status"][], days: number) => attentionRows(wss, today, statuses, days).map((r) => r.t.id).sort();
  assert.deepEqual(ids(["Delayed"], 0), ["late"]); // overdue only
  assert.deepEqual(ids(["Delayed"], 2), ["late", "soon", "today"]); // with "due in 2 days" the due-soon ones join in
  assert.deepEqual(ids([], 0), []);
  assert.deepEqual(ids([], 1), ["soon", "today"]); // due date alone: today and tomorrow
});
