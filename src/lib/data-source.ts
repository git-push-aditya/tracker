import dummy from "../../data/dummy-data.json";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { DashboardData } from "./schemas";
import { statusFromDb } from "./status";

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database unreachable");
  }
}

export const isDemoMode = () => !process.env.DATABASE_URL;

export type Dashboard = { source: "demo" | "db"; workstreams: DashboardData["workstreams"] };

const day = (d: Date) => d.toISOString().slice(0, 10);

export const workstreamInclude = {
  tasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { dependsOn: true } },
} satisfies Prisma.WorkstreamInclude;
export const taskInclude = { dependsOn: true } satisfies Prisma.TaskInclude;

export const toTask = (t: Prisma.TaskGetPayload<{ include: typeof taskInclude }>) => ({
  id: t.id,
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
  if (isDemoMode()) return { source: "demo", workstreams: DashboardData.parse(dummy).workstreams };
  for (let attempt = 0; ; attempt++) {
    try {
      return { source: "db", workstreams: await fromDb() };
    } catch {
      if (attempt) throw new DatabaseUnavailableError(); // retry once: covers a transient connection failure
    }
  }
}
