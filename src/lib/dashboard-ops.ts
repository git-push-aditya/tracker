// Pure, immutable edits on the workstream list. Used by the cache-only mutation path (demo mode).
import { isISO, toDay } from "./date";
import type { Task, Workstream } from "./schemas";
import { STATUSES } from "./status";

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
  return wss.map((w) => {
    if (from && w.id === from.id && from.id === wsId) return { ...w, tasks: w.tasks.map((t) => (t.id === task.id ? task : t)) };
    if (from && w.id === from.id) return { ...w, tasks: w.tasks.filter((t) => t.id !== task.id) };
    if (w.id === wsId) return { ...w, tasks: [...w.tasks, task] };
    return w;
  });
}

const dropDeps = (wss: Workstream[], ids: string[]) =>
  wss.map((w) => ({ ...w, tasks: w.tasks.map((t) => (t.dependsOn.some((d) => ids.includes(d)) ? { ...t, dependsOn: t.dependsOn.filter((d) => !ids.includes(d)) } : t)) }));

export function removeTask(wss: Workstream[], id: string): Workstream[] {
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
