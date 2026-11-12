import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeImport } from "./import";

test("normalizeImport repairs and rejects", () => {
  const { workstreams } = normalizeImport({
    workstreams: [{ id: "w", color: "nope", tasks: [
      { id: "a", start: "2026-05-10", end: "2026-05-01", status: "Done", progress: 3, dependsOn: ["a", "b", "ghost", "w"] },
      { id: "b", isMilestone: true, start: "2026-01-01", end: "2026-01-09", progress: 500 },
    ] }],
  });
  const [a, b] = workstreams[0].tasks;
  assert.equal(workstreams[0].color, "#2a78d6"); // palette fallback
  assert.deepEqual([a.end, a.progress, a.dependsOn], ["2026-05-10", 100, ["b"]]); // end>=start, Done=100, self/missing deps dropped
  assert.deepEqual([b.start, b.progress], ["2026-01-09", 100]); // milestone start=end, clamped
  assert.throws(() => normalizeImport({ workstreams: [{ id: "x" }, { id: "x" }] }), /Duplicate/);
  assert.throws(() => normalizeImport({}), /Expected/);
});

test("normalizeImport subtasks: nested, repaired to the subtask rules", () => {
  const { workstreams } = normalizeImport({
    workstreams: [{ id: "w", tasks: [
      { id: "p", start: "2026-03-01", end: "2026-03-05", status: "Done", progress: 100, dependsOn: ["s1"], subtasks: [
        { id: "s1", start: "2026-03-01", end: "2026-03-09", status: "Done", dependsOn: ["p"], subtasks: [
          { id: "deep", start: "2026-03-01", end: "2026-03-12", status: "Done", subtasks: [{ id: "tooDeep" }] },
        ] },
        { id: "s2", start: "2026-03-02", end: "2026-03-04", status: "In progress", progress: 50, owner: "Ben" },
      ] },
      { id: "q", subtasks: [] },
    ] }],
  });
  const [p, q] = workstreams[0].tasks;
  assert.deepEqual([p.end, p.status, p.progress], ["2026-03-12", "In progress", 75]); // ends with its latest (repaired) subtask, reopened, averaged
  assert.deepEqual(p.dependsOn, []); // can't depend on a subtask
  assert.deepEqual(p.subtasks?.map((s) => [s.id, s.parentId, s.dependsOn.length]), [["s1", "p", 0], ["s2", "p", 0]]);
  const s1 = p.subtasks![0];
  assert.deepEqual([s1.end, s1.status], ["2026-03-12", "Done"]); // extended to its own subtask's end
  assert.deepEqual(s1.subtasks?.map((s) => [s.id, s.parentId, s.subtasks]), [["deep", "s1", undefined]]); // depth 2 kept, "tooDeep" dropped
  assert.equal(q.subtasks, undefined);
  assert.throws(() => normalizeImport({ workstreams: [{ id: "w", tasks: [{ id: "a", subtasks: [{ id: "a" }] }] }] }), /Duplicate/);
  assert.throws(() => normalizeImport({ workstreams: [{ id: "w", tasks: [{ id: "a", subtasks: [{ id: "b", subtasks: [{ id: "a" }] }] }] }] }), /Duplicate/);
});

test("normalizeImport repairs the middle level and rolls progress up two levels", () => {
  const { workstreams } = normalizeImport({
    workstreams: [{ id: "w", tasks: [
      { id: "p", start: "2026-03-01", end: "2026-03-31", status: "Done", subtasks: [
        { id: "m", start: "2026-03-01", end: "2026-03-20", status: "Done", subtasks: [
          { id: "x", end: "2026-03-10", start: "2026-03-01", status: "Done" },
          { id: "y", end: "2026-03-10", start: "2026-03-01", status: "In progress", progress: 0 },
        ] },
        { id: "n", start: "2026-03-01", end: "2026-03-05", status: "Done" },
      ] },
    ] }],
  });
  const p = workstreams[0].tasks[0], m = p.subtasks![0];
  assert.deepEqual([m.status, m.progress], ["In progress", 50]); // open child reopens the middle level
  assert.deepEqual([p.status, p.progress], ["In progress", 75]); // avg(m 50, n 100), and reopened in turn
});
