import { allTasks, avg, effOf } from "@/lib/dashboard";
import type { Workstream } from "@/lib/schemas";
import { STATUSES, type StatusLabel } from "@/lib/status";
import { ProgressBar, StatusIcon } from "./ui";

function StatTile({ k, v, sub, icon, children }: { k: string; v: string | number; sub?: string; icon?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{icon}{k}</div>
      <div className="v">{v}{sub ? <> <small>{sub}</small></> : null}</div>
      {children}
    </div>
  );
}

// Always summarises ALL data, even while filters are on.
export function StatsBar({ workstreams, today }: { workstreams: Workstream[]; today: number }) {
  const items = allTasks(workstreams);
  const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<StatusLabel, number>;
  items.forEach(({ t }) => c[effOf(t, today).status]++);
  const pct = avg(items.map((x) => x.t.progress));
  return (
    <section className="stats" id="stats" aria-label="Overall progress summary">
      <StatTile k="Total tasks" v={items.length} sub={`across ${workstreams.length} workstreams`} />
      <StatTile k="Overall complete" v={pct + "%"} sub="avg. progress">
        <ProgressBar variant="meter" value={pct} label="Overall progress" />
      </StatTile>
      <StatTile k="Done" v={c["Done"]} icon={<StatusIcon status="Done" />} />
      <StatTile k="On track" v={c["Not started"] + c["In progress"]} sub="not started / in progress" icon={<StatusIcon status="In progress" />} />
      <StatTile k="At risk" v={c["At risk"]} icon={<StatusIcon status="At risk" />} />
      <StatTile k="Delayed" v={c["Delayed"]} sub="incl. overdue" icon={<StatusIcon status="Delayed" />} />
    </section>
  );
}
