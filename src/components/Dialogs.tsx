"use client";
import { useEffect, useRef, useState } from "react";
import { iso } from "@/lib/date";
import type { TaskForm, WorkstreamValues } from "@/lib/dashboard-ops";
import { PALETTE } from "@/lib/palette";
import type { Task, Workstream } from "@/lib/schemas";
import { STATUSES } from "@/lib/status";

export function OwnerList({ owners }: { owners: string[] }) {
  return <datalist id="ownerList">{owners.map((o) => <option key={o} value={o} />)}</datalist>;
}

export function ColorChips({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="chips" id="wChips">
      {PALETTE.map((c) => (
        <button key={c} type="button" data-color={c} style={{ "--c": c } as React.CSSProperties} aria-pressed={c === value}
          aria-label={`Colour ${c}`} onClick={() => onChange(c)} />
      ))}
      <input type="color" id="wColor" value={value} aria-label="Custom colour" onChange={(e) => onChange(e.target.value.toLowerCase())} />
    </div>
  );
}

// Mount = open. Unmount (parent sets its state to null) = closed. Esc / ✕ / Cancel call onClose.
function useModal(onClose: () => void, focusId: string) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    document.getElementById(focusId)?.focus();
  }, [focusId]);
  // Cancel/✕ unmount straight away; Esc relies on the dialog's own `close` event (setting state to null twice is harmless).
  return { ref, dialogProps: { onClose }, close: () => { ref.current?.close(); onClose(); } };
}

const CloseX = ({ onClick }: { onClick: () => void }) => (
  <button className="btn ghost sm" type="button" data-close aria-label="Close" onClick={onClick}>✕</button>
);

export function TaskDialog({ workstreams, task, wsId, today, onSave, onDelete, onClose }: {
  workstreams: Workstream[]; task: Task | null; wsId?: string; today: number;
  onSave: (f: TaskForm & { wsId: string }) => string | void; // returns an error message to show
  onDelete: () => void; onClose: () => void;
}) {
  const { ref, dialogProps, close } = useModal(onClose, "tName");
  const edit = !!task;
  const t: Task = task ?? { id: "", name: "", owner: "", start: iso(today), end: iso(today + 14), progress: 0, status: "Not started", isMilestone: false, dependsOn: [], description: "" };
  const curWs = (task && workstreams.find((w) => w.tasks.some((x) => x.id === task.id))?.id) || wsId || workstreams[0]?.id;
  const [milestone, setMilestone] = useState(t.isMilestone);
  const [progress, setProgress] = useState(String(t.progress));
  const [status, setStatus] = useState<string>(t.status);
  const [err, setErr] = useState("");

  return (
    <dialog id="taskDlg" aria-labelledby="taskDlgTitle" ref={ref} {...dialogProps}>
      <form id="taskForm" noValidate onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "");
        setErr(onSave({
          id: t.id, wsId: v("wsId"), name: v("name"), owner: v("owner"), start: v("start"), end: v("end"), status,
          progress, isMilestone: milestone, dependsOn: f.getAll("dependsOn").map(String), description: v("description"),
        }) ?? "");
      }}>
        <div className="dlg-head"><h3 id="taskDlgTitle">{edit ? "Edit task" : "Add task"}</h3><CloseX onClick={close} /></div>
        <div className="dlg-body">
          <label className="field full">Task name<input id="tName" name="name" required maxLength={140} defaultValue={t.name} /></label>
          <label className="field">Workstream
            <select id="tWs" name="wsId" defaultValue={curWs}>{workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </label>
          <label className="field">Owner<input id="tOwner" name="owner" list="ownerList" maxLength={80} defaultValue={t.owner} /></label>
          <label className="field" style={milestone ? { display: "none" } : undefined}>Start date<input type="date" id="tStart" name="start" required defaultValue={t.start} /></label>
          <label className="field">{milestone ? "Milestone date" : "End date"}<input type="date" id="tEnd" name="end" required defaultValue={t.end} /></label>
          <label className="field">Status
            <select id="tStatus" value={status} onChange={(e) => { setStatus(e.target.value); if (e.target.value === "Done") setProgress("100"); }}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <div className="field">Progress
            <div className="range-row">
              <input type="range" id="tProgress" min={0} max={100} step={5} aria-label="Progress percent" value={progress} onChange={(e) => setProgress(e.target.value)} />
              <input type="number" id="tProgressNum" min={0} max={100} aria-label="Progress percent value" value={progress} onChange={(e) => setProgress(e.target.value)} />
            </div>
          </div>
          <label className="field check full"><input type="checkbox" id="tMilestone" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} /> Milestone (shown as a diamond on the end date)</label>
          <div className="field full" role="group" aria-labelledby="tDepsLabel">
            <span id="tDepsLabel">Depends on <span className="help">Tick the tasks this one waits on. Draws an arrow from each prerequisite.</span></span>
            <div className="deps-list" id="tDeps">
              {workstreams.every((w) => w.tasks.every((x) => x.id === t.id)) && <span className="help">No other tasks yet.</span>}
              {workstreams.map((w) => {
                const others = w.tasks.filter((x) => x.id !== t.id);
                return others.length ? (
                  <div key={w.id} className="deps-group">
                    <div className="deps-ws">{w.name}</div>
                    {others.map((x) => (
                      <label key={x.id}><input type="checkbox" name="dependsOn" value={x.id} defaultChecked={t.dependsOn.includes(x.id)} />{x.name}</label>
                    ))}
                  </div>
                ) : null;
              })}
            </div>
          </div>
          <label className="field full">Description
            <span className="help">Blank line = new paragraph · start a line with &quot;- &quot; for a bullet · **bold**</span>
            <textarea id="tDesc" name="description" defaultValue={t.description} placeholder={"**What:** …\n\n**Why:** …\n\n**Blockers:**\n- …\n\n**Next steps:**\n- …"} />
          </label>
          <div className="err full" id="tErr" aria-live="polite">{err}</div>
        </div>
        <div className="dlg-foot">
          {edit && <button className="btn danger" type="button" id="tDelete" onClick={onDelete}>Delete task</button>}
          <span className="spacer" />
          <button className="btn" type="button" data-close onClick={close}>Cancel</button>
          <button className="btn primary" type="submit">Save</button>
        </div>
      </form>
    </dialog>
  );
}

export function WorkstreamDialog({ workstreams, ws, onSave, onDelete, onClose }: {
  workstreams: Workstream[]; ws: Workstream | null;
  onSave: (v: WorkstreamValues) => string | void; onDelete: () => void; onClose: () => void;
}) {
  const { ref, dialogProps, close } = useModal(onClose, "wName");
  const edit = !!ws;
  const used = workstreams.map((w) => w.color);
  const [color, setColor] = useState(ws ? ws.color : PALETTE.find((c) => !used.includes(c)) || PALETTE[0]); // next unused palette colour
  const [err, setErr] = useState("");

  return (
    <dialog id="wsDlg" aria-labelledby="wsDlgTitle" ref={ref} {...dialogProps}>
      <form id="wsForm" noValidate onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "").trim();
        setErr(onSave({ name: v("name"), owner: v("owner"), goal: v("goal"), color }) ?? "");
      }}>
        <div className="dlg-head"><h3 id="wsDlgTitle">{edit ? "Edit workstream" : "Add workstream"}</h3><CloseX onClick={close} /></div>
        <div className="dlg-body">
          <label className="field">Name<input id="wName" name="name" required maxLength={60} defaultValue={ws?.name ?? ""} /></label>
          <label className="field">Workstream owner<input id="wOwner" name="owner" list="ownerList" maxLength={80} defaultValue={ws?.owner ?? ""} /></label>
          <div className="field full">Colour<ColorChips value={color} onChange={setColor} /></div>
          <label className="field full">Goal / objective<textarea id="wGoal" name="goal" style={{ minHeight: 80 }} maxLength={400} defaultValue={ws?.goal ?? ""} /></label>
          <div className="err full" id="wErr" aria-live="polite">{err}</div>
        </div>
        <div className="dlg-foot">
          {edit && <button className="btn danger" type="button" id="wDelete" onClick={onDelete}>Delete workstream</button>}
          <span className="spacer" />
          <button className="btn" type="button" data-close onClick={close}>Cancel</button>
          <button className="btn primary" type="submit">Save</button>
        </div>
      </form>
    </dialog>
  );
}
