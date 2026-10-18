import { PALETTE } from "./palette";
import { Id, isValidIso, type DashboardData } from "./schemas";
import { STATUSES } from "./status";

// Plain Error so this module works in the browser too (the import route maps it to a 400).
export class ImportError extends Error {}

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
type Loose = Record<string, unknown>;
const today = () => new Date().toISOString().slice(0, 10);

// Lenient like refer.html's normalize(): defaults, clamped progress, repaired dates, palette fallback.
// Also repairs what the DB CHECK constraints require (milestone start=end, Done=100%).
// Rejects duplicate ids; drops dependencies on missing tasks.
export function normalizeImport(raw: unknown): DashboardData {
  const d = raw as { workstreams?: unknown } | null;
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
      tasks: (Array.isArray(w.tasks) ? (w.tasks as unknown[]) : []).map(
        (t0) => {
          const t = (t0 ?? {}) as Loose;
          const isMilestone = !!t.isMilestone;
          const start0 =
            typeof t.start === "string" && isValidIso(t.start)
              ? t.start
              : today();
          let end =
            typeof t.end === "string" && isValidIso(t.end) ? t.end : start0;
          if (end < start0) end = start0;
          const status = STATUSES.find((x) => x === t.status) ?? "Not started";
          return {
            id: claim(t.id, "task"),
            name: str(t.name || "Untitled task", 140),
            owner: str(t.owner, 80),
            start: isMilestone ? end : start0,
            end,
            progress:
              status === "Done"
                ? 100
                : Math.max(
                    0,
                    Math.min(100, Math.round(Number(t.progress) || 0)),
                  ),
            status,
            isMilestone,
            dependsOn: Array.isArray(t.dependsOn)
              ? (t.dependsOn as unknown[]).map(String)
              : [],
            description: String(t.description ?? ""),
          };
        },
      ),
    };
  });

  const taskIds = new Set(workstreams.flatMap((w) => w.tasks.map((t) => t.id)));
  for (const w of workstreams)
    for (const t of w.tasks)
      t.dependsOn = [...new Set(t.dependsOn)].filter(
        (x) => x !== t.id && taskIds.has(x),
      );
  return { workstreams };
}
