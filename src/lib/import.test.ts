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
