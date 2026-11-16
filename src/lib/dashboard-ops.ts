// Pure, immutable edits on the workstream list. Used by the cache-only mutation path (demo mode).
import { findTask } from "./dashboard";
import { isISO, toDay } from "./date";
import type { Subtask, Task, Workstream } from "./schemas";
import { STATUSES } from "./status";
import { promoteSlot, reopensParent, withRollup } from "./subtasks";

export const uid = (p: string) => p + Math.random().toString(36).slice(2, 8);

export type TaskForm = {
  id: string; name: string; owner: string; start: string; end: string; status: string;
  progress: string; isMilestone: boolean; dependsOn: string[]; description: string;
};

// Validates the task dialog like refer.html's submit handler, then normalises (Done → 100%, milestone start = end).
export function buildTask(f: TaskForm): { task: Task } | { error: string } {
  const name = f.name.trim();
  const end = f.end, start = f.isMilestone ? end : f.start;
  if (!name) return { error: "Please give the task a name." };
  if (!isISO(start) || !isISO(end)) return { error: "Please enter valid dates." };
  if (toDay(end) < toDay(start)) return { error: "End date must be on or after the start date." };
  const status = STATUSES.find((s) => s === f.status) ?? "Not started";
  const progress = status === "Done" ? 100 : Math.max(0, Math.min(100, Math.round(Number(f.progress) || 0)));
  return {
    task: {
      id: f.id || uid("t"), name, owner: f.owner.trim(), start, end, progress, status,
      isMilestone: f.isMilestone, dependsOn: f.dependsOn, description: f.description,
    },
  };
}

// Replace in place when the workstream is unchanged; otherwise move to the end of the target workstream.
export function upsertTask(wss: Workstream[], task: Task, wsId: string): Workstream[] {
  const from = wss.find((w) => w.tasks.some((t) => t.id === task.id));
  const kept = from?.tasks.find((t) => t.id === task.id)?.subtasks; // the edit form knows nothing about subtasks
  const next = withRollup(kept ? { ...task, subtasks: kept } : task);
  return wss.map((w) => {
    if (from && w.id === from.id && from.id === wsId) return { ...w, tasks: w.tasks.map((t) => (t.id === task.id ? next : t)) };
    if (from && w.id === from.id) return { ...w, tasks: w.tasks.filter((t) => t.id !== task.id) };
    if (w.id === wsId) return { ...w, tasks: [...w.tasks, next] };
    return w;
  });
}

/** Mirrors the API on one parent after a change below it: re-average (R1), and a Done parent with an unfinished
 *  subtask is reopened (R6). */
const settle = (p: Task): Task => {
  const r = withRollup(p);
  return r.subtasks?.some((s) => reopensParent(r.status, s.status)) ? { ...r, status: "In progress" } : r;
};

/** Replaces the task `id`, at any depth, with what `fn` returns (none = removed), then settles every ancestor on the
 *  way back up. null if `id` isn't in `list`. */
function editTree(list: Task[], id: string, fn: (t: Task) => Task[]): Task[] | null {
  const i = list.findIndex((t) => t.id === id);
  if (i >= 0) return [...list.slice(0, i), ...fn(list[i]), ...list.slice(i + 1)];
  for (let j = 0; j < list.length; j++) {
    const next = list[j].subtasks?.length ? editTree(list[j].subtasks!, id, fn) : null;
    if (next) return list.map((t, k) => (k === j ? settle({ ...t, subtasks: next }) : t));
  }
  return null;
}
const editNode = (wss: Workstream[], id: string, fn: (t: Task) => Task[]) =>
  wss.map((w) => { const tasks = editTree(w.tasks, id, fn); return tasks ? { ...w, tasks } : w; });

/** Add or replace a subtask under `parentId`, at any depth. Mirrors the API: every ancestor re-averages, and Done
 *  ones are reopened by an unfinished subtask. An edit that doesn't carry `subtasks` (the dialog) keeps the existing ones. */
export function upsertSubtask(wss: Workstream[], parentId: string, sub: Subtask): Workstream[] {
  return editNode(wss, parentId, (p) => {
    const cur = p.subtasks ?? [];
    const prev = cur.find((x) => x.id === sub.id);
    const next = withRollup({ ...sub, subtasks: sub.subtasks ?? prev?.subtasks });
    return [settle({ ...p, subtasks: prev ? cur.map((x) => (x.id === sub.id ? next : x)) : [...cur, next] })];
  });
}

/** Move a subtask up one level (D3), its own subtasks with it. Under a top-level parent it becomes a task slotted by
 *  start/end date; deeper it becomes the last subtask of its grandparent. Dates and attributes are untouched. */
export function promoteSubtask(wss: Workstream[], id: string): Workstream[] {
  const f = findTask(wss, id);
  if (!f?.parent) return wss;
  const grand = f.ancestors.at(-2);
  const out = editNode(wss, id, () => []);
  if (grand) return editNode(out, grand.id, (g) => [settle({ ...g, subtasks: [...(g.subtasks ?? []), { ...f.t, parentId: g.id }] })]);
  const slot = promoteSlot(f.ws.tasks.map((t, position) => ({ position, start: t.start, end: t.end })), f.t);
  return out.map((w) => {
    if (w.id !== f.ws.id) return w;
    const tasks = [...w.tasks];
    tasks.splice(slot, 0, { ...f.t, parentId: null, subtasks: f.t.subtasks ?? [] });
    return { ...w, tasks };
  });
}

const dropDeps = (wss: Workstream[], ids: string[]) =>
  wss.map((w) => ({ ...w, tasks: w.tasks.map((t) => (t.dependsOn.some((d) => ids.includes(d)) ? { ...t, dependsOn: t.dependsOn.filter((d) => !ids.includes(d)) } : t)) }));

// A task goes with all its subtasks; a subtask just leaves its parent (whose ancestors re-average).
// `keepSubtasks`: the deleted task's direct subtasks move up one level with their own subtasks (D4) instead: under a
// top-level task they become tasks (dates unchanged, slotted by start/end), deeper they join the grandparent.
export function removeTask(wss: Workstream[], id: string, keepSubtasks = false): Workstream[] {
  const f = findTask(wss, id);
  if (!f) return wss;
  const kids = keepSubtasks ? [...(f.t.subtasks ?? [])].sort((a, b) => (a.start + a.end).localeCompare(b.start + b.end)) : [];
  if (f.parent) {
    const p = f.parent;
    return editNode(wss, p.id, (x) => [settle({ ...x, subtasks: [...x.subtasks!.filter((s) => s.id !== id), ...kids.map((k) => ({ ...k, parentId: p.id }))] })]);
  }
  return dropDeps(wss.map((w) => {
    if (w.id !== f.ws.id) return w;
    const tasks = w.tasks.filter((t) => t.id !== id);
    for (const s of kids) tasks.splice(promoteSlot(tasks.map((t, position) => ({ position, start: t.start, end: t.end })), s), 0, { ...s, parentId: null, subtasks: s.subtasks ?? [] });
    return { ...w, tasks };
  }), [id]);
}

export type WorkstreamValues = Pick<Workstream, "name" | "owner" | "goal" | "color">;

export function upsertWorkstream(wss: Workstream[], v: WorkstreamValues, id?: string): Workstream[] {
  return id ? wss.map((w) => (w.id === id ? { ...w, ...v } : w)) : [...wss, { id: uid("ws"), ...v, tasks: [] }];
}

export function removeWorkstream(wss: Workstream[], id: string): Workstream[] {
  const ids = wss.find((w) => w.id === id)?.tasks.map((t) => t.id) ?? [];
  return dropDeps(wss.filter((w) => w.id !== id), ids);
}
