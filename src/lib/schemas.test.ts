import assert from "node:assert/strict";
import { test } from "node:test";
import { Password, TaskInput } from "./schemas";

const task = { name: "t", workstreamId: "w", owner: "", start: "2026-01-01", end: "2026-01-02", progress: 0, status: "Not started", isMilestone: false, dependsOn: [] };

test("Password counts bytes, not characters", () => {
  assert.ok(Password.safeParse("a".repeat(72)).success);
  assert.ok(!Password.safeParse("é".repeat(37)).success); // 37 chars = 74 bytes
  assert.ok(!Password.safeParse("short").success);
});

test("TaskInput rules", () => {
  assert.ok(TaskInput.safeParse(task).success);
  assert.ok(!TaskInput.safeParse({ ...task, end: "2025-12-31" }).success);
  assert.ok(!TaskInput.safeParse({ ...task, start: "2026-02-30" }).success); // not a real date
  assert.ok(!TaskInput.safeParse({ ...task, isMilestone: true }).success); // start != end
  assert.ok(!TaskInput.safeParse({ ...task, status: "Done" }).success); // Done needs 100%
});
