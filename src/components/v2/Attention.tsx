"use client";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { allTasks } from "@/lib/dashboard";
import { fmt, toDay } from "@/lib/date";
import { wsVars } from "@/lib/palette";
import type { Workstream } from "@/lib/schemas";
import { effStatus, type StatusLabel } from "@/lib/status";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { StatusBadge } from "./ui";

// "Overdue" is the derived Delayed status (end date passed, not Done); see effStatus.
const STATUS_OPTIONS: { key: StatusLabel; label: string }[] = [
  { key: "Delayed", label: "Overdue" },
  { key: "At risk", label: "At risk" },
  { key: "In progress", label: "In progress" },
  { key: "Not started", label: "Not started" },
  { key: "Done", label: "Done" },
];
const DAYS = [1, 2, 3, 4, 5, 6, 7];

const s = (n: number) => (n === 1 ? "" : "s");

// A task shows when its (effective) status is ticked, OR it is not done and its due date is within `days` days.
export function attentionRows(workstreams: Workstream[], today: number, statuses: StatusLabel[], days: number) {
  return allTasks(workstreams).flatMap(({ ws, t }) => {
    const { status } = effStatus(t, today);
    const left = toDay(t.end) - today;
    const byStatus = statuses.includes(status), soon = status !== "Done" && left >= 0 && left <= days;
    if (!byStatus && !soon) return [];
    const reason = status === "Delayed" && left < 0 && byStatus ? `Overdue by ${-left} day${s(-left)}`
      : soon ? (left === 0 ? "Due today" : `Due in ${left} day${s(left)}`) : status;
    return [{ ws, t, status, reason, overdue: left < 0 && status === "Delayed", left }];
  }).sort((a, b) => a.left - b.left);
}

export function AttentionList({ workstreams, today, canEdit }: { workstreams: Workstream[]; today: number; canEdit: boolean }) {
  const [statuses, setStatuses] = useState<StatusLabel[]>(["Delayed", "At risk"]);
  const [days, setDays] = useState(2);
  const [wsId, setWsId] = useState("all");
  const rows = attentionRows(workstreams, today, statuses, days).filter((r) => wsId === "all" || r.ws.id === wsId);
  const label = !statuses.length ? "Status: none" : "Status: " + STATUS_OPTIONS.filter((o) => statuses.includes(o.key)).map((o) => o.label).join(", ");
  return (
    <Card className="mt-6 gap-0 py-0 shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b py-4">
        <div className="grid gap-1.5">
          <CardTitle className="text-base">Needs attention</CardTitle>
          <CardDescription>{rows.length} task{rows.length === 1 ? "" : "s"} shown</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" type="button" aria-label="Filter by status">{label}<ChevronDown className="opacity-60" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STATUS_OPTIONS.map((o) => (
                <DropdownMenuCheckboxItem key={o.key} checked={statuses.includes(o.key)} onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) => setStatuses((cur) => (on ? [...cur, o.key] : cur.filter((x) => x !== o.key)))}>
                  {o.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger size="sm" className="w-40" aria-label="Due within"><SelectValue>Due in {days} day{days === 1 ? "" : "s"}</SelectValue></SelectTrigger>
            <SelectContent>
              {DAYS.map((d) => <SelectItem key={d} value={String(d)}>{d} day{d === 1 ? "" : "s"}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={wsId} onValueChange={setWsId}>
            <SelectTrigger size="sm" className="w-44" aria-label="Filter by workstream"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workstreams</SelectItem>
              {workstreams.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length ? (
          <Table>
            <TableHeader className="bg-muted/60">
              <TableRow>
                <TableHead className="pl-6">Task</TableHead><TableHead>Workstream</TableHead><TableHead>Owner</TableHead>
                <TableHead>Due</TableHead><TableHead>Why</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Done</TableHead>
                {canEdit && <TableHead className="pr-6" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ ws, t, status, reason, overdue }) => {
                return (
                <TableRow key={t.id}>
                  <TableCell className="pl-6 font-medium">{t.isMilestone && "◆ "}{t.name}</TableCell>
                  <TableCell>
                    <Link href={`/v2/ws/${ws.id}`} className="c-ws inline-flex items-center gap-2 hover:underline" style={wsVars(ws.color)}>
                      <span className="size-2.5 rounded-[3px] bg-[var(--c)]" />{ws.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.owner || "—"}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">{fmt(toDay(t.end))}</TableCell>
                  <TableCell><Badge variant={overdue ? "destructive" : "outline"}>{reason}</Badge></TableCell>
                  <TableCell><StatusBadge status={status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{t.progress}%</TableCell>
                  {canEdit && <TableCell className="pr-6 text-right"><Button size="sm" variant="outline" type="button" data-edit={t.id}>Edit</Button></TableCell>}
                </TableRow>
              );})}
            </TableBody>
          </Table>
        ) : <p className="text-muted-foreground p-10 text-center text-sm">Nothing matches these filters.</p>}
      </CardContent>
    </Card>
  );
}
