import type { CSSProperties } from "react";
import { fmt, fmtShort, toDay } from "@/lib/date";
import { anyFilter, findTask, type Filters } from "@/lib/dashboard";
import type { Cell, GanttLayout, GroupRow, TaskRow, Zoom } from "@/lib/gantt-layout";
import { plain } from "@/lib/md";
import { wsVars } from "@/lib/palette";
import type { Task, Workstream } from "@/lib/schemas";
import { effStatus, STATUSES, STATUS_META } from "@/lib/status";
import { Chevron, EmptyState, StatusBadge } from "./ui";

const css = (v: Record<string, string | number>) => v as CSSProperties;

/* ---------- toolbar + filters ---------- */
export function GanttToolbar({ zoom, allCollapsed }: { zoom: Zoom; allCollapsed: boolean }) {
  return (
    <div className="panel-head">
      <h2 id="ganttTitle"><span className="live-dot" aria-hidden="true" />Live roadmap</h2>
      <div className="controls">
        <div className="seg" role="group" aria-label="Zoom level" id="zoomSeg">
          {(["week", "month", "quarter"] as const).map((z) => (
            <button key={z} type="button" data-zoom={z} aria-pressed={z === zoom}>{z[0].toUpperCase() + z.slice(1)}</button>
          ))}
        </div>
        <button className="btn" type="button" id="btnToday">Jump to today</button>
        <button className="btn" type="button" id="btnCollapseGantt">{allCollapsed ? "Expand all" : "Collapse all"}</button>
      </div>
    </div>
  );
}

export function FilterBar({ workstreams, owners, filters, shown, total, onChange }: {
  workstreams: Workstream[]; owners: string[]; filters: Filters; shown: number; total: number;
  onChange: (key: keyof Filters, value: string) => void;
}) {
  const active = anyFilter(filters);
  return (
    <div className="filters" role="group" aria-label="Filters">
      <label>Workstream{" "}
        <select className="select" id="fWs" value={filters.ws} onChange={(e) => onChange("ws", e.target.value)}>
          <option value="">All</option>
          {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>
      <label>Owner{" "}
        <select className="select" id="fOwner" value={filters.owner} onChange={(e) => onChange("owner", e.target.value)}>
          <option value="">All</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
      <label>Status{" "}
        <select className="select" id="fStatus" value={filters.status} onChange={(e) => onChange("status", e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].icon + " " + s}</option>)}
        </select>
      </label>
      {active && <button className="btn ghost sm" type="button" id="btnClearFilters">Clear filters</button>}
      <span id="filterCount" style={{ marginLeft: "auto" }}>{active ? `Showing ${shown} of ${total} tasks` : ""}</span>
    </div>
  );
}

/* ---------- header + overlay ---------- */
function TierCell({ u, kind, X }: { u: Cell; kind: "top" | "bot"; X: GanttLayout["X"] }) {
  return <div className={`tc ${kind}${u.center ? " center" : ""}`} style={{ left: X(u.s), width: X(u.e) - X(u.s) }}>{u.l}</div>;
}

export function GanttHeader({ layout, today }: { layout: GanttLayout; today: number }) {
  const { top, bot, X, W, todayIn } = layout;
  return (
    <div className="g-head">
      <div className="g-corner">Workstream / task</div>
      <div className="g-tiers" style={{ width: W }}>
        {top.map((u) => <TierCell key={"t" + u.s} u={u} kind="top" X={X} />)}
        {bot.map((u) => <TierCell key={"b" + u.s} u={u} kind="bot" X={X} />)}
        {todayIn && <div className="today-pill" style={{ left: X(today + 0.5) }}>TODAY</div>}
      </div>
    </div>
  );
}

export function DependencyArrows({ paths, W, height }: { paths: string[]; W: number; height: number }) {
  return (
    <svg className="deps" width={W} height={height} aria-hidden="true">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10z" style={{ fill: "var(--muted)" }} />
        </marker>
      </defs>
      <g style={{ fill: "none", stroke: "var(--muted)", strokeWidth: 1.5 }} markerEnd="url(#arr)">
        {paths.map((d, i) => <path key={i} markerEnd="url(#arr)" d={d} />)}
      </g>
    </svg>
  );
}

export function GanttOverlay({ layout, today }: { layout: GanttLayout; today: number }) {
  const { X, W, px, top, bot, weekends, todayIn, paths, height } = layout;
  return (
    <div className="g-overlay" style={{ width: W }}>
      {weekends.map((x) => <div key={"w" + x} className="weekend" style={{ left: x, width: px }} />)}
      {bot.map((u) => <div key={"b" + u.s} className="gl" style={{ left: X(u.s) }} />)}
      {top.map((u) => <div key={"t" + u.s} className="gl strong" style={{ left: X(u.s) }} />)}
      {todayIn && <div className="today-line" style={{ left: X(today + 0.5) }} title="Today" />}
      <DependencyArrows paths={paths} W={W} height={height} />
    </div>
  );
}

/* ---------- rows ---------- */
export function GanttGroupRow({ row, W }: { row: GroupRow; W: number }) {
  const { ws, vis, p, collapsed, sum } = row;
  return (
    <div className="g-row group c-ws" style={wsVars(ws.color)}>
      <div className="g-label">
        <button type="button" className="g-group-btn" data-toggle-ws={ws.id} aria-expanded={!collapsed}
          aria-label={`${ws.name}: ${vis.length} tasks, ${p}% complete. ${collapsed ? "Expand" : "Collapse"}`}>
          <Chevron />
          <span className="swatch" /><span className="nm">{ws.name}</span><span className="ct">{vis.length} · {p}%</span>
        </button>
      </div>
      <div className="g-track" style={{ width: W }}>
        {sum && <div className="sumbar" style={{ left: sum.left, width: sum.width }} aria-hidden="true"><span style={{ width: `${p}%` }} /></div>}
      </div>
    </div>
  );
}

function Flag({ status }: { status: string }) {
  if (status === "At risk") return <span className="flag-risk">⚠ At risk</span>;
  if (status === "Delayed") return <span className="flag-delay">⏱ Delayed</span>;
  if (status === "Done") return <span style={{ color: "var(--good-ink)", fontWeight: 650 }}>✓ Done</span>;
  return null;
}

export function BarMeta({ row }: { row: TaskRow }) {
  const { t, es, left, w, cx } = row;
  const s = toDay(t.start), e = toDay(t.end);
  const owner = t.owner ? ` · ${t.owner}` : ""; // no stray "· ·" without an owner (bug 6)
  return t.isMilestone ? (
    <div className="meta" style={{ left: cx + 10 }}><Flag status={es.status} /><b>◆ {fmtShort(e)}</b>{owner}</div>
  ) : (
    <div className="meta" style={{ left: left + w }}><Flag status={es.status} /><b>{t.progress}%</b>{`${owner} · ${fmtShort(s)} – ${fmtShort(e)}`}</div>
  );
}

const outline = (status: string) => `${status === "At risk" ? " risk" : ""}${status === "Delayed" ? " delay" : ""}`;

function ariaOf(t: Task, status: string) {
  return `${t.name}, ${t.owner || "no owner"}, ${fmt(toDay(t.start))} to ${fmt(toDay(t.end))}, ${t.progress}% complete, ${status}. Show details`;
}

export function TaskBar({ row }: { row: TaskRow }) {
  const { t, es, left, w } = row;
  return (
    <button type="button" className={`bar${outline(es.status)}`} data-task={t.id} style={{ left, width: w }} aria-label={ariaOf(t, es.status)}>
      <span className="fill" style={{ width: `${t.progress}%` }} />
    </button>
  );
}

export function MilestoneDiamond({ row }: { row: TaskRow }) {
  const { t, es, cx } = row;
  return (
    <button type="button" className={`ms${es.status === "Done" ? " done" : ""}${es.status === "Delayed" ? " delay" : ""}`}
      data-task={t.id} style={{ left: cx }} aria-label={"Milestone: " + ariaOf(t, es.status)} />
  );
}

// canEdit → label opens the editor; view-only → label scrolls to the task's card
export function GanttTaskRow({ row, W, canEdit }: { row: TaskRow; W: number; canEdit: boolean }) {
  const { ws, t, es } = row;
  const label = canEdit
    ? { "data-edit": t.id, title: `Edit "${t.name}"`, "aria-label": `Edit task ${t.name}` }
    : { "data-scroll": t.id, title: `Show details for "${t.name}"`, "aria-label": `Show details for ${t.name}` };
  return (
    <div className="g-row c-ws" style={wsVars(ws.color)}>
      <div className="g-label">
        <button type="button" className="g-task-btn" {...label}>
          <span className="nm">{t.isMilestone && <span className="ms-mark" aria-hidden="true">◆ </span>}{t.name}</span>
          <span className="sub"><StatusBadge status={es.status} /><span className="owner">{t.owner}</span></span>
        </button>
      </div>
      <div className="g-track" style={{ width: W }}>
        {t.isMilestone ? <MilestoneDiamond row={row} /> : <TaskBar row={row} />}
        <BarMeta row={row} />
      </div>
    </div>
  );
}

export function Gantt({ layout, today, canEdit, hasFilter, totalTasks }: {
  layout: GanttLayout; today: number; canEdit: boolean; hasFilter: boolean; totalTasks: number;
}) {
  return (
    <div className="gantt" id="gantt" style={{ width: `calc(var(--label-w) + ${layout.W}px)` }}>
      <GanttHeader layout={layout} today={today} />
      {layout.rows.length ? (
        <div className="g-body">
          <GanttOverlay layout={layout} today={today} />
          {layout.rows.map((r) =>
            r.kind === "group"
              ? <GanttGroupRow key={"g" + r.ws.id} row={r} W={layout.W} />
              : <GanttTaskRow key={r.t.id} row={r} W={layout.W} canEdit={canEdit} />)}
        </div>
      ) : (
        // no data at all ≠ filtered to nothing (bug 3)
        <EmptyState>{hasFilter && totalTasks ? "No tasks match these filters." : "No tasks yet."}</EmptyState>
      )}
    </div>
  );
}

export function Legend({ workstreams }: { workstreams: Workstream[] }) {
  return (
    <div className="legend" id="legend">
      {workstreams.map((w) => <span key={w.id}><i className="c-ws" style={wsVars(w.color)} />{w.name}</span>)}
      <span><i className="dia" />Milestone</span>
      <span>
        <svg width="22" height="8" aria-hidden="true"><path d="M0 4H16" stroke="currentColor" strokeWidth="1.5" /><path d="M15 0l6 4-6 4z" fill="currentColor" /></svg>
        Dependency
      </span>
      <span><i style={css({ "--c": "var(--today)", width: 2, height: 12 })} />Today</span>
      <span>Filled part of a bar = % complete</span>
    </div>
  );
}

// Tooltip content for one task. The parent positions it (imperatively, after measuring) via `ref`.
export function Tooltip({ workstreams, taskId, today, show, ref }: {
  workstreams: Workstream[]; taskId?: string; today: number; show: boolean; ref?: React.Ref<HTMLDivElement>;
}) {
  const f = taskId ? findTask(workstreams, taskId) : null;
  if (!f) return <div className="tip" id="tip" role="tooltip" ref={ref} />;
  const { ws, t } = f;
  const s = toDay(t.start), e = toDay(t.end), es = effStatus(t, today);
  const deps = t.dependsOn.map((d) => findTask(workstreams, d)).filter(Boolean).map((d) => d!.t.name).join(", ");
  return (
    <div className={`tip${show ? " show" : ""}`} id="tip" role="tooltip" ref={ref}>
      <h4>{t.isMilestone ? "◆ " : ""}{t.name}</h4>
      <div className="ws"><span className="swatch c-ws" style={wsVars(ws.color)} />{ws.name}</div>
      <dl>
        <dt>Owner</dt><dd>{t.owner || "—"}</dd>
        <dt>{t.isMilestone ? "Due" : "Start"}</dt><dd>{t.isMilestone ? fmt(e) : fmt(s)}</dd>
        {!t.isMilestone && <><dt>End</dt><dd>{fmt(e)} · {e - s + 1} days</dd></>}
        <dt>Progress</dt><dd>{t.progress}%</dd>
        <dt>Status</dt><dd><StatusBadge status={es.status} />{es.auto && <> <span className="auto-note">overdue</span></>}</dd>
        {deps && <><dt>Depends on</dt><dd>{deps}</dd></>}
      </dl>
      {t.description && <div className="excerpt">{plain(t.description, 170)}</div>}
      <div className="hint">Click to see full details below</div>
    </div>
  );
}

export function GanttPanel({ children }: { children: React.ReactNode }) {
  return <section className="panel" aria-labelledby="ganttTitle">{children}</section>;
}

export function GanttScroll({ children, ...rest }: React.ComponentProps<"div">) {
  return <div className="gantt-scroll" id="ganttScroll" tabIndex={0} aria-label="Gantt chart, scroll horizontally to see the timeline" {...rest}>{children}</div>;
}
