// Pure, immutable edits on the workstream list. Used by the cache-only mutation path (demo mode).
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

const editParent = (wss: Workstream[], parentId: string, fn: (p: Task) => Task) =>
  wss.map((w) => (w.tasks.some((t) => t.id === parentId) ? { ...w, tasks: w.tasks.map((t) => (t.id === parentId ? fn(t) : t)) } : w));

/** Add or replace a subtask. Mirrors the API: the parent re-averages, and a Done parent is reopened by an unfinished subtask. */
export function upsertSubtask(wss: Workstream[], parentId: string, sub: Subtask): Workstream[] {
  return editParent(wss, parentId, (p) => {
    const cur = p.subtasks ?? [];
    const subs = cur.some((x) => x.id === sub.id) ? cur.map((x) => (x.id === sub.id ? sub : x)) : [...cur, sub];
    return withRollup({ ...p, subtasks: subs, status: reopensParent(p.status, sub.status) ? "In progress" : p.status });
  });
}

/** Turn a subtask into a top-level task, slotted by start/end date. Dates and attributes are untouched. */
export function promoteSubtask(wss: Workstream[], id: string): Workstream[] {
  const ws = wss.find((w) => w.tasks.some((p) => p.subtasks?.some((s) => s.id === id)));
  const sub = ws?.tasks.flatMap((p) => p.subtasks ?? []).find((s) => s.id === id);
  if (!ws || !sub) return wss;
  const top = ws.tasks.map((t, position) => ({ position, start: t.start, end: t.end }));
  const slot = promoteSlot(top, sub);
  return wss.map((w) => {
    if (w.id !== ws.id) return w;
    const tasks = w.tasks.map((p) => (p.subtasks?.some((s) => s.id === id) ? withRollup({ ...p, subtasks: p.subtasks.filter((s) => s.id !== id) }) : p));
    tasks.splice(slot, 0, { ...sub, parentId: null, subtasks: [] });
    return { ...w, tasks };
  });
}

const dropDeps = (wss: Workstream[], ids: string[]) =>
  wss.map((w) => ({ ...w, tasks: w.tasks.map((t) => (t.dependsOn.some((d) => ids.includes(d)) ? { ...t, dependsOn: t.dependsOn.filter((d) => !ids.includes(d)) } : t)) }));

// A top-level task goes with its subtasks; a subtask just leaves its parent (which re-averages).
// `keepSubtasks`: a deleted parent's subtasks become top-level tasks (dates unchanged, slotted by start/end) instead of going with it.
export function removeTask(wss: Workstream[], id: string, keepSubtasks = false): Workstream[] {
  const parent = wss.flatMap((w) => w.tasks).find((p) => p.id === id);
  if (keepSubtasks && parent?.subtasks?.length) {
    const subs = [...parent.subtasks].sort((a, b) => (a.start + a.end).localeCompare(b.start + b.end));
    return dropDeps(wss.map((w) => {
      if (!w.tasks.some((t) => t.id === id)) return w;
      const tasks = w.tasks.filter((t) => t.id !== id);
      for (const s of subs) tasks.splice(promoteSlot(tasks.map((t, position) => ({ position, start: t.start, end: t.end })), s), 0, { ...s, parentId: null, subtasks: [] });
      return { ...w, tasks };
    }), [id]);
  }
  const gone = wss.flatMap((w) => w.tasks).find((p) => p.subtasks?.some((s) => s.id === id));
  if (gone) return editParent(wss, gone.id, (p) => withRollup({ ...p, subtasks: p.subtasks!.filter((s) => s.id !== id) }));
  return dropDeps(wss.map((w) => ({ ...w, tasks: w.tasks.filter((t) => t.id !== id) })), [id]);
}

export type WorkstreamValues = Pick<Workstream, "name" | "owner" | "goal" | "color">;

export function upsertWorkstream(wss: Workstream[], v: WorkstreamValues, id?: string): Workstream[] {
  return id ? wss.map((w) => (w.id === id ? { ...w, ...v } : w)) : [...wss, { id: uid("ws"), ...v, tasks: [] }];
}

export function removeWorkstream(wss: Workstream[], id: string): Workstream[] {
  const ids = wss.find((w) => w.id === id)?.tasks.map((t) => t.id) ?? [];
  return dropDeps(wss.filter((w) => w.id !== id), ids);
}
