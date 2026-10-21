import assert from "node:assert/strict";
import { test } from "node:test";
import { effStatus } from "./status";
import { toDay } from "./date";
import { parentChangeError, promoteSlot, reopensParent, rollupProgress, subtaskChangeError } from "./subtasks";

const sub = (status: "Done" | "In progress" | "Delayed", progress: number, end = "2026-03-01") => ({ status, progress, end });

test("R1 parent progress is the rounded average", () => {
  assert.equal(rollupProgress([]), 0);
  assert.equal(rollupProgress([{ progress: 100 }, { progress: 50 }, { progress: 0 }]), 50);
  assert.equal(rollupProgress([{ progress: 100 }, { progress: 0 }, { progress: 0 }]), 33);
});

test("R2/R4 parent can't be Done early or end before its latest subtask", () => {
  const subs = [sub("Done", 100, "2026-03-01"), sub("In progress", 40, "2026-03-10")];
  assert.equal(parentChangeError(subs, { status: "Done", end: "2026-04-01" }), "1 subtask not done");
  assert.match(parentChangeError(subs, { status: "In progress", end: "2026-03-09" })!, /latest subtask \(2026-03-10\)/);
  assert.equal(parentChangeError(subs, { status: "In progress", end: "2026-03-10" }), null);
  assert.equal(parentChangeError([sub("Done", 100)], { status: "Done", end: "2026-03-01" }), null);
  assert.equal(parentChangeError([], { status: "Done", end: "2026-01-01" }), null);
});

test("R4 subtask can't end after its parent", () => {
  assert.match(subtaskChangeError({ end: "2026-03-10" }, { end: "2026-03-11" })!, /after the parent's/);
  assert.equal(subtaskChangeError({ end: "2026-03-10" }, { end: "2026-03-10" }), null);
});

test("R6 an unfinished subtask reopens a Done parent", () => {
  assert.equal(reopensParent("Done", "In progress"), true);
  assert.equal(reopensParent("Done", "Done"), false);
  assert.equal(reopensParent("In progress", "Not started"), false);
});

test("R5 a parent is Delayed when a subtask is", () => {
  const today = toDay("2026-03-05");
  const parent = { status: "In progress" as const, end: "2026-03-30" };
  assert.equal(effStatus(parent, today).status, "In progress");
  assert.equal(effStatus(parent, today, [sub("In progress", 10, "2026-03-04")]).status, "Delayed"); // overdue subtask
  assert.equal(effStatus(parent, today, [sub("Delayed", 10, "2026-03-20")]).status, "Delayed"); // stored Delayed
  assert.equal(effStatus(parent, today, [sub("Done", 100, "2026-03-04")]).status, "In progress");
  assert.equal(effStatus({ ...parent, status: "Done" }, today, [sub("Delayed", 10)]).status, "Done");
});

test("promote slot keeps start/end order", () => {
  const top = [
    { position: 0, start: "2026-01-01", end: "2026-01-10" },
    { position: 1, start: "2026-02-01", end: "2026-02-10" },
    { position: 2, start: "2026-02-01", end: "2026-02-20" },
  ];
  assert.equal(promoteSlot(top, { start: "2025-12-01", end: "2025-12-05" }), 0); // before everything
  assert.equal(promoteSlot(top, { start: "2026-01-15", end: "2026-01-20" }), 1); // between
  assert.equal(promoteSlot(top, { start: "2026-02-01", end: "2026-02-15" }), 2); // same start, earlier end than #2
  assert.equal(promoteSlot(top, { start: "2026-03-01", end: "2026-03-02" }), 3); // after everything
  assert.equal(promoteSlot([], { start: "2026-03-01", end: "2026-03-02" }), 0);
});
