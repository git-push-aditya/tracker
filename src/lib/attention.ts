import { toDay } from "./date";
import { allTasks, effOf } from "./dashboard";
import type { Task, Workstream } from "./schemas";
import type { StatusLabel } from "./status";

const s = (n: number) => (n === 1 ? "" : "s");

// Every task at any depth; `parent` is the path above it ("Parent › Subtask"), undefined for a top-level task.
const withPath = (t: Task, path: string[]): { t: Task; parent?: string }[] =>
  [{ t, parent: path.length ? path.join(" › ") : undefined }, ...(t.subtasks ?? []).flatMap((x) => withPath(x, [...path, t.name]))];

// A task shows when its (effective) status is ticked, OR (if days > 0) it is not done and due within `days` days.
export function attentionRows(workstreams: Workstream[], today: number, statuses: StatusLabel[], days: number) {
  const items = allTasks(workstreams).flatMap(({ ws, t }) => withPath(t, []).map((x) => ({ ws, ...x })));
  return items.flatMap(({ ws, t, parent }) => {
    const { status } = effOf(t, today);
    const left = toDay(t.end) - today;
    const byStatus = statuses.includes(status), soon = days > 0 && status !== "Done" && left >= 0 && left <= days;
    if (!byStatus && !soon) return [];
    const reason = status === "Delayed" && left < 0 && byStatus ? `Overdue by ${-left} day${s(-left)}`
      : soon ? (left === 0 ? "Due today" : `Due in ${left} day${s(left)}`) : status;
    return [{ ws, t, parent, status, reason, overdue: left < 0 && status === "Delayed", left }];
  }).sort((a, b) => a.left - b.left);
}

