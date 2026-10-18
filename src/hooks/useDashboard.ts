"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { findTask } from "@/lib/dashboard";
import { removeTask, removeWorkstream, upsertTask, upsertWorkstream, type WorkstreamValues } from "@/lib/dashboard-ops";
import type { Task, Workstream } from "@/lib/schemas";
import { emitToast } from "@/lib/toast";

export type DashboardPayload = { source: "demo" | "db"; workstreams: Workstream[] };
const KEY = ["dashboard"];

export function useDashboard() {
  return useQuery<DashboardPayload>({
    queryKey: KEY,
    queryFn: () => api<DashboardPayload>("GET", "/api/dashboard"),
    // demo edits live in the cache until refresh (no refetch); db data refreshes on window focus
    staleTime: (q) => (q.state.data?.source === "demo" ? Infinity : 30_000),
    refetchOnWindowFocus: (q) => q.state.data?.source === "db",
    retry: false, // the server already retried once; the error panel has a Retry button
  });
}

// One mutation shape for every edit (plan 5.4):
//   demo → cache-only update (never calls the API)
//   db   → optimistic cache update, then the API; on failure roll back + toast; always refetch afterwards
function useEdit<V, R = void>(cfg: {
  optimistic: (wss: Workstream[], v: V) => Workstream[];
  local: (v: V) => R; // result for demo mode
  remote: (v: V, before: Workstream[]) => Promise<R>;
}) {
  const qc = useQueryClient();
  return useMutation<R, Error, V>({
    mutationFn: async (v) => {
      const before = qc.getQueryData<DashboardPayload>(KEY);
      if (!before) throw new Error("No data loaded");
      qc.setQueryData<DashboardPayload>(KEY, { ...before, workstreams: cfg.optimistic(before.workstreams, v) });
      if (before.source === "demo") return cfg.local(v);
      try {
        return await cfg.remote(v, before.workstreams);
      } catch (e) {
        qc.setQueryData<DashboardPayload>(KEY, before); // roll back
        throw e;
      }
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) return emitToast("Couldn't save — check your connection");
      if (e.status === 409) emitToast("Someone else changed this — reloaded");
      else if (e.status !== 401 && e.status !== 403) emitToast(e.status === 503 ? "Database unreachable — change not saved" : e.message); // 401/403: global handler
    },
    onSettled: async () => {
      if (qc.getQueryData<DashboardPayload>(KEY)?.source === "db") await qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

const taskBody = (t: Task, workstreamId: string) => ({
  name: t.name, workstreamId, owner: t.owner, start: t.start, end: t.end, progress: t.progress, status: t.status,
  isMilestone: t.isMilestone, dependsOn: t.dependsOn, description: t.description,
});

// resolves to the task's final id (the server assigns ids in db mode) so the caller can scroll to it
export const useSaveTask = () =>
  useEdit<{ task: Task; wsId: string; isNew: boolean }, string>({
    optimistic: (w, v) => upsertTask(w, v.task, v.wsId),
    local: (v) => v.task.id,
    remote: async (v, before) => {
      if (v.isNew) return (await api<Task>("POST", "/api/tasks", taskBody(v.task, v.wsId))).id;
      const expectedUpdatedAt = findTask(before, v.task.id)?.t.updatedAt;
      await api("PUT", `/api/tasks/${v.task.id}`, { ...taskBody(v.task, v.wsId), expectedUpdatedAt });
      return v.task.id;
    },
  });

export const useDeleteTask = () =>
  useEdit<string>({ optimistic: removeTask, local: () => undefined, remote: (id) => api("DELETE", `/api/tasks/${id}`) });

export const useSaveWorkstream = () =>
  useEdit<{ values: WorkstreamValues; id?: string }>({
    optimistic: (w, v) => upsertWorkstream(w, v.values, v.id),
    local: () => undefined,
    remote: async (v, before) => {
      if (!v.id) return void (await api("POST", "/api/workstreams", v.values));
      const expectedUpdatedAt = before.find((w) => w.id === v.id)?.updatedAt;
      await api("PUT", `/api/workstreams/${v.id}`, { ...v.values, expectedUpdatedAt });
    },
  });

export const useDeleteWorkstream = () =>
  useEdit<string>({ optimistic: removeWorkstream, local: () => undefined, remote: (id) => api("DELETE", `/api/workstreams/${id}`) });

export const useImport = () =>
  useEdit<Workstream[]>({
    optimistic: (_, v) => v,
    local: () => undefined,
    remote: (v) => api("POST", "/api/import", { workstreams: v }),
  });
