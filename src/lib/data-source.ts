import dummy from "../../data/dummy-data.json";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { DashboardData } from "./schemas";
import { statusFromDb } from "./status";
import { withRollup } from "./subtasks";

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database unreachable");
  }
}

export const isDemoMode = () => !process.env.DATABASE_URL;

export type Dashboard = { source: "demo" | "db"; workstreams: DashboardData["workstreams"] };

const day = (d: Date) => d.toISOString().slice(0, 10);

export const taskInclude = {
  dependsOn: true,
  subtasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.TaskInclude;

export const workstreamInclude = {
  // top-level only: subtasks are served nested under their parent (phase 2)
  tasks: { where: { parentId: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: taskInclude },
} satisfies Prisma.WorkstreamInclude;

type SubtaskRow = Prisma.TaskGetPayload<Record<string, never>>;
const toSubtask = (t: SubtaskRow) => ({
  id: t.id,
  parentId: t.parentId,
  name: t.name,
  owner: t.owner,
  start: day(t.start),
  end: day(t.end),
  progress: t.progress,
  status: statusFromDb(t.status),
  isMilestone: t.isMilestone,
  dependsOn: [] as string[],
  description: t.description,
  updatedAt: t.updatedAt.toISOString(),
});

export const toTask = (t: Prisma.TaskGetPayload<{ include: typeof taskInclude }>) => withRollup({
  id: t.id,
  parentId: t.parentId,
  name: t.name,
  owner: t.owner,
  start: day(t.start),
  end: day(t.end),
  progress: t.progress,
  status: statusFromDb(t.status),
  isMilestone: t.isMilestone,
  dependsOn: t.dependsOn.map((d) => d.dependsOnId),
  description: t.description,
  updatedAt: t.updatedAt.toISOString(),
  subtasks: t.subtasks.map(toSubtask),
});

export const toWorkstream = (w: Prisma.WorkstreamGetPayload<{ include: typeof workstreamInclude }>) => ({
  id: w.id,
  name: w.name,
  color: w.color,
  owner: w.owner,
  goal: w.goal,
  updatedAt: w.updatedAt.toISOString(),
  tasks: w.tasks.map(toTask),
});

async function fromDb(): Promise<Dashboard["workstreams"]> {
  const rows = await prisma().workstream.findMany({ orderBy: { position: "asc" }, include: workstreamInclude });
  return rows.map(toWorkstream);
}

export async function getDashboard(): Promise<Dashboard> {
  if (isDemoMode()) return { source: "demo", workstreams: DashboardData.parse(dummy).workstreams.map((w) => ({ ...w, tasks: w.tasks.map(withRollup) })) };
  for (let attempt = 0; ; attempt++) {
    try {
      return { source: "db", workstreams: await fromDb() };
    } catch (e) {
      if (attempt) { console.error(e); throw new DatabaseUnavailableError(); } // log it: this also hides non-connection errors (e.g. a missing column)
      // retry once: covers a transient connection failure
    }
  }
}
