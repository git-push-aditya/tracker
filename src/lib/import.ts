import { PALETTE } from "./palette";
import { Id, isValidIso } from "./schemas";
import { STATUSES } from "./status";
import { MAX_DEPTH, rollupProgress } from "./subtasks";

// Plain Error so this module works in the browser too (the import route maps it to a 400).
export class ImportError extends Error {}

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
type Loose = Record<string, unknown>;
const today = () => new Date().toISOString().slice(0, 10);

// Export file format. v1 files (the old client export) are just { workstreams }; v2 adds the rest of the data.
export const EXPORT_FORMAT = { format: "prime-care", version: 2 } as const;

// A full ISO timestamp, kept so a restore doesn't reset "created" dates (and their sort order) to the import time.
const stamp = (v: unknown) => (typeof v === "string" && !isNaN(Date.parse(v)) && v.length <= 40 ? new Date(v).toISOString() : undefined);
const EVENT_TYPES = ["COMPLETED", "DELETED"] as const;

// Lenient like refer.html's normalize(): defaults, clamped progress, repaired dates, palette fallback.
// Also repairs what the DB CHECK constraints require (milestone start=end, Done=100%).
// Rejects duplicate ids; drops dependencies on missing tasks.
// v2 extras: `people` (every owner, including ones with no work yet) and `history` (the audit trail, merged by id).
export function normalizeImport(raw: unknown) {
  const d = raw as { workstreams?: unknown; people?: unknown; history?: unknown } | null;
  if (!d || !Array.isArray(d.workstreams))
    throw new ImportError("Expected { workstreams: [...] }");

  const seen = new Set<string>();
  const claim = (v: unknown, kind: string) => {
    const id = v ? String(v) : crypto.randomUUID();
    if (!Id.safeParse(id).success)
      throw new ImportError(`Invalid ${kind} id "${id.slice(0, 40)}"`);
    if (seen.has(id)) throw new ImportError(`Duplicate id "${id}"`);
    seen.add(id);
    return id;
  };

  // Shared by tasks and subtasks. Subtask ids are claimed here too, so they can't clash with anything else.
  const mapTask = (t0: unknown, parentId: string | null) => {
    const t = (t0 ?? {}) as Loose;
    const isMilestone = !!t.isMilestone;
    const start0 = typeof t.start === "string" && isValidIso(t.start) ? t.start : today();
    let end = typeof t.end === "string" && isValidIso(t.end) ? t.end : start0;
    if (end < start0) end = start0;
    const status = STATUSES.find((x) => x === t.status) ?? "Not started";
    return {
      id: claim(t.id, "task"),
      parentId,
      name: str(t.name || "Untitled task", 140),
      owner: str(t.owner, 80),
      start: isMilestone ? end : start0,
      end,
      progress: status === "Done" ? 100 : Math.max(0, Math.min(100, Math.round(Number(t.progress) || 0))),
      status,
      isMilestone,
      dependsOn: Array.isArray(t.dependsOn) ? (t.dependsOn as unknown[]).map(String) : [],
      description: String(t.description ?? ""),
      createdAt: stamp(t.createdAt),
    };
  };

  // A task with its subtasks, down to MAX_DEPTH (deeper ones are dropped). Subtasks take no dependencies and live in
  // their parent's workstream. Children are mapped first, so the repair runs bottom-up: each parent ends no earlier
  // than its latest (repaired) subtask, isn't Done while one is open, and averages them (the API rules).
  type Mapped = ReturnType<typeof mapTask> & { subtasks?: Mapped[] };
  const mapTree = (t0: unknown, parentId: string | null, depth: number): Mapped => {
    const task = mapTask(t0, parentId);
    if (parentId) task.dependsOn = [];
    const raw = depth < MAX_DEPTH ? ((t0 ?? {}) as Loose).subtasks : undefined;
    const subtasks = (Array.isArray(raw) ? (raw as unknown[]) : []).map((s0) => mapTree(s0, task.id, depth + 1));
    if (!subtasks.length) return { ...task, subtasks: undefined };
    const latest = subtasks.reduce((m, x) => (x.end > m ? x.end : m), "");
    const end = task.end < latest ? latest : task.end;
    const open = subtasks.some((x) => x.status !== "Done");
    const status = task.status === "Done" && open ? "In progress" : task.status;
    return { ...task, end, start: task.isMilestone ? end : task.start, status, progress: rollupProgress(subtasks), subtasks };
  };

  const workstreams = d.workstreams.map((w0: unknown, i: number) => {
    const w = (w0 ?? {}) as Loose;
    return {
      id: claim(w.id, "workstream"),
      name: str(w.name || "Untitled workstream", 60),
      color: /^#[0-9a-f]{6}$/i.test(String(w.color))
        ? String(w.color).toLowerCase()
        : PALETTE[i % PALETTE.length],
      owner: str(w.owner, 80),
      goal: str(w.goal, 400),
      createdAt: stamp(w.createdAt),
      tasks: (Array.isArray(w.tasks) ? (w.tasks as unknown[]) : []).map((t0) => mapTree(t0, null, 0)),
    };
  });

  const taskIds = new Set(workstreams.flatMap((w) => w.tasks.map((t) => t.id)));
  for (const w of workstreams)
    for (const t of w.tasks)
      t.dependsOn = [...new Set(t.dependsOn)].filter(
        (x) => x !== t.id && taskIds.has(x),
      );

  const people = [...new Set((Array.isArray(d.people) ? (d.people as unknown[]) : []).map((n) => str(n, 80).trim()).filter(Boolean))];

  // History rows are copied as-is (they describe tasks that may no longer exist), so only their shape is checked.
  const eventIds = new Set<string>();
  const history = (Array.isArray(d.history) ? (d.history as unknown[]) : []).map((e0, i) => {
    const e = (e0 ?? {}) as Loose;
    const id = String(e.id ?? ""), at = stamp(e.at), type = EVENT_TYPES.find((x) => x === e.type);
    if (!Id.safeParse(id).success || !at || !type || eventIds.has(id)) throw new ImportError(`History entry ${i + 1} is invalid or duplicated`);
    eventIds.add(id);
    return {
      id, type, at, taskId: str(e.taskId, 100), taskName: str(e.taskName, 140), workstreamId: str(e.workstreamId, 100),
      workstreamName: str(e.workstreamName, 60), owner: str(e.owner, 80), actor: e.actor == null ? null : str(e.actor, 80), note: str(e.note, 400),
    };
  });
  return { workstreams, people, history };
}

export type NormalizedImport = ReturnType<typeof normalizeImport>;
