"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { suggestedOwners } from "@/lib/dashboard";
import type { Workstream } from "@/lib/schemas";

export type ActorRow = { id: string; name: string; taskCount: number; workstreamCount: number };
export const ACTORS_KEY = ["actors"] as const;

// The list of people for owner pickers. Cached until something that can change it (a save, an import, a rename/merge)
// invalidates it. Demo mode has no table, and until the request finishes, names found in the data are used.
export function useActors(workstreams: Workstream[], demo: boolean) {
  const q = useQuery({
    queryKey: ACTORS_KEY, queryFn: () => api<{ actors: ActorRow[] }>("GET", "/api/actors"),
    enabled: !demo, staleTime: Infinity, refetchOnWindowFocus: false,
  });
  return q.data ? q.data.actors.map((a) => a.name) : suggestedOwners(workstreams);
}
