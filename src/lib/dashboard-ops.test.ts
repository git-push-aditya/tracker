import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTask, removeTask, removeWorkstream, upsertTask, upsertWorkstream } from "./dashboard-ops";
import type { Task, Workstream } from "./schemas";

const t = (id: string, dependsOn: string[] = []): Task =>
  ({ id, name: id, owner: "", start: "2026-01-01", end: "2026-01-02", progress: 0, status: "Not started", isMilestone: false, dependsOn, description: "" });
const ws = (id: string, tasks: Task[]): Workstream => ({ id, name: id, color: "#2a78d6", owner: "", goal: "", tasks });
const form = { id: "", name: "x", owner: " o ", start: "2026-02-01", end: "2026-02-05", status: "In progress", progress: "40", isMilestone: false, dependsOn: [], description: "" };

test("buildTask validates and normalises", () => {
  assert.deepEqual(buildTask({ ...form, name: " " }), { error: "Please give the task a name." });
  assert.deepEqual(buildTask({ ...form, end: "" }), { error: "Please enter valid dates." });
  assert.deepEqual(buildTask({ ...form, end: "2026-01-01" }), { error: "End date must be on or after the start date." });
  const done = buildTask({ ...form, status: "Done", progress: "3" });
  assert.ok("task" in done && done.task.progress === 100 && done.task.owner === "o");
  const ms = buildTask({ ...form, isMilestone: true, start: "garbage" }); // start is ignored for milestones
  assert.ok("task" in ms && ms.task.start === "2026-02-05");
  const clamp = buildTask({ ...form, progress: "999" });
  assert.ok("task" in clamp && clamp.task.progress === 100);
});

test("upsertTask replaces in place or moves to the end of the target", () => {
  const wss = [ws("a", [t("1"), t("2")]), ws("b", [t("3")])];
  const edited = { ...t("1"), name: "new" };
  assert.deepEqual(upsertTask(wss, edited, "a")[0].tasks.map((x) => x.name), ["new", "2"]);
  const moved = upsertTask(wss, edited, "b");
  assert.deepEqual([moved[0].tasks.map((x) => x.id), moved[1].tasks.map((x) => x.id)], [["2"], ["3", "1"]]);
  assert.deepEqual(upsertTask(wss, t("9"), "b")[1].tasks.map((x) => x.id), ["3", "9"]); // new task
});

test("deleting clears dependencies", () => {
  const wss = [ws("a", [t("1"), t("2", ["1"])]), ws("b", [t("3", ["1", "2"])])];
  assert.deepEqual(removeTask(wss, "1")[1].tasks[0].dependsOn, ["2"]);
  assert.deepEqual(removeWorkstream(wss, "a")[0].tasks[0].dependsOn, []);
  assert.equal(removeWorkstream(wss, "a").length, 1);
});

test("upsertWorkstream", () => {
  const v = { name: "n", owner: "", goal: "", color: "#000000" };
  const added = upsertWorkstream([ws("a", [])], v);
  assert.ok(added.length === 2 && added[1].tasks.length === 0 && added[1].id.startsWith("ws"));
  assert.equal(upsertWorkstream(added, { ...v, name: "z" }, "a")[0].name, "z");
});
