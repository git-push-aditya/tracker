import { toDay } from "./date";
import { allTasks, effOf } from "./dashboard";
import type { Workstream } from "./schemas";
import { effStatus, type StatusLabel } from "./status";

const s = (n: number) => (n === 1 ? "" : "s");

// A task shows when its (effective) status is ticked, OR (if days > 0) it is not done and due within `days` days.
export function attentionRows(workstreams: Workstream[], today: number, statuses: StatusLabel[], days: number) {
  const items = allTasks(workstreams).flatMap(({ ws, t }) => [{ ws, t, parent: undefined as string | undefined }, ...(t.subtasks ?? []).map((x) => ({ ws, t: x, parent: t.name }))]);
  return items.flatMap(({ ws, t, parent }) => {
    const { status } = parent ? effStatus(t, today) : effOf(t, today);
    const left = toDay(t.end) - today;
    const byStatus = statuses.includes(status), soon = days > 0 && status !== "Done" && left >= 0 && left <= days;
    if (!byStatus && !soon) return [];
    const reason = status === "Delayed" && left < 0 && byStatus ? `Overdue by ${-left} day${s(-left)}`
      : soon ? (left === 0 ? "Due today" : `Due in ${left} day${s(left)}`) : status;
    return [{ ws, t, parent, status, reason, overdue: left < 0 && status === "Delayed", left }];
  }).sort((a, b) => a.left - b.left);
}

