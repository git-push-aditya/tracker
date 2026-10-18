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

export function TaskDialog({ workstreams, owners, task, wsId, today, onSave, onDelete, onClose }: {
  workstreams: Workstream[]; owners: string[]; task: Task | null; wsId?: string; today: number;
  onSave: (f: TaskForm & { wsId: string }) => string | void; // returns an error message to show
  onDelete: () => void; onClose: () => void;
}) {
  const edit = !!task;
  const t: Task = task ?? { id: "", name: "", owner: "", start: iso(today), end: iso(today + 14), progress: 0, status: "Not started", isMilestone: false, dependsOn: [], description: "" };
  const [ws, setWs] = useState((task && workstreams.find((w) => w.tasks.some((x) => x.id === task.id))?.id) || wsId || workstreams[0]?.id || "");
  const [owner, setOwner] = useState(t.owner);
  const [milestone, setMilestone] = useState(t.isMilestone);
  const [progress, setProgress] = useState(String(t.progress));
  const [status, setStatus] = useState<string>(t.status);
  const [deps, setDeps] = useState<string[]>(t.dependsOn);
  const [err, setErr] = useState("");
  const toggleDep = (id: string, on: boolean) => setDeps((d) => (on ? [...d, id] : d.filter((x) => x !== id)));
  const pct = Math.min(100, Math.max(0, Number(progress) || 0));

  return (
    <Modal title={edit ? "Edit task" : "Add task"} onClose={onClose}>
      <form id="taskForm" noValidate className="grid gap-4" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "");
        setErr(onSave({
          id: t.id, wsId: ws, name: v("name"), owner, start: v("start"), end: v("end"), status,
          progress, isMilestone: milestone, dependsOn: deps, description: v("description"),
        }) ?? "");
      }}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Task name" full><Input name="name" required maxLength={140} defaultValue={t.name} /></Field>
          <Field label="Workstream">
            <Select value={ws} onValueChange={setWs}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{workstreams.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Owner"><OwnerSelect value={owner} onChange={setOwner} owners={owners} /></Field>
          {!milestone && <Field label="Start date"><Input type="date" name="start" required defaultValue={t.start} /></Field>}
          <Field label={milestone ? "Milestone date" : "End date"}><Input type="date" name="end" required defaultValue={t.end} /></Field>
          <Field label="Status">
            <Select value={status} onValueChange={(s) => { setStatus(s); if (s === "Done") setProgress("100"); }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].icon} {s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Progress">
            <div className="flex items-center gap-3">
              <Slider min={0} max={100} step={5} value={[pct]} onValueChange={([n]) => setProgress(String(n))} aria-label="Progress percent" />
              <Input type="number" min={0} max={100} className="w-20" aria-label="Progress percent value" value={progress} onChange={(e) => setProgress(e.target.value)} />
            </div>
          </Field>
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox id="tMilestone" checked={milestone} onCheckedChange={(c) => setMilestone(c === true)} />
            <Label htmlFor="tMilestone" className="font-normal">Milestone (shown as a diamond on the end date)</Label>
          </div>
          <Field label="Depends on" full>
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
          </Field>
          <Field label="Description" full>
            <p className="text-muted-foreground text-xs">Blank line = new paragraph · start a line with &quot;- &quot; for a bullet · **bold**</p>
            <Textarea name="description" className="min-h-40" defaultValue={t.description} placeholder={"**What:** …\n\n**Why:** …\n\n**Blockers:**\n- …\n\n**Next steps:**\n- …"} />
          </Field>
        </div>
        <p className="text-destructive text-sm" aria-live="polite">{err}</p>
        <DialogFooter className="sm:justify-between">
          {edit ? <Button variant="outline" className="text-destructive" type="button" onClick={onDelete}>Delete task</Button> : <span />}
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
