import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeImport } from "./import";
import { MAX_DEPTH } from "./subtasks";

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
          { id: "deep", start: "2026-03-01", end: "2026-03-12", status: "Done", subtasks: [{ id: "deeper", start: "2026-03-01", end: "2026-03-10", status: "Done" }] },
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
  assert.deepEqual(s1.subtasks?.map((s) => [s.id, s.parentId]), [["deep", "s1"]]);
  assert.deepEqual(s1.subtasks![0].subtasks?.map((s) => s.id), ["deeper"]); // depth 3 is within MAX_DEPTH now
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

test("normalizeImport keeps MAX_DEPTH levels of subtasks and drops deeper ones", () => {
  // a chain one level deeper than allowed: top (depth 0) → d1 → … → d(MAX_DEPTH + 1)
  const chain = (d: number): object => ({ id: `d${d}`, start: "2026-03-01", end: "2026-03-02", subtasks: d <= MAX_DEPTH ? [chain(d + 1)] : [] });
  const top = normalizeImport({ workstreams: [{ id: "w", tasks: [chain(0)] }] }).workstreams[0].tasks[0];
  const ids: string[] = [];
  for (let n: typeof top | undefined = top; n; n = n.subtasks?.[0]) ids.push(n.id);
  assert.equal(ids.length, MAX_DEPTH + 1); // depth 0 … MAX_DEPTH
  assert.equal(ids.at(-1), `d${MAX_DEPTH}`);
});

test("v2 extras: created dates, people and history round-trip; bad history is rejected", () => {
  const d = normalizeImport({
    format: "prime-care", version: 2,
    workstreams: [{ id: "w1", name: "W", createdAt: "2026-01-02T03:04:05.000Z", tasks: [
      { id: "t1", name: "T", createdAt: "2026-02-03T00:00:00.000Z", subtasks: [{ id: "s1", name: "S", createdAt: "not a date" }] }] }],
    people: ["Asha", " Asha ", "", "Ravi"],
    history: [{ id: "e1", type: "COMPLETED", at: "2026-03-01T10:00:00.000Z", taskId: "t9", taskName: "Old", workstreamId: "w1", workstreamName: "W", owner: "Asha", actor: null }],
  });
  assert.equal(d.workstreams[0].createdAt, "2026-01-02T03:04:05.000Z");
  assert.equal(d.workstreams[0].tasks[0].createdAt, "2026-02-03T00:00:00.000Z");
  assert.equal(d.workstreams[0].tasks[0].subtasks?.[0].createdAt, undefined);
  assert.deepEqual(d.people, ["Asha", "Ravi"]);
  assert.equal(d.history[0].taskName, "Old");
  assert.equal(d.history[0].note, "");
  assert.deepEqual(normalizeImport({ workstreams: [] }).history, []); // v1 files still work
  const bad = (history: unknown[]) => assert.throws(() => normalizeImport({ workstreams: [], history }), /History entry 1/);
  bad([{ id: "e1", type: "EXPLODED", at: "2026-03-01T10:00:00Z" }]);
  bad([{ id: "e1", type: "DELETED" }]);
  assert.throws(() => normalizeImport({ workstreams: [], history: [{ id: "e1", type: "DELETED", at: "2026-03-01T10:00:00Z" }, { id: "e1", type: "DELETED", at: "2026-03-01T10:00:00Z" }] }), /History entry 2/);
});
