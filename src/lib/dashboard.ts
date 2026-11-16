import { effStatus, STATUSES, type StatusLabel } from "./status";
import type { Task, Workstream } from "./schemas";
import { descendants } from "./subtasks";

/** Status shown for a task at any depth: overdue, or (for a parent) Delayed because a task below it is. */
export const effOf = (t: Task, today: number) => effStatus(t, today, t.subtasks);

export type Filters = { ws: string; owner: string; status: StatusLabel | "" };
export const NO_FILTERS: Filters = { ws: "", owner: "", status: "" };

export const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
export const anyFilter = (f: Filters) => !!(f.ws || f.owner || f.status);
export const allTasks = (wss: Workstream[]) => wss.flatMap((ws) => ws.tasks.map((t) => ({ ws, t })));

// Finds a task at any depth. For a subtask, `parent` is its direct parent and `ancestors` the chain, top-level first.
export function findTask(wss: Workstream[], id: string): { ws: Workstream; t: Task; parent?: Task; ancestors: Task[] } | null {
  const walk = (list: Task[], up: Task[]): { t: Task; ancestors: Task[] } | null => {
    for (const t of list) {
      if (t.id === id) return { t, ancestors: up };
      const hit = walk(t.subtasks ?? [], [...up, t]);
      if (hit) return hit;
    }
    return null;
  };
  for (const ws of wss) {
    const hit = walk(ws.tasks, []);
    if (hit) return { ws, t: hit.t, parent: hit.ancestors.at(-1), ancestors: hit.ancestors };
  }
  return null;
}

// A top-level task matches when it, or any task below it, matches the owner / status filter.
export function matches(f: Filters, ws: Workstream, t: Task, today: number) {
  if (f.ws && ws.id !== f.ws) return false;
  const subs = descendants(t);
  if (f.owner && t.owner !== f.owner && !subs.some((s) => s.owner === f.owner)) return false;
  if (f.status && effOf(t, today).status !== f.status && !subs.some((s) => effOf(s, today).status === f.status)) return false;
  return true;
}

const byName = (a: string, b: string) => a.localeCompare(b);
// Owner filter lists only people who own at least one task (bug 7), at any depth
const everyOwner = (wss: Workstream[]) => allTasks(wss).flatMap(({ t }) => [t, ...descendants(t)].map((x) => x.owner));
export const taskOwners = (wss: Workstream[]) => [...new Set(everyOwner(wss).filter(Boolean))].sort(byName);
// Owner suggestions in the dialogs also include workstream owners
export const suggestedOwners = (wss: Workstream[]) =>
  [...new Set(everyOwner(wss).concat(wss.map((w) => w.owner)).filter(Boolean))].sort(byName);

export { STATUSES };
