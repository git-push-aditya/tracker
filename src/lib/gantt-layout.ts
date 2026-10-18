// Pure geometry for the Gantt, ported from refer.html renderGantt(): time range, header tiers,
// row positions, dependency arrow paths. Components only render what this returns.
import { addMonths, MON, monthStart, parts, quarterStart, toDay } from "./date";
import { avg } from "./dashboard";
import type { Task, Workstream } from "./schemas";
import { effStatus } from "./status";

export const ZOOM_PX = { week: 30, month: 8, quarter: 2.6 } as const;
export type Zoom = keyof typeof ZOOM_PX;
export const ROW_H = 44;
export const GROUP_H = 40;

export type Cell = { s: number; e: number; l: string; we?: boolean; center?: boolean };

export function timeRange(tasks: Pick<Task, "start" | "end">[], today: number, zoom: Zoom) {
  let lo = today, hi = today;
  for (const t of tasks) { lo = Math.min(lo, toDay(t.start)); hi = Math.max(hi, toDay(t.end)); }
  return zoom === "quarter"
    ? { start: quarterStart(lo - 7), end: addMonths(quarterStart(hi + 45), 3) }
    : { start: monthStart(lo - 7), end: addMonths(monthStart(hi + 30), 1) };
}

export function headerTiers(start: number, end: number, zoom: Zoom) {
  const top: Cell[] = [], bot: Cell[] = [];
  if (zoom === "quarter") {
    for (let d = start; d < end; d = addMonths(d, 3)) { const p = parts(d); top.push({ s: d, e: addMonths(d, 3), l: `Q${Math.floor(p.m / 3) + 1} ${p.y}` }); }
    for (let d = start; d < end; d = addMonths(d, 1)) bot.push({ s: d, e: addMonths(d, 1), l: MON[parts(d).m] });
  } else {
    for (let d = start; d < end; d = addMonths(d, 1)) { const p = parts(d); top.push({ s: d, e: addMonths(d, 1), l: `${MON[p.m]} ${p.y}` }); }
    if (zoom === "week") {
      for (let d = start; d < end; d++) { const p = parts(d); bot.push({ s: d, e: d + 1, l: String(p.d), we: p.w === 0 || p.w === 6, center: true }); }
    } else {
      let d = start + ((8 - parts(start).w) % 7); // first Monday
      if (d > start) bot.push({ s: start, e: d, l: "" });
      for (; d < end; d += 7) bot.push({ s: d, e: Math.min(d + 7, end), l: String(parts(d).d) });
    }
  }
  return { top, bot };
}

// Arrow from a prerequisite's right edge to the dependent's left edge: a straight elbow when there is room,
// otherwise it detours half a row above/below the dependent.
export function arrowPath(a: { xe: number; y: number }, b: { xs: number; y: number }) {
  const x1 = a.xe, y1 = a.y, x2 = b.xs - 2, y2 = b.y;
  if (x2 - 10 >= x1 + 8) return `M${x1} ${y1} H${x1 + 8} V${y2} H${x2}`;
  const ym = y2 + (y2 > y1 ? -ROW_H / 2 : ROW_H / 2);
  return `M${x1} ${y1} H${x1 + 8} V${ym} H${x2 - 10} V${y2} H${x2}`;
}

export type GroupRow = { kind: "group"; ws: Workstream; vis: Task[]; p: number; collapsed: boolean; sum: { left: number; width: number } | null };
export type TaskRow = {
  kind: "task"; ws: Workstream; t: Task; es: ReturnType<typeof effStatus>;
  left: number; w: number; cx: number; // bar: left/w; milestone: cx
};
export type GanttLayout = ReturnType<typeof layoutGantt>;

export function layoutGantt(a: {
  workstreams: Workstream[]; zoom: Zoom; today: number; collapsed: string[];
  wsFilter?: string; anyFilter?: boolean; visible?: (ws: Workstream, t: Task) => boolean;
}) {
  const { workstreams, zoom, today, collapsed } = a;
  const visible = a.visible ?? (() => true);
  const px = ZOOM_PX[zoom];
  const { start, end } = timeRange(workstreams.flatMap((w) => w.tasks), today, zoom); // all tasks: stable while filtering
  const W = Math.round((end - start) * px);
  const X = (d: number) => (d - start) * px;
  const { top, bot } = headerTiers(start, end, zoom);

  const rows: (GroupRow | TaskRow)[] = [];
  const pos: Record<string, { y: number; xs: number; xe: number }> = {};
  const shown: Task[] = [];
  let y = 0;
  for (const ws of workstreams) {
    if (a.wsFilter && ws.id !== a.wsFilter) continue;
    const vis = ws.tasks.filter((t) => visible(ws, t));
    if (!vis.length && a.anyFilter) continue;
    const isCollapsed = collapsed.includes(ws.id);
    const p = avg(vis.map((t) => t.progress)); // count and % describe the same (filtered) set
    let sum: GroupRow["sum"] = null;
    if (vis.length) {
      const s = Math.min(...vis.map((t) => toDay(t.start))), e = Math.max(...vis.map((t) => toDay(t.end)));
      sum = { left: X(s), width: Math.max(4, X(e + 1) - X(s)) };
    }
    rows.push({ kind: "group", ws, vis, p, collapsed: isCollapsed, sum });
    y += GROUP_H;
    if (isCollapsed) continue;
    for (const t of vis) {
      const s = toDay(t.start), e = toDay(t.end);
      const es = effStatus(t, today);
      if (t.isMilestone) {
        const cx = X(e + 0.5);
        pos[t.id] = { y: y + ROW_H / 2, xs: cx - 11, xe: cx + 11 };
        rows.push({ kind: "task", ws, t, es, left: 0, w: 0, cx });
      } else {
        const left = X(s), w = Math.max(4, X(e + 1) - X(s));
        pos[t.id] = { y: y + ROW_H / 2, xs: left, xe: left + w };
        rows.push({ kind: "task", ws, t, es, left, w, cx: 0 });
      }
      shown.push(t);
      y += ROW_H;
    }
  }

  const paths = shown.flatMap((t) => t.dependsOn.flatMap((dep) => (pos[dep] && pos[t.id] ? [arrowPath(pos[dep], pos[t.id])] : [])));
  return {
    px, start, end, W, X, top, bot, rows, paths, height: y,
    todayIn: today >= start && today < end,
    weekends: zoom === "week" ? bot.filter((u) => u.we).map((u) => X(u.s)) : [],
  };
}
