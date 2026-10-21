import { avg, effOf, findTask, type Filters, anyFilter, matches } from "@/lib/dashboard";
import { fmt, toDay } from "@/lib/date";
import { md } from "@/lib/md";
import { wsVars } from "@/lib/palette";
import type { Task, Workstream } from "@/lib/schemas";
import { effStatus, STATUSES, STATUS_META } from "@/lib/status";
import { EmptyState, ProgressBar, StatusBadge } from "./ui";
import { SubtaskList, type SubActions } from "./Subtasks";

export function TaskArticle({ ws, t, all, today, canEdit, owners = [], subActions }: {
  ws: Workstream; t: Task; all: Workstream[]; today: number; canEdit: boolean; owners?: string[]; subActions?: SubActions;
}) {
  const s = toDay(t.start), e = toDay(t.end), es = effOf(t, today);
  const nSubs = t.subtasks?.length ?? 0;
  const deps = t.dependsOn.map((id) => findTask(all, id)).filter(Boolean).map((x) => x!.t.name).join(", ");
  return (
    <article className="task c-ws" id={`task-${t.id}`} tabIndex={-1} style={wsVars(ws.color)}>
      <div className="task-top">
        <h4>{t.isMilestone && <><span className="ms-mark" aria-label="Milestone">◆</span>{" "}</>}{t.name}</h4>
        <StatusBadge status={es.status} />{es.auto && <span className="auto-note">{t.subtasks?.some((x) => effStatus(x, today).status === "Delayed") && toDay(t.end) >= today ? "auto-flagged: a subtask is delayed" : "auto-flagged: end date passed"}</span>}
        <span className="pct" title={nSubs ? `Average of ${nSubs} subtask${nSubs === 1 ? "" : "s"}` : undefined}>{t.progress}%</span>
      </div>
      <div className="task-meta">
        <span><span className="lbl">Owner</span> {t.owner || "—"}</span>
        <span><span className="lbl">{t.isMilestone ? "Due" : "Dates"}</span> {t.isMilestone ? fmt(e) : `${fmt(s)} → ${fmt(e)} (${e - s + 1} days)`}</span>
        {deps && <span><span className="lbl">Depends on</span> {deps}</span>}
      </div>
      <ProgressBar variant="mini" value={t.progress} label={`${t.name} progress`} />
      <div className="desc">{md(t.description)}</div>
      <SubtaskList parent={t} owners={owners} today={today} canEdit={canEdit} actions={subActions} />
      {canEdit && <div className="task-actions"><button className="btn sm" type="button" data-edit={t.id}>Edit task &amp; description</button></div>}
    </article>
  );
}

export function WorkstreamCard({ ws, vis, all, today, open, canEdit, owners, subActions }: {
  ws: Workstream; vis: Task[]; all: Workstream[]; today: number; open: boolean; canEdit: boolean; owners?: string[]; subActions?: SubActions;
}) {
  const p = avg(vis.map((t) => t.progress));
  const cnt: Record<string, number> = {};
  vis.forEach((t) => { const s = effOf(t, today).status; cnt[s] = (cnt[s] || 0) + 1; });
  const cntStr = STATUSES.filter((s) => cnt[s]).map((s) => `${STATUS_META[s].icon} ${cnt[s]} ${s.toLowerCase()}`).join(" · ");
  return (
    <section className="ws-card c-ws" id={`ws-${ws.id}`} style={wsVars(ws.color)} aria-label={ws.name}>
      <div className="ws-head">
        <div className="ws-toggle" style={{ cursor: "default" }}>
          <span><h3><span className="swatch" />{ws.name}</h3><p className="goal">{ws.goal}</p></span>
        </div>
        <div className="ws-stats">
          <div className="row"><span>Owner: <b>{ws.owner || "—"}</b></span><b>{p}%</b></div>
          <ProgressBar variant="pbar" value={p} label={`${ws.name} overall progress`} />
          {/* count matches the list shown (bug 5) */}
          <div>{vis.length} tasks{cntStr ? " · " + cntStr : ""}</div>
        </div>
        {canEdit && (
          <div className="ws-actions">
            <button className="btn sm" type="button" data-add={ws.id}>+ Task</button>
            <button className="btn sm" type="button" data-edit-ws={ws.id}>Edit</button>
          </div>
        )}
      </div>
      <div className="ws-body" id={`wsb-${ws.id}`} hidden={!open}>
        {vis.length ? vis.map((t) => <TaskArticle key={t.id} ws={ws} t={t} all={all} today={today} canEdit={canEdit} owners={owners} subActions={subActions} />) : <EmptyState>No tasks yet.</EmptyState>}
      </div>
    </section>
  );
}

export function DetailsSection({ workstreams, filters, today, openCards, canEdit }: {
  workstreams: Workstream[]; filters: Filters; today: number; openCards: string[]; canEdit: boolean;
}) {
  const active = anyFilter(filters);
  const cards = workstreams.flatMap((ws) => {
    if (filters.ws && ws.id !== filters.ws) return [];
    const vis = ws.tasks.filter((t) => matches(filters, ws, t, today));
    return !vis.length && active ? [] : [{ ws, vis }];
  });
  const allOpen = workstreams.length > 0 && workstreams.every((w) => openCards.includes(w.id)); // [].every() is true (bug 4)
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Workstream details</h2>
          <p>What each team is doing, why, what&apos;s blocking it and what happens next.</p>
        </div>
        <div className="controls">
          {canEdit && <button className="btn" type="button" id="btnAddWs">+ Add workstream</button>}
          <button className="btn" type="button" id="btnExpandAll">{allOpen ? "Collapse all" : "Expand all"}</button>
        </div>
      </div>
      <div className="cards" id="cards">
        {cards.length
          ? cards.map(({ ws, vis }) => <WorkstreamCard key={ws.id} ws={ws} vis={vis} all={workstreams} today={today} open={openCards.includes(ws.id)} canEdit={canEdit} />)
          : <EmptyState panel>{active ? "No workstreams match these filters." : "No workstreams yet."}</EmptyState>}
      </div>
    </>
  );
}
