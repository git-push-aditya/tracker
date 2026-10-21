import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task, Workstream } from "./schemas";
import { searchTasks } from "./task-search";

const t = (id: string, name: string, owner = "", description = ""): Task =>
  ({ id, name, owner, start: "2026-01-01", end: "2026-01-02", progress: 0, status: "Not started", isMilestone: false, dependsOn: [], description });
const wss: Workstream[] = [
  { id: "a", name: "Hiring", color: "#000000", owner: "", goal: "", tasks: [t("1", "Plan", "rohan"), t("2", "Offer letters", "", "send the plan")] },
  { id: "b", name: "Plan B", color: "#000000", owner: "", goal: "", tasks: [t("3", "Roadmap", "plan-owner"), t("4", "Launch plan")] },
];

test("ranks name > description > workstream > owner", () => {
  const r = searchTasks(wss, "plan").map((x) => [x.t.id, x.field]);
  assert.deepEqual(r, [["1", "name"], ["4", "name"], ["2", "description"], ["3", "workstream"]]);
  assert.deepEqual(searchTasks(wss, "ROHAN").map((x) => x.field), ["owner"]);
  assert.deepEqual(searchTasks(wss, "  "), []);
});

test("subtasks are searchable and carry their own fields", () => {
  const w: Workstream[] = [{ ...wss[0], tasks: [{ ...t("p", "Launch"), subtasks: [{ ...t("s", "Write copy", "asha") }] }] }];
  assert.deepEqual(searchTasks(w, "copy").map((h) => h.t.id), ["s"]);
  assert.deepEqual(searchTasks(w, "asha").map((h) => h.t.id), ["s"]);
});
