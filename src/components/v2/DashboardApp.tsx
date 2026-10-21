"use client";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDashboard, useDeleteTask, useDeleteTaskKeepSubtasks, useDeleteWorkstream, useImport, usePromoteSubtask, useSaveSubtask, useSaveTask, useSaveWorkstream } from "@/hooks/useDashboard";
import { ACTORS_KEY, useActors } from "@/hooks/v2/useActors";
import { useMe } from "@/hooks/useMe";
import { useTheme } from "@/hooks/useTheme";
import { useToday } from "@/hooks/useToday";
import { useUiState, type Ui } from "@/hooks/useUiState";
import { allTasks, anyFilter, findTask, matches, NO_FILTERS, taskOwners, type Filters } from "@/lib/dashboard";
import { parentChangeError, rollupProgress } from "@/lib/subtasks";
import { buildTask, uid, type TaskForm, type WorkstreamValues } from "@/lib/dashboard-ops";
import { fmt, iso, parts, toDay } from "@/lib/date";
import { layoutGantt } from "@/lib/gantt-layout";
import { normalizeImport } from "@/lib/import";
import { can } from "@/lib/auth-rules";
import { api } from "@/lib/api";
import type { Subtask, Task, Workstream } from "@/lib/schemas";
import { onToast } from "@/lib/toast";
import { AttentionList } from "./Attention";
import { WorkstreamCard } from "./Details";
import type { SubActions } from "./Subtasks";
import { DeleteParentDialog, TaskDialog, type SubDraft, WorkstreamDialog } from "./Dialogs";
import { Footer } from "./Footer";
import { FilterBar, Gantt, GanttPanel, GanttScroll, GanttToolbar, Legend, Tooltip } from "./Gantt";
import { History } from "./History";
import { Header } from "./Header";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";
import { TopBar } from "./TopBar";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { StatsBar } from "./StatsBar";
import { DemoBanner, EmptyState, ErrorPanel, Toast } from "./ui";

type Dlg = { kind: "task"; id: string | null; wsId?: string; parentId?: string; n: number } | { kind: "ws"; id: string | null; n: number } | { kind: "delete"; id: string; n: number } | null;

const todayLabel = (today: number) => {
  const d = new Date(today * 86400000);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
  return `${f({ weekday: "long" })} ${parts(today).d} ${f({ month: "long" })} ${parts(today).y}`;
};

export function DashboardApp() {
  const today = useToday();
  const q = useDashboard();
  const { ui, setUi, loaded } = useUiState();
  const theme = useTheme();
  const me = useMe();

  if (today === null || !loaded || !me.ready || (!q.data && !q.isError)) return <div className="wrap" />;
  if (!q.data)
    return (
      <div className="wrap">
        <ErrorPanel onRetry={() => void q.refetch()} />
      </div>
    );
  return (
    <Board source={q.data.source} workstreams={q.data.workstreams} today={today} ui={ui} setUi={setUi} theme={theme} me={me}
      reset={async () => { await q.refetch(); }} />
  );
}

function Board({ source, workstreams, today, ui, setUi, theme, me, reset }: {
  source: "demo" | "db"; workstreams: Workstream[]; today: number; ui: Ui; setUi: (p: (u: Ui) => Partial<Ui>) => void;
  theme: ReturnType<typeof useTheme>; me: ReturnType<typeof useMe>; reset: () => Promise<void>;
}) {
  const saveTask = useSaveTask(), saveSub = useSaveSubtask(), promoteSub = usePromoteSubtask(), deleteTask = useDeleteTask(), deleteKeep = useDeleteTaskKeepSubtasks(), saveWs = useSaveWorkstream(), deleteWs = useDeleteWorkstream(), importData = useImport();
  const demo = source === "demo";
  const qc = useQueryClient();
  const canEdit = can(me.permissions, "task:update");
  const path = usePathname(), router = useRouter();
  const wsId = path.startsWith("/v2/ws/") ? decodeURIComponent(path.split("/")[3] ?? "") : null;
  const view = wsId !== null ? "ws" : path.startsWith("/v2/settings") ? "settings" : path.startsWith("/v2/history") ? "history" : "dashboard";
  const wasDash = useRef(true);

  /* ---------- filters: options follow the data; a selection that no longer exists resets ---------- */
  const [picked, setPicked] = useState<Filters>(NO_FILTERS);
  const owners = taskOwners(workstreams);
  const filters: Filters = {
    ws: workstreams.some((w) => w.id === picked.ws) ? picked.ws : "",
    owner: owners.includes(picked.owner) ? picked.owner : "",
    status: picked.status,
  };

  // The history log only grows when a task is completed or deleted here, so that is the only time it is refetched.
  const people = useActors(workstreams, demo);
  // a save, an import or a delete can add (or free up) people
  const refreshActors = () => void qc.invalidateQueries({ queryKey: ACTORS_KEY });
  const refreshHistory = () => void qc.invalidateQueries({ queryKey: ["history"] });

  /* ---------- toast ---------- */
  const [toastMsg, setToastMsg] = useState("");
  const [toastShow, setToastShow] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = (msg: string) => {
    setToastMsg(msg); setToastShow(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastShow(false), 2600);
  };

  useEffect(() => onToast(toast)); // toasts raised outside React (query/mutation error handlers)

  /* ---------- scrolling ---------- */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const toTodayRef = useRef(true);
  const [, bump] = useState(0);
  const seq = useRef(0); // unique key per dialog open, so forms remount with fresh defaults
  const requestToday = () => { toTodayRef.current = true; bump((n) => n + 1); };

  const layout = layoutGantt({
    workstreams, zoom: ui.zoom, today, collapsed: ui.collapsed, expanded: ui.expanded, wsFilter: filters.ws, anyFilter: anyFilter(filters),
    visible: (ws, t) => matches(filters, ws, t, today),
  });

  useLayoutEffect(() => {
    // initial load, zoom change, "Jump to today", import, reset: put today ~30% from the left
    const el = scrollerRef.current;
    if (view === "dashboard" && !wasDash.current) toTodayRef.current = true; // gantt was unmounted on another tab
    wasDash.current = view === "dashboard";
    if (!toTodayRef.current || !el) return;
    toTodayRef.current = false;
    const labelW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--label-w")) || 270;
    el.scrollLeft = Math.max(0, layout.X(today) - (el.clientWidth - labelW) * 0.3);
  });

  const dataRef = useRef(workstreams);
  useEffect(() => { dataRef.current = workstreams; });
  const pendingRef = useRef<string | null>(null);
  function scrollToTask(id: string, inWs?: string) {
    const ws = inWs ?? findTask(dataRef.current, id)?.ws.id;
    if (ws && path !== `/v2/ws/${ws}`) router.push(`/v2/ws/${ws}`); // task cards live on the workstream tab
    pendingRef.current = id;
    bump((n) => n + 1); // render even if nothing else changed; the effect below does the scrolling
  }
  useEffect(() => {
    const el = pendingRef.current && document.getElementById("task-" + pendingRef.current);
    if (!el) return;
    pendingRef.current = null;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
    // fallback for browsers/embeds where smooth scrolling doesn't run
    setTimeout(() => { const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ behavior: "instant", block: "center" }); }, 900);
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  });

  /* ---------- tooltip ---------- */
  const tipRef = useRef<HTMLDivElement>(null);
  const tipPos = useRef({ x: 0, y: 0 });
  const [tip, setTip] = useState({ id: "", show: false });
  const placeTip = () => {
    const el = tipRef.current; if (!el) return;
    const { x, y } = tipPos.current, r = el.getBoundingClientRect();
    let lx = x + 14, ly = y + 16;
    if (lx + r.width > innerWidth - 8) lx = Math.max(8, x - r.width - 14);
    if (ly + r.height > innerHeight - 8) ly = Math.max(8, y - r.height - 14);
    el.style.left = lx + "px"; el.style.top = ly + "px";
  };
  useLayoutEffect(() => { if (tip.show) placeTip(); }, [tip]);
  const showTip = (id: string, x: number, y: number) => {
    tipPos.current = { x, y };
    if (tip.show && tip.id === id) placeTip(); else setTip({ id, show: true });
  };
  const hideTip = () => setTip((t) => (t.show ? { ...t, show: false } : t));
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { hideTip(); setFull(false); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  /* ---------- dialogs ---------- */
  const [dlg, setDlg] = useState<Dlg>(null);
  // In db mode a just-created row still has a temporary id until the save + refetch finish, so don't edit yet.
  const busy = () => {
    if (source === "db" && qc.isMutating() > 0) { toast("Saving… try again in a moment"); return true; }
    return false;
  };
  const openTask = (id: string | null, wsId?: string, parentId?: string) => {
    if (busy()) return;
    if (!workstreams.length) { toast("Add a workstream first."); setDlg({ kind: "ws", id: null, n: ++seq.current }); return; }
    setDlg({ kind: "task", id, wsId: wsId ?? (filters.ws || workstreams[0]?.id), parentId, n: ++seq.current });
  };

  /* ---------- subtasks ---------- */
  // Saves a subtask. A due date after the parent's is refused by the server, so offer to extend the parent first.
  async function persistSub(sub: Subtask, parent: Task, isNew: boolean) {
    const pf = findTask(workstreams, parent.id);
    if (sub.end > parent.end && pf) {
      if (!confirm(`"${sub.name}" is due ${fmt(toDay(sub.end))}, after "${parent.name}" (${fmt(toDay(parent.end))}). Extend "${parent.name}" to ${fmt(toDay(sub.end))}?`)) return;
      const task = { ...parent, end: sub.end, start: parent.isMilestone ? sub.end : parent.start };
      try { await saveTask.mutateAsync({ task, wsId: pf.ws.id, isNew: false }); } catch { return; }
    }
    saveSub.mutateAsync({ sub: { ...sub, parentId: parent.id }, parentId: parent.id, isNew }).then(() => { refreshActors(); if (sub.status === "Done") refreshHistory(); }, () => {});
  }
  // inline edits use the cached updatedAt, so wait for an earlier save to settle rather than 409 on ourselves
  const subActions: SubActions = {
    save: (sub, patch, parent) => { if (!busy()) void persistSub({ ...sub, ...patch }, parent, false); },
    remove: (sub, parent) => {
      if (busy()) return;
      if (!confirm(`Delete subtask "${sub.name}"? ${parent.name}'s progress will be recalculated.`)) return;
      deleteTask.mutateAsync(sub.id).then(refreshHistory, () => {}); toast("Subtask deleted");
    },
    promote: (sub, parent) => {
      if (busy()) return;
      const rest = (parent.subtasks ?? []).filter((x) => x.id !== sub.id);
      const effect = rest.length ? `${parent.name} progress changes from ${parent.progress}% to ${rollupProgress(rest)}%.` : `${parent.name} will have no subtasks left.`;
      if (!confirm(`Move "${sub.name}" out of "${parent.name}" and make it a task? Its dates and details stay as they are. ${effect}`)) return;
      promoteSub.mutateAsync(sub.id).then(() => { toast("Now a task"); if (view === "ws") scrollToTask(sub.id); }, () => {});
    },
  };
  const openWs = (id: string | null) => !busy() && setDlg({ kind: "ws", id, n: ++seq.current });

  function onSaveTask(f: TaskForm & { wsId: string; subs?: SubDraft[] }) {
    const r = buildTask(f);
    if ("error" in r) return r.error;
    if (dlg?.kind === "task" && dlg.parentId && !dlgParent) return "That parent task no longer exists."; // deleted while this was open
    if (dlgParent) { // a subtask: saved under its parent, whose workstream it shares
      const sub: Subtask = { ...r.task, parentId: dlgParent.id, dependsOn: [] };
      setDlg(null);
      toast(f.id ? "Subtask updated" : "Subtask added");
      void persistSub(sub, dlgParent, !f.id);
      return;
    }
    if (editTask?.subtasks?.length) { // a parent: Done and the due date are limited by its subtasks
      const err = parentChangeError(editTask.subtasks, { status: r.task.status, end: r.task.end });
      if (err) return err;
    }
    const bad = (f.subs ?? []).find((x) => x.name.trim() && x.end && (x.end > r.task.end || x.end < r.task.start));
    if (bad) return `"${bad.name.trim()}" must end between ${r.task.start} and ${r.task.end}.`;
    setDlg(null);
    toast(f.id ? "Task updated" : "Task added");
    // resolves to the final id (assigned by the server in db mode), after the refetch
    const kids = (f.subs ?? []).filter((x) => x.name.trim());
    saveTask.mutateAsync({ task: r.task, wsId: f.wsId, isNew: !f.id }).then(async (id) => {
      // one at a time: each save re-reads the parent, so parallel saves would race on its rollup
      for (const k of kids) {
        const sub: Subtask = { id: uid("t"), name: k.name.trim(), owner: k.owner, start: r.task.start, end: k.end || r.task.end, progress: 0, status: "Not started", isMilestone: false, dependsOn: [], description: "", parentId: id };
        try { await saveSub.mutateAsync({ sub, parentId: id, isNew: true }); } catch { break; }
      }
      refreshActors(); if (f.status === "Done") refreshHistory(); if (view === "ws") scrollToTask(id, f.wsId);
    }, () => {});
  }
  function onDeleteTask(id: string) {
    const f = findTask(workstreams, id); if (!f) return;
    if (f.t.subtasks?.length) return setDlg({ kind: "delete", id, n: ++seq.current }); // ask what happens to the subtasks
    if (!confirm(`Delete "${f.t.name}"? This can't be undone (unless you have an exported backup).`)) return;
    deleteTask.mutateAsync(id).then(refreshHistory, () => {}); setDlg(null); toast("Task deleted");
  }
  function onDeleteParent(id: string, keep: boolean) {
    if (busy()) return;
    (keep ? deleteKeep : deleteTask).mutateAsync(id).then(refreshHistory, () => {});
    setDlg(null); toast(keep ? "Task deleted, subtasks kept" : "Task and subtasks deleted");
  }
  function onSaveWs(v: WorkstreamValues, id: string | null) {
    if (!v.name) return "Please give the workstream a name.";
    saveWs.mutateAsync({ values: v, id: id ?? undefined }).then(refreshActors, () => {}); setDlg(null);
    toast(id ? "Workstream updated" : "Workstream added");
  }
  function onDeleteWs(id: string) {
    const ws = workstreams.find((w) => w.id === id); if (!ws) return;
    if (!confirm(`Delete the "${ws.name}" workstream and its ${ws.tasks.length} tasks?`)) return;
    deleteWs.mutateAsync(id).then(refreshHistory, () => {}); setDlg(null); toast("Workstream deleted");
  }

  /* ---------- export / import / reset ---------- */
  function exportJson() {
    const blob = new Blob([JSON.stringify({ workstreams }, (k, v) => (k === "updatedAt" ? undefined : v), 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `prime-care-dashboard-${iso(today)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Exported JSON");
  }
  async function importFile(file: File) {
    let d;
    try { d = normalizeImport(JSON.parse(await file.text())); }
    catch { alert("That file isn't valid dashboard JSON. It needs a top-level \"workstreams\" array."); return; }
    if (!confirm(`Replace the current data with ${d.workstreams.length} workstreams from "${file.name}"?`)) return;
    importData.mutateAsync(d.workstreams).then(() => { refreshHistory(); refreshActors(); }, () => {}); requestToday(); toast("Imported " + file.name);
  }
  async function resetSample() {
    if (!confirm("Replace all current data with the built-in sample data? Export first if you want to keep your changes.")) return;
    await reset(); requestToday(); toast("Sample data restored");
  }

  async function logout() {
    try { await api("POST", "/api/auth/logout"); } catch {}
    qc.clear();
    // hard navigation: Next keeps visited routes mounted (hidden), which would leave this user's data in the page
    window.location.assign("/login"); // eslint-disable-line @next/next/no-location-assign-relative-destination
  }

  /* ---------- delegated events (same data-attributes as refer.html) ---------- */
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  function onClick(e: React.MouseEvent) {
    const hit = (s: string) => (e.target as HTMLElement).closest<HTMLElement>(s);
    let el: HTMLElement | null;
    if ((el = hit("[data-toggle-ws]"))) return setUi((u) => ({ collapsed: toggle(u.collapsed, el!.dataset.toggleWs!) }));
    if ((el = hit("[data-edit]"))) return openTask(el.dataset.edit!);
    if ((el = hit("[data-task]"))) { hideTip(); return scrollToTask(el.dataset.task!); }
    if ((el = hit("[data-scroll]"))) return scrollToTask(el.dataset.scroll!);
    if ((el = hit("[data-zoom]"))) { toTodayRef.current = true; return setUi(() => ({ zoom: el!.dataset.zoom as Ui["zoom"] })); }
    if ((el = hit("[data-add]"))) return openTask(null, el.dataset.add);
    if ((el = hit("[data-add-sub]"))) return openTask(null, undefined, el.dataset.addSub);
    if ((el = hit("[data-toggle-task]"))) return setUi((u) => ({ expanded: toggle(u.expanded, el!.dataset.toggleTask!) }));
    if ((el = hit("[data-edit-ws]"))) return openWs(el.dataset.editWs!);
    const id = hit("button[id]")?.id;
    if (id === "btnToday") return requestToday();
    if (id === "btnFullGantt") return setFull((f) => !f);
    if (id === "btnCollapseGantt") {
      const all = workstreams.length > 0 && workstreams.every((w) => ui.collapsed.includes(w.id));
      return setUi(() => ({ collapsed: all ? [] : workstreams.map((w) => w.id) }));
    }
    if (id === "btnClearFilters") return setPicked(NO_FILTERS);
    if (id === "btnAddTask") return openTask(null);
    if (id === "btnAddWs") return openWs(null);
    if (id === "btnExport") return exportJson();
    if (id === "btnImport") return document.getElementById("fileImport")?.click();
    if (id === "btnTheme") return theme.cycle();
    if (id === "btnReset") return void resetSample();
    if (id === "btnLogout") return void logout();
  }

  const tasks = allTasks(workstreams);
  const shown = tasks.filter(({ ws, t }) => matches(filters, ws, t, today)).length;
  const delTask = dlg?.kind === "delete" ? findTask(workstreams, dlg.id)?.t : undefined;
  const found = dlg?.kind === "task" && dlg.id ? findTask(workstreams, dlg.id) : null;
  const editTask = found?.t ?? null;
  // set when the dialog is for a subtask (new: from the "+ Add subtask" button; existing: found under its parent)
  const dlgParent = dlg?.kind === "task" ? found?.parent ?? (dlg.parentId ? findTask(workstreams, dlg.parentId)?.t : undefined) ?? null : null;
  const editWs = dlg?.kind === "ws" && dlg.id ? workstreams.find((w) => w.id === dlg.id) ?? null : null;

  const curWs = view === "ws" ? workstreams.find((w) => w.id === wsId) : undefined;
  return (
    <>
      <SidebarProvider className="bg-sidebar md:h-svh md:overflow-hidden" onClick={onClick}
        onChange={(e) => {
          const t = e.target as HTMLInputElement;
          if (t.id === "fileImport" && t.files?.[0]) { void importFile(t.files[0]); t.value = ""; }
        }}>
        <Sidebar workstreams={workstreams} path={path} user={me.user} themeLabel={theme.label}
          canCreate={can(me.permissions, "workstream:create")} onLogout={() => void logout()} onPickTask={(id, ws) => scrollToTask(id, ws)} />
        <SidebarInset className="bg-[var(--side-card)] md:h-[calc(100svh-1rem)] md:min-h-0 md:overflow-y-auto md:border md:border-[var(--side-card-border)] md:peer-data-[variant=inset]:rounded-2xl">
        <TopBar view={view} wsName={curWs?.name} />
        <main className="wrap">
          {demo && <DemoBanner />}
          {view === "dashboard" && (
            <>
              <Header todayLabel={todayLabel(today)} todayIso={iso(today)} canEdit={canEdit} />
              <StatsBar workstreams={workstreams} today={today} />
              <GanttPanel full={full}>
                <GanttToolbar full={full} zoom={ui.zoom} allCollapsed={workstreams.length > 0 && workstreams.every((w) => ui.collapsed.includes(w.id))} />
                <FilterBar workstreams={workstreams} owners={owners} filters={filters} shown={shown} total={tasks.length}
                  onChange={(k, v) => setPicked({ ...filters, [k]: v })} />
                <GanttScroll ref={scrollerRef}
                  onMouseMove={(e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-task]"); if (b) showTip(b.dataset.task!, e.clientX, e.clientY); else hideTip(); }}
                  onMouseLeave={hideTip} onBlur={hideTip} onScroll={hideTip}
                  onFocus={(e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-task]"); if (b) { const r = b.getBoundingClientRect(); showTip(b.dataset.task!, r.left, r.bottom); } }}>
                  <Gantt layout={layout} today={today} canEdit={canEdit} hasFilter={anyFilter(filters)} totalTasks={tasks.length} />
                </GanttScroll>
                <Legend workstreams={workstreams} />
              </GanttPanel>
              <AttentionList workstreams={workstreams} today={today} canEdit={canEdit} />
              <Footer demo={demo} />
            </>
          )}
          {view === "ws" && (curWs
            ? <div className="ws-page"><WorkstreamCard ws={curWs} vis={curWs.tasks} all={workstreams} today={today} open canEdit={canEdit} owners={people} subActions={subActions} /></div>
            : <EmptyState panel>Workstream not found.</EmptyState>)}
          {view === "history" && <History />}
          {view === "settings" && <Settings workstreams={workstreams} user={me.user} demo={demo} permissions={me.permissions} />}
        </main>
        </SidebarInset>
      </SidebarProvider>
      <Tooltip workstreams={workstreams} today={today} taskId={tip.id || undefined} show={tip.show} ref={tipRef} />
      <Toast message={toastMsg} show={toastShow} />
      {canEdit && dlg?.kind === "task" && (
        <TaskDialog key={dlg.n} workstreams={workstreams} owners={people} task={editTask} parent={dlgParent} wsId={dlg.wsId} today={today}
          onSave={onSaveTask} onDelete={() => dlg.id && onDeleteTask(dlg.id)} onClose={() => setDlg(null)} />
      )}
      {canEdit && dlg?.kind === "delete" && delTask && (
        <DeleteParentDialog key={dlg.n} task={delTask} onDeleteAll={() => onDeleteParent(dlg.id, false)} onKeepSubtasks={() => onDeleteParent(dlg.id, true)} onClose={() => setDlg(null)} />
      )}
      {canEdit && dlg?.kind === "ws" && (
        <WorkstreamDialog key={dlg.n} workstreams={workstreams} owners={people} ws={editWs}
          onSave={(v) => onSaveWs(v, dlg.id)} onDelete={() => dlg.id && onDeleteWs(dlg.id)} onClose={() => setDlg(null)} />
      )}
    </>
  );
}
