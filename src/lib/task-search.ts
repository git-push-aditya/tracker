import type { Workstream } from "./schemas";

export const FIELDS = ["name", "description", "workstream", "owner"] as const;
export type Field = (typeof FIELDS)[number];

// Substring search over all tasks. A task is ranked by the first field (in FIELDS order) that contains the query,
// so name matches come before description matches, then workstream, then owner. Ties keep dashboard order.
export function searchTasks(workstreams: Workstream[], query: string, limit = 20) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = workstreams.flatMap((ws) =>
    ws.tasks.flatMap((p) => [p, ...(p.subtasks ?? [])]).flatMap((t) => { // subtasks are searchable too
      const text: Record<Field, string> = { name: t.name, description: t.description, workstream: ws.name, owner: t.owner };
      const field = FIELDS.find((f) => text[f].toLowerCase().includes(q));
      return field ? [{ ws, t, field }] : [];
    }),
  );
  return hits.sort((a, b) => FIELDS.indexOf(a.field) - FIELDS.indexOf(b.field)).slice(0, limit); // sort is stable
}
