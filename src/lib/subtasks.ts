import { avg } from "./dashboard";
import type { StatusLabel } from "./status";

// Pure subtask rules (see docs/subtasks-implementation.md, docs/nested-subtasks-implementation.md).
// Dates are ISO strings, which compare correctly as text. Every rule holds between a node and its direct parent.
type Sub = { status: StatusLabel; progress: number; end: string };

/** How many levels of subtasks a top-level task can have (2: task → subtask → sub-subtask). */
export const MAX_DEPTH = 2;

/** R8: a node at `depth` (top-level 0) can take children while they stay within MAX_DEPTH. */
export const canHaveChildren = (depth: number) => depth < MAX_DEPTH;

/** Every node below `t`, each followed by its own descendants. */
export const descendants = <T extends { subtasks?: T[] }>(t: T): T[] => (t.subtasks ?? []).flatMap((s) => [s, ...descendants(s)]);

/** R1: a parent's progress is the rounded average of its subtasks'. */
export const rollupProgress = (subs: Pick<Sub, "progress">[]) => avg(subs.map((s) => s.progress));

/** R2 + R4 for a parent that has subtasks and is being saved with `next`. null = fine. */
export function parentChangeError(subs: Sub[], next: { status: StatusLabel; end: string }) {
  const open = subs.filter((s) => s.status !== "Done").length;
  if (next.status === "Done" && open) return `${open} subtask${open > 1 ? "s" : ""} not done`;
  const latest = subs.reduce((m, s) => (s.end > m ? s.end : m), "");
  if (latest && next.end < latest) return `Due date can't be before its latest subtask (${latest})`;
  return null;
}

/** R4 for a subtask being saved. null = fine. */
export const subtaskChangeError = (parent: { end: string }, next: { end: string }) =>
  next.end > parent.end ? `Due date can't be after the parent's (${parent.end})` : null;

/** R6: an unfinished subtask can't sit under a Done parent, so that parent is reopened. */
export const reopensParent = (parent: StatusLabel, child: StatusLabel) => parent === "Done" && child !== "Done";

/** Promote: the position that keeps top-level tasks in start/end order (before the first one that starts later). */
export function promoteSlot(top: { position: number; start: string; end: string }[], t: { start: string; end: string }) {
  const sorted = [...top].sort((a, b) => a.position - b.position);
  const later = sorted.find((x) => x.start > t.start || (x.start === t.start && x.end > t.end));
  return later ? later.position : (sorted.at(-1)?.position ?? -1) + 1;
}

/** R1 on read, at every level: a node with subtasks shows the average of its (rolled-up) children, whatever is stored. */
type Rollable = { progress: number; subtasks?: Rollable[] };
export function withRollup<T extends Rollable>(t: T): T {
  if (!t.subtasks?.length) return t;
  const subtasks = t.subtasks.map(withRollup);
  return { ...t, subtasks, progress: rollupProgress(subtasks) } as T;
}
