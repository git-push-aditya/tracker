"use client";
import { ArrowUpRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { effStatus, STATUSES } from "@/lib/status";
import type { Subtask, Task } from "@/lib/schemas";
import { OwnerSelect } from "./OwnerSelect";
import { Button } from "./ui/button";
import { ProgressBar } from "./ui";

// What a subtask row can do. `save` gets the changed fields; the board validates (due date vs parent) and persists.
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

export function SubtaskList({ parent, owners, today, canEdit, actions }: {
  parent: Task; owners: string[]; today: number; canEdit: boolean; actions?: SubActions;
}) {
  const subs = parent.subtasks ?? [];
  const done = subs.filter((s) => s.status === "Done").length;
  if (!subs.length && !canEdit) return null;
  const set = (s: Subtask, patch: Partial<Subtask>) => actions?.save(s, patch, parent);
  return (
    <div className="subs">
      <div className="subs-head">
        <b>Subtasks</b>
        {subs.length > 0 && <span className="subs-count">{done} of {subs.length} done</span>}
      </div>
      {subs.map((s) => {
        const es = effStatus(s, today);
        return (
          <div className="sub-row" id={`task-${s.id}`} key={s.id} tabIndex={-1}>
            <div className="sub-name">
              {canEdit
                ? <button type="button" className="sub-link" data-edit={s.id} title="Edit name & description">{s.name}</button>
                : <span>{s.name}</span>}
              {es.auto && <span className="auto-note">overdue</span>}
            </div>
            {canEdit ? (
              <>
                <select className="sub-input" aria-label={`Status of ${s.name}`} value={s.status}
                  onChange={(e) => { const status = e.target.value as Subtask["status"]; set(s, status === "Done" ? { status, progress: 100 } : { status }); }}>
                  {STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                <span className="sub-pct"><Pct key={s.progress} sub={s} onCommit={(n) => set(s, n < 100 && s.status === "Done" ? { progress: n, status: "In progress" } : { progress: n })} />%</span>
                <div className="sub-owner"><OwnerSelect value={s.owner} owners={owners} onChange={(owner) => owner !== s.owner && set(s, { owner })} /></div>
                <input type="date" className="sub-input" aria-label={`Due date of ${s.name}`} value={s.end}
                  onChange={(e) => e.target.value && e.target.value !== s.end && set(s, { end: e.target.value, ...(s.isMilestone ? { start: e.target.value } : {}) })} />
                <span className="sub-actions">
                  <Button type="button" variant="ghost" size="icon-sm" title="Extract as a task" aria-label={`Extract ${s.name} as a task`} onClick={() => actions?.promote(s, parent)}><ArrowUpRight /></Button>
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
        );
      })}
      {subs.length > 0 && <ProgressBar variant="mini" value={parent.progress} label={`${parent.name} progress from subtasks`} />}
      {canEdit && <div className="task-actions"><button className="btn sm" type="button" data-add-sub={parent.id}>+ Add subtask</button></div>}
    </div>
  );
}
