import { effStatus, STATUSES, type StatusLabel } from "./status";
import type { Task, Workstream } from "./schemas";

export type Filters = { ws: string; owner: string; status: StatusLabel | "" };
export const NO_FILTERS: Filters = { ws: "", owner: "", status: "" };

export const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
export const anyFilter = (f: Filters) => !!(f.ws || f.owner || f.status);
export const allTasks = (wss: Workstream[]) => wss.flatMap((ws) => ws.tasks.map((t) => ({ ws, t })));

export function findTask(wss: Workstream[], id: string) {
  for (const ws of wss) { const t = ws.tasks.find((x) => x.id === id); if (t) return { ws, t }; }
  return null;
}

export function matches(f: Filters, ws: Workstream, t: Task, today: number) {
  if (f.ws && ws.id !== f.ws) return false;
  if (f.owner && t.owner !== f.owner) return false;
  if (f.status && effStatus(t, today).status !== f.status) return false;
  return true;
}

const byName = (a: string, b: string) => a.localeCompare(b);
// Owner filter lists only people who own at least one task (bug 7)
export const taskOwners = (wss: Workstream[]) =>
  [...new Set(allTasks(wss).map((x) => x.t.owner).filter(Boolean))].sort(byName);
// Owner suggestions in the dialogs also include workstream owners
export const suggestedOwners = (wss: Workstream[]) =>
  [...new Set(allTasks(wss).map((x) => x.t.owner).concat(wss.map((w) => w.owner)).filter(Boolean))].sort(byName);

export { STATUSES };
