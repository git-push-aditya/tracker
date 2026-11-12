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

// For a single task in a route response: its direct subtasks only (clients use the id and then refetch the dashboard).
export const taskInclude = {
  dependsOn: true,
  subtasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.TaskInclude;

// Every task of the workstream, flat (Prisma can't include recursively); toWorkstream nests them by parentId.
export const workstreamInclude = {
  tasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { dependsOn: true } },
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

type FlatRow = Prisma.WorkstreamGetPayload<{ include: typeof workstreamInclude }>["tasks"][number];
type Node = ReturnType<typeof toSubtask> & { subtasks: Node[] };

/** Nests a workstream's flat task rows by parentId (rows keep their position order) and applies the rollup (R1).
 *  Returns the top-level tasks; every node carries a `subtasks` array, empty for a leaf. */
export function buildTree(rows: FlatRow[]): Node[] {
  const kids = new Map<string | null, FlatRow[]>();
  for (const r of rows) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r]);
  const node = (r: FlatRow): Node => ({ ...toSubtask(r), dependsOn: r.dependsOn.map((d) => d.dependsOnId), subtasks: (kids.get(r.id) ?? []).map(node) });
  return (kids.get(null) ?? []).map(node).map(withRollup);
}

export const toWorkstream = (w: Prisma.WorkstreamGetPayload<{ include: typeof workstreamInclude }>) => ({
  id: w.id,
  name: w.name,
  color: w.color,
  owner: w.owner,
  goal: w.goal,
  updatedAt: w.updatedAt.toISOString(),
  tasks: buildTree(w.tasks),
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
