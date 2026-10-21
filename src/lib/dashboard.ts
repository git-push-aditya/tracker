import { effStatus, STATUSES, type StatusLabel } from "./status";
import type { Task, Workstream } from "./schemas";

/** Status shown for a task: overdue, or (for a parent) Delayed because a subtask is. */
export const effOf = (t: Task, today: number) => effStatus(t, today, t.subtasks);

export type Filters = { ws: string; owner: string; status: StatusLabel | "" };
export const NO_FILTERS: Filters = { ws: "", owner: "", status: "" };

export const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
export const anyFilter = (f: Filters) => !!(f.ws || f.owner || f.status);
export const allTasks = (wss: Workstream[]) => wss.flatMap((ws) => ws.tasks.map((t) => ({ ws, t })));

// Finds a top-level task or a subtask (then `parent` is set).
export function findTask(wss: Workstream[], id: string): { ws: Workstream; t: Task; parent?: Task } | null {
  for (const ws of wss) {
    const t = ws.tasks.find((x) => x.id === id);
    if (t) return { ws, t };
    for (const p of ws.tasks) { const s = p.subtasks?.find((x) => x.id === id); if (s) return { ws, t: s, parent: p }; }
  }
  return null;
}

export function matches(f: Filters, ws: Workstream, t: Task, today: number) {
  if (f.ws && ws.id !== f.ws) return false;
  const subs = t.subtasks ?? [];
  if (f.owner && t.owner !== f.owner && !subs.some((s) => s.owner === f.owner)) return false;
  if (f.status && effOf(t, today).status !== f.status && !subs.some((s) => effStatus(s, today).status === f.status)) return false;
  return true;
}

const byName = (a: string, b: string) => a.localeCompare(b);
// Owner filter lists only people who own at least one task (bug 7)
const everyOwner = (wss: Workstream[]) => allTasks(wss).flatMap(({ t }) => [t.owner, ...(t.subtasks ?? []).map((s) => s.owner)]);
export const taskOwners = (wss: Workstream[]) => [...new Set(everyOwner(wss).filter(Boolean))].sort(byName);
// Owner suggestions in the dialogs also include workstream owners
export const suggestedOwners = (wss: Workstream[]) =>
  [...new Set(everyOwner(wss).concat(wss.map((w) => w.owner)).filter(Boolean))].sort(byName);

export { STATUSES };
