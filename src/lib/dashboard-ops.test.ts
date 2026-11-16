import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTask, promoteSubtask, removeTask, removeWorkstream, upsertSubtask, upsertTask, upsertWorkstream } from "./dashboard-ops";
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

const sub = (id: string, progress: number, status: Task["status"] = "In progress", start = "2026-01-02", end = "2026-01-02"): Task =>
  ({ ...t(id), parentId: "p", progress, status, start, end });
const family = () => [ws("a", [{ ...t("p"), status: "Done", progress: 100, subtasks: [sub("s1", 100, "Done"), sub("s2", 50, "In progress", "2026-01-05", "2026-01-06")] }, t("z")])];

test("subtask ops keep the parent's rollup, status and subtasks in step", () => {
  // adding an unfinished subtask reopens a Done parent and re-averages
  const added = upsertSubtask(family(), "p", sub("s3", 0, "Not started"));
  const p = added[0].tasks[0];
  assert.deepEqual([p.status, p.progress, p.subtasks?.length], ["In progress", 50, 3]);
  // editing the parent's own fields keeps its subtasks (the form doesn't carry them)
  const edited = upsertTask(family(), { ...t("p"), name: "renamed", progress: 10 }, "a");
  assert.deepEqual([edited[0].tasks[0].name, edited[0].tasks[0].subtasks?.length, edited[0].tasks[0].progress], ["renamed", 2, 75]);
  // deleting a subtask re-averages; deleting the parent takes the subtasks with it
  assert.equal(removeTask(family(), "s2")[0].tasks[0].progress, 100);
  assert.deepEqual(removeTask(family(), "p")[0].tasks.map((x) => x.id), ["z"]);
});

test("promoteSubtask keeps dates and lands in start/end order", () => {
  const out = promoteSubtask(family(), "s2")[0].tasks;
  assert.deepEqual(out.map((x) => x.id), ["p", "z", "s2"]); // s2 starts after both, so it goes last
  const moved = out.find((x) => x.id === "s2")!;
  assert.deepEqual([moved.start, moved.end, moved.parentId, moved.progress], ["2026-01-05", "2026-01-06", null, 50]);
  assert.equal(out.find((x) => x.id === "p")!.progress, 100); // parent re-averaged over what is left
});

test("removeTask can keep a deleted parent's subtasks as standalone tasks", () => {
  const out = removeTask(family(), "p", true)[0].tasks;
  assert.deepEqual(out.map((x) => x.id), ["z", "s1", "s2"]); // slotted by start/end; "p" is gone
  assert.deepEqual(out.map((x) => x.parentId ?? null), [null, null, null]);
  const s2 = out.find((x) => x.id === "s2")!;
  assert.deepEqual([s2.start, s2.end, s2.progress, s2.status], ["2026-01-05", "2026-01-06", 50, "In progress"]);
});

// ---- nested subtasks: p → m → (x, y), p → n ----
const node = (id: string, parentId: string, progress: number, status: Task["status"] = "In progress", subtasks?: Task[]): Task =>
  ({ ...t(id), parentId, progress, status, subtasks, start: "2026-01-03", end: "2026-01-04" });
const tree = () => [ws("a", [
  { ...t("p"), status: "Done", progress: 100, subtasks: [
    node("m", "p", 100, "Done", [node("x", "m", 100, "Done"), node("y", "m", 100, "Done")]),
    node("n", "p", 100, "Done"),
  ] },
  t("z"),
])];
const at = (wss: Workstream[], ...path: number[]) => path.reduce<Task>((n, i) => n.subtasks![i], { subtasks: wss[0].tasks } as Task);

test("upsertSubtask at depth 2 re-averages and reopens every ancestor", () => {
  const out = upsertSubtask(tree(), "m", node("y", "m", 0, "Not started"));
  assert.deepEqual([at(out, 0, 0).status, at(out, 0, 0).progress], ["In progress", 50]);
  assert.deepEqual([at(out, 0).status, at(out, 0).progress], ["In progress", 75]); // avg(m 50, n 100)
  // a dialog edit of a mid-level task (no `subtasks` on it) keeps its children
  const renamed = upsertSubtask(tree(), "p", { ...node("m", "p", 0, "Done"), name: "M2", subtasks: undefined });
  assert.deepEqual([at(renamed, 0, 0).name, at(renamed, 0, 0).subtasks?.length, at(renamed, 0, 0).progress], ["M2", 2, 100]);
});

test("removeTask at depth 2, and keep moves children up one level", () => {
  const gone = removeTask(upsertSubtask(tree(), "m", node("y", "m", 0)), "y");
  assert.deepEqual([at(gone, 0, 0).subtasks?.map((s) => s.id), at(gone, 0, 0).progress, at(gone, 0).progress], [["x"], 100, 100]);
  const kept = removeTask(tree(), "m", true);
  assert.deepEqual(at(kept, 0).subtasks?.map((s) => [s.id, s.parentId]), [["n", "p"], ["x", "p"], ["y", "p"]]);
  const all = removeTask(tree(), "m");
  assert.deepEqual(at(all, 0).subtasks?.map((s) => s.id), ["n"]);
  // keep on a top-level task: children become tasks and bring their own subtasks along
  const top = removeTask(tree(), "p", true)[0].tasks;
  assert.deepEqual(top.map((x) => [x.id, x.parentId ?? null, x.subtasks?.length ?? 0]), [["z", null, 0], ["m", null, 2], ["n", null, 0]]);
});

test("promoteSubtask moves up one level, children travel with it", () => {
  const up = promoteSubtask(tree(), "y");
  assert.deepEqual(at(up, 0).subtasks?.map((s) => [s.id, s.parentId]), [["m", "p"], ["n", "p"], ["y", "p"]]);
  assert.deepEqual(at(up, 0, 0).subtasks?.map((s) => s.id), ["x"]);
  const top = promoteSubtask(tree(), "m")[0].tasks;
  const m = top.find((x) => x.id === "m")!;
  assert.deepEqual([m.parentId, m.subtasks?.map((s) => s.id), m.start, m.end], [null, ["x", "y"], "2026-01-03", "2026-01-04"]);
  assert.deepEqual(at([ws("a", top)], 0).subtasks?.map((s) => s.id), ["n"]);
});
