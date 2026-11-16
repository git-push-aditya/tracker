"use client";
import { ArrowUpRight, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toDay } from "@/lib/date";
import { effStatus, STATUSES } from "@/lib/status";
import { canHaveChildren } from "@/lib/subtasks";
import type { Subtask, Task } from "@/lib/schemas";
import { OwnerSelect } from "./OwnerSelect";
import { Button } from "./ui/button";
import { ProgressBar } from "./ui";

// What a subtask row can do. `parent` is the row's direct parent (at any depth). `save` gets the changed fields;
// the board validates (due date vs ancestors) and persists.
export type SubActions = {
  save: (sub: Subtask, patch: Partial<Subtask>, parent: Task) => void;
  promote: (sub: Subtask, parent: Task) => void;
  remove: (sub: Subtask, parent: Task) => void;
};

// Typing a percentage commits on blur / Enter, not per keystroke (each commit is a save).
function Pct({ sub, onCommit }: { sub: Subtask; onCommit: (n: number) => void }) {
  const [v, setV] = useState(String(sub.progress));
  const commit = () => {
    const n = Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
    setV(String(n));
    if (n !== sub.progress) onCommit(n);
  };
  return (
    <input type="number" min={0} max={100} className="sub-input pct-in" aria-label={`Progress of ${sub.name}`} value={v}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
  );
}

type RowsProps = { parent: Task; depth: number; owners: string[]; today: number; canEdit: boolean; actions?: SubActions; folded: string[]; fold: (id: string) => void };

// The subtasks of `parent`, each followed by its own subtasks (indented) unless folded. `depth`: of these rows (1 = subtask).
function Rows({ parent, depth, owners, today, canEdit, actions, folded, fold }: RowsProps) {
  const set = (s: Subtask, patch: Partial<Subtask>) => actions?.save(s, patch, parent);
  return (parent.subtasks ?? []).map((s) => {
    const es = effStatus(s, today, s.subtasks);
    const kids = s.subtasks ?? [];
    const open = kids.filter((k) => k.status !== "Done").length;
    const shut = folded.includes(s.id);
    return (
      <div key={s.id} className="sub-node">
        <div className="sub-row" id={`task-${s.id}`} tabIndex={-1} style={{ "--depth": depth - 1 } as React.CSSProperties}>
          <div className="sub-name">
            {kids.length > 0 && (
              <button type="button" className="sub-fold" aria-expanded={!shut} onClick={() => fold(s.id)}
                aria-label={`${shut ? "Show" : "Hide"} ${kids.length} subtask${kids.length === 1 ? "" : "s"} of ${s.name}`}>
                {shut ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
            {canEdit
              ? <button type="button" className="sub-link" data-edit={s.id} title="Edit name & description">{s.name}</button>
              : <span>{s.name}</span>}
            {kids.length > 0 && <span className="subs-count">{kids.length - open}/{kids.length} done</span>}
            {es.auto && <span className="auto-note">{toDay(s.end) < today ? "overdue" : "a subtask is delayed"}</span>}
          </div>
          {canEdit ? (
            <>
              <select className="sub-input" aria-label={`Status of ${s.name}`} value={s.status}
                onChange={(e) => { const status = e.target.value as Subtask["status"]; set(s, status === "Done" ? { status, progress: 100 } : { status }); }}>
                {STATUSES.map((x) => (
                  <option key={x} value={x} disabled={x === "Done" && open > 0}>{x}{x === "Done" && open > 0 ? ` (${open} not done)` : ""}</option>
                ))}
              </select>
              {kids.length > 0
                ? <span className="sub-pct" title={`Average of ${kids.length} subtask${kids.length === 1 ? "" : "s"}`}>{s.progress}%</span>
                : <span className="sub-pct"><Pct key={s.progress} sub={s} onCommit={(n) => set(s, n < 100 && s.status === "Done" ? { progress: n, status: "In progress" } : { progress: n })} />%</span>}
              <div className="sub-owner"><OwnerSelect value={s.owner} owners={owners} onChange={(owner) => owner !== s.owner && set(s, { owner })} /></div>
              <input type="date" className="sub-input" aria-label={`Due date of ${s.name}`} value={s.end}
                onChange={(e) => e.target.value && e.target.value !== s.end && set(s, { end: e.target.value, ...(s.isMilestone ? { start: e.target.value } : {}) })} />
              <span className="sub-actions">
                {canHaveChildren(depth) && (
                  <Button type="button" variant="ghost" size="icon-sm" title="Add a subtask" aria-label={`Add a subtask to ${s.name}`} data-add-sub={s.id}><Plus /></Button>
                )}
                <Button type="button" variant="ghost" size="icon-sm" title={depth > 1 ? `Move up a level (into "${parent.name}"'s parent)` : "Extract as a task"}
                  aria-label={depth > 1 ? `Move ${s.name} up a level` : `Extract ${s.name} as a task`} onClick={() => actions?.promote(s, parent)}><ArrowUpRight /></Button>
                <Button type="button" variant="ghost" size="icon-sm" title="Delete subtask" aria-label={`Delete ${s.name}`} onClick={() => actions?.remove(s, parent)}><Trash2 /></Button>
              </span>
            </>
          ) : (
            <>
              <span>{es.status}</span><span className="sub-pct">{s.progress}%</span>
              <span className="sub-owner-ro">{s.owner || "—"}</span><span>{s.end}</span><span />
            </>
          )}
        </div>
        {kids.length > 0 && !shut && <Rows parent={s} depth={depth + 1} owners={owners} today={today} canEdit={canEdit} actions={actions} folded={folded} fold={fold} />}
      </div>
    );
  });
}

export function SubtaskList({ parent, owners, today, canEdit, actions }: {
  parent: Task; owners: string[]; today: number; canEdit: boolean; actions?: SubActions;
}) {
  const [folded, setFolded] = useState<string[]>([]);
  const fold = (id: string) => setFolded((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const subs = parent.subtasks ?? [];
  const done = subs.filter((s) => s.status === "Done").length;
  if (!subs.length && !canEdit) return null;
  return (
    <div className="subs">
      <div className="subs-head">
        <b>Subtasks</b>
        {subs.length > 0 && <span className="subs-count">{done} of {subs.length} done</span>}
      </div>
      <Rows parent={parent} depth={1} owners={owners} today={today} canEdit={canEdit} actions={actions} folded={folded} fold={fold} />
      {subs.length > 0 && <ProgressBar variant="mini" value={parent.progress} label={`${parent.name} progress from subtasks`} />}
      {canEdit && <div className="task-actions"><button className="btn sm" type="button" data-add-sub={parent.id}>+ Add subtask</button></div>}
    </div>
  );
}
