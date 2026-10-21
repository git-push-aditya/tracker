"use client";
import { useState } from "react";
import { iso } from "@/lib/date";
import type { TaskForm, WorkstreamValues } from "@/lib/dashboard-ops";
import { PALETTE } from "@/lib/palette";
import type { Task, Workstream } from "@/lib/schemas";
import { STATUSES, STATUS_META } from "@/lib/status";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OwnerSelect } from "./OwnerSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { Textarea } from "./ui/textarea";

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

const Field = ({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) => (
  <div className={full ? "col-span-2 grid gap-1.5" : "grid gap-1.5"}><Label>{label}</Label>{children}</div>
);

// Mount = open. The parent sets its dialog state to null to close; Esc / ✕ / Cancel / overlay click call onClose.
const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <Dialog open onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="max-h-[92vh] gap-4 overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{title}</DialogDescription></DialogHeader>
      {children}
    </DialogContent>
  </Dialog>
);

export type SubDraft = { name: string; owner: string; end: string }; // end "" = the parent's end

export function TaskDialog({ workstreams, owners, task, parent, wsId, today, onSave, onDelete, onClose }: {
  workstreams: Workstream[]; owners: string[]; task: Task | null; parent?: Task | null; wsId?: string; today: number; // parent: set for a subtask (new or existing)
  onSave: (f: TaskForm & { wsId: string; subs?: SubDraft[] }) => string | void; // subs: subtasks created together with a new task. returns an error message to show
  onDelete: () => void; onClose: () => void;
}) {
  const edit = !!task;
  const sub = !!parent;
  const kids = task?.subtasks ?? [];
  const openKids = kids.filter((k) => k.status !== "Done").length;
  const latestKid = kids.reduce((m, k) => (k.end > m ? k.end : m), "");
  const t: Task = task ?? (parent
    ? { id: "", name: "", owner: "", start: parent.start, end: parent.end, progress: 0, status: "Not started", isMilestone: false, dependsOn: [], description: "" }
    : { id: "", name: "", owner: "", start: iso(today), end: iso(today + 14), progress: 0, status: "Not started", isMilestone: false, dependsOn: [], description: "" });
  const [ws, setWs] = useState((task && workstreams.find((w) => w.tasks.some((x) => x.id === task.id))?.id) || wsId || workstreams[0]?.id || "");
  const [subs, setSubs] = useState<SubDraft[]>([]); // new top-level task only; an existing task adds subtasks from its details panel
  const setSub = (i: number, patch: Partial<SubDraft>) => setSubs((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const [owner, setOwner] = useState(t.owner);
  const [milestone, setMilestone] = useState(t.isMilestone);
  const [progress, setProgress] = useState(String(t.progress));
  const [status, setStatus] = useState<string>(t.status);
  const [deps, setDeps] = useState<string[]>(t.dependsOn);
  const [err, setErr] = useState("");
  const toggleDep = (id: string, on: boolean) => setDeps((d) => (on ? [...d, id] : d.filter((x) => x !== id)));
  const pct = Math.min(100, Math.max(0, Number(progress) || 0));

  return (
    <Modal title={`${edit ? "Edit" : "Add"} ${sub ? "subtask" : "task"}`} onClose={onClose}>
      <form id="taskForm" noValidate className="grid gap-4" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "");
        setErr(onSave({
          id: t.id, wsId: ws, subs: !sub && !edit ? subs : undefined, name: v("name"), owner, start: v("start"), end: v("end"), status,
          progress, isMilestone: milestone, dependsOn: deps, description: v("description"),
        }) ?? "");
      }}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Task name" full><Input name="name" required maxLength={140} defaultValue={t.name} /></Field>
          {sub && <p className="text-muted-foreground col-span-2 -mt-2 text-sm">Subtask of <b>{parent!.name}</b> · due on or before {parent!.end}</p>}
          {!sub && <Field label="Workstream">
            <Select value={ws} onValueChange={setWs}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{workstreams.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>}
          <Field label="Owner"><OwnerSelect value={owner} onChange={setOwner} owners={owners} /></Field>
          {!milestone && <Field label="Start date"><Input type="date" name="start" required defaultValue={t.start} /></Field>}
          <Field label={milestone ? "Milestone date" : "End date"}><Input type="date" name="end" required defaultValue={t.end} max={parent?.end} min={latestKid || undefined} /></Field>
          <Field label="Status">
            <Select value={status} onValueChange={(s) => { setStatus(s); if (s === "Done") setProgress("100"); }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} disabled={s === "Done" && openKids > 0}>{STATUS_META[s].icon} {s}{s === "Done" && openKids > 0 ? ` (${openKids} subtask${openKids > 1 ? "s" : ""} not done)` : ""}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Progress">
            {kids.length > 0 ? (
              <p className="text-muted-foreground text-sm">{t.progress}% · calculated from {kids.length} subtask{kids.length === 1 ? "" : "s"}</p>
            ) : (
              <div className="flex items-center gap-3">
                <Slider min={0} max={100} step={5} value={[pct]} onValueChange={([n]) => setProgress(String(n))} aria-label="Progress percent" />
                <Input type="number" min={0} max={100} className="w-20" aria-label="Progress percent value" value={progress} onChange={(e) => setProgress(e.target.value)} />
              </div>
            )}
          </Field>
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox id="tMilestone" checked={milestone} onCheckedChange={(c) => setMilestone(c === true)} />
            <Label htmlFor="tMilestone" className="font-normal">Milestone (shown as a diamond on the end date)</Label>
          </div>
          {!sub && <Field label="Depends on" full>
            <p className="text-muted-foreground text-xs">Tick the tasks this one waits on. Draws an arrow from each prerequisite.</p>
            <div className="max-h-40 overflow-y-auto rounded-md border p-2">
              {workstreams.every((w) => w.tasks.every((x) => x.id === t.id)) && <p className="text-muted-foreground p-1 text-sm">No other tasks yet.</p>}
              {workstreams.map((w) => {
                const others = w.tasks.filter((x) => x.id !== t.id);
                return others.length ? (
                  <div key={w.id} className="mb-2 last:mb-0">
                    <div className="text-muted-foreground px-1 pb-1 text-xs font-medium">{w.name}</div>
                    {others.map((x) => (
                      <label key={x.id} className="hover:bg-accent flex items-center gap-2 rounded px-1 py-1 text-sm">
                        <Checkbox checked={deps.includes(x.id)} onCheckedChange={(c) => toggleDep(x.id, c === true)} />{x.name}
                      </label>
                    ))}
                  </div>
                ) : null;
              })}
            </div>
          </Field>}
          {!sub && !edit && <Field label="Subtasks" full>
            <p className="text-muted-foreground text-xs">Optional. Each starts with this task&apos;s start date; leave the end date blank to use this task&apos;s end date.</p>
            {subs.map((x, i) => (
              <div key={i} className="grid grid-cols-[1fr_9rem_9rem_auto] items-center gap-2">
                <Input aria-label={`Subtask ${i + 1} name`} placeholder="Subtask name" maxLength={140} value={x.name} onChange={(e) => setSub(i, { name: e.target.value })} />
                <OwnerSelect value={x.owner} onChange={(o) => setSub(i, { owner: o })} owners={owners} />
                <Input type="date" aria-label={`Subtask ${i + 1} end date`} value={x.end} onChange={(e) => setSub(i, { end: e.target.value })} />
                <Button variant="ghost" size="icon-sm" type="button" aria-label={`Remove subtask ${i + 1}`} onClick={() => setSubs((l) => l.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
            <div><Button variant="outline" size="sm" type="button" onClick={() => setSubs((l) => [...l, { name: "", owner: "", end: "" }])}>+ Add subtask</Button></div>
          </Field>}
          <Field label="Description" full>
            <p className="text-muted-foreground text-xs">Blank line = new paragraph · start a line with &quot;- &quot; for a bullet · **bold**</p>
            <Textarea name="description" className="min-h-40" defaultValue={t.description} placeholder={"**What:** …\n\n**Why:** …\n\n**Blockers:**\n- …\n\n**Next steps:**\n- …"} />
          </Field>
        </div>
        <p className="text-destructive text-sm" aria-live="polite">{err}</p>
        <DialogFooter className="sm:justify-between">
          {edit ? <Button variant="outline" className="text-destructive" type="button" onClick={onDelete}>Delete {sub ? "subtask" : "task"}</Button> : <span />}
          <span className="flex gap-2">
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </span>
        </DialogFooter>
      </form>
    </Modal>
  );
}

export function WorkstreamDialog({ workstreams, owners, ws, onSave, onDelete, onClose }: {
  workstreams: Workstream[]; owners: string[]; ws: Workstream | null;
  onSave: (v: WorkstreamValues) => string | void; onDelete: () => void; onClose: () => void;
}) {
  const edit = !!ws;
  const used = workstreams.map((w) => w.color);
  const [color, setColor] = useState(ws ? ws.color : PALETTE.find((c) => !used.includes(c)) || PALETTE[0]); // next unused palette colour
  const [owner, setOwner] = useState(ws?.owner ?? "");
  const [err, setErr] = useState("");

  return (
    <Modal title={edit ? "Edit workstream" : "Add workstream"} onClose={onClose}>
      <form id="wsForm" noValidate className="grid gap-4" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "").trim();
        setErr(onSave({ name: v("name"), owner, goal: v("goal"), color }) ?? "");
      }}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><Input name="name" required maxLength={60} defaultValue={ws?.name ?? ""} /></Field>
          <Field label="Workstream owner"><OwnerSelect value={owner} onChange={setOwner} owners={owners} /></Field>
          <Field label="Colour" full><ColorChips value={color} onChange={setColor} /></Field>
          <Field label="Goal / objective" full><Textarea name="goal" className="min-h-20" maxLength={400} defaultValue={ws?.goal ?? ""} /></Field>
        </div>
        <p className="text-destructive text-sm" aria-live="polite">{err}</p>
        <DialogFooter className="sm:justify-between">
          {edit ? <Button variant="outline" className="text-destructive" type="button" onClick={onDelete}>Delete workstream</Button> : <span />}
          <span className="flex gap-2">
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </span>
        </DialogFooter>
      </form>
    </Modal>
  );
}

// Deleting a task that has subtasks: they go with it, or stay behind as standalone tasks.
export function DeleteParentDialog({ task, onDeleteAll, onKeepSubtasks, onClose }: {
  task: Task; onDeleteAll: () => void; onKeepSubtasks: () => void; onClose: () => void;
}) {
  const n = task.subtasks?.length ?? 0;
  return (
    <Modal title={`Delete "${task.name}"?`} onClose={onClose}>
      <p className="text-muted-foreground text-sm">This task has {n} subtask{n === 1 ? "" : "s"}. What should happen to {n === 1 ? "it" : "them"}?</p>
      <div className="grid gap-2">
        <Button type="button" variant="outline" className="text-destructive h-auto justify-start py-3 text-left whitespace-normal" onClick={onDeleteAll}>
          <span><b>Delete the task and its subtask{n === 1 ? "" : "s"}</b><br /><span className="text-muted-foreground font-normal">Everything is removed. This can&apos;t be undone.</span></span>
        </Button>
        <Button type="button" variant="outline" className="h-auto justify-start py-3 text-left whitespace-normal" onClick={onKeepSubtasks}>
          <span><b>Delete the task, keep the subtask{n === 1 ? "" : "s"} as standalone task{n === 1 ? "" : "s"}</b><br /><span className="text-muted-foreground font-normal">Owners, dates, status and details stay as they are.</span></span>
        </Button>
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></DialogFooter>
    </Modal>
  );
}
