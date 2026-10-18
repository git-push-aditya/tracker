import { toDay } from "./date";
import { TaskStatus } from "@/generated/prisma/enums"; // enums only: safe to import from client components

export const STATUSES = ["Not started", "In progress", "Done", "At risk", "Delayed"] as const;
export type StatusLabel = (typeof STATUSES)[number];

const TO_DB: Record<StatusLabel, TaskStatus> = {
  "Not started": TaskStatus.NOT_STARTED,
  "In progress": TaskStatus.IN_PROGRESS,
  Done: TaskStatus.DONE,
  "At risk": TaskStatus.AT_RISK,
  Delayed: TaskStatus.DELAYED,
};
const FROM_DB = Object.fromEntries(Object.entries(TO_DB).map(([l, s]) => [s, l])) as Record<TaskStatus, StatusLabel>;

export const STATUS_META: Record<StatusLabel, { icon: string; cls: string }> = {
  "Not started": { icon: "○", cls: "b-ns" },
  "In progress": { icon: "◐", cls: "b-ip" },
  Done: { icon: "✓", cls: "b-done" },
  "At risk": { icon: "⚠", cls: "b-risk" },
  Delayed: { icon: "⏱", cls: "b-delay" },
};

// A task past its end date that isn't Done shows as Delayed (derived, never stored).
export function effStatus(t: { status: StatusLabel; end: string }, today: number) {
  if (t.status !== "Done" && toDay(t.end) < today) return { status: "Delayed" as StatusLabel, auto: t.status !== "Delayed" };
  return { status: t.status, auto: false };
}

export const statusToDb = (label: StatusLabel) => TO_DB[label];
export const statusFromDb = (s: TaskStatus) => FROM_DB[s];
