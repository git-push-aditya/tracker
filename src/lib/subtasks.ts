import { avg } from "./dashboard";
import type { StatusLabel } from "./status";

// Pure subtask rules (see docs/subtasks-implementation.md). Dates are ISO strings, which compare correctly as text.
type Sub = { status: StatusLabel; progress: number; end: string };

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

/** R1 on read: a parent with subtasks shows their average, whatever progress is stored. */
export const withRollup = <T extends { progress: number; subtasks?: { progress: number }[] }>(t: T): T =>
  t.subtasks?.length ? { ...t, progress: rollupProgress(t.subtasks) } : t;
