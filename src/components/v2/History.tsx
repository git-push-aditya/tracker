"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Label } from "./ui/label";
import { Skeleton } from "./ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type Event = { id: string; type: "COMPLETED" | "DELETED"; at: string; taskName: string; workstreamName: string; owner: string; actor: string | null; note: string };
type Page = { demo?: boolean; events: Event[]; nextCursor: string | null };
type Options = { workstreams: { id: string; name: string }[]; owners: { id: string; name: string }[] };

function describe(e: unknown) {
  const status = e instanceof ApiError ? e.status : -1;
  if (status === 0) return "Couldn't connect to the server. Check your connection and try again.";
  if (status === 401) return "You're signed out. Sign in again to see the history.";
  if (status === 403) return "Your role isn't allowed to view the history.";
  return "Server error: something went wrong while loading the history.";
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Filter({ label, value, onChange, options, loading }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; loading?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-muted-foreground font-normal">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={loading}>
        <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map(([v, t]) => <SelectItem key={v} value={v}>{t}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// Every completed and deleted task, newest first. Filters run on the server; "Load more" pages through the rest.
export function History() {
  const [ws, setWs] = useState("all"), [owner, setOwner] = useState("all"), [type, setType] = useState("all");
  // The log only grows when a task is completed or deleted from this app, and those actions invalidate ["history"],
  // so nothing refetches on visit or window focus.
  const keep = { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
  const opts = useQuery({ queryKey: ["history", "filters"], queryFn: () => api<Options>("GET", "/api/history/filters"), ...keep });
  const q = useInfiniteQuery({
    queryKey: ["history", "events", ws, owner, type],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (ws !== "all") p.set("workstream", ws);
      if (owner !== "all") p.set("owner", owner);
      if (type !== "all") p.set("type", type);
      if (pageParam) p.set("cursor", pageParam);
      return api<Page>("GET", `/api/history?${p}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    ...keep,
  });
  const first = q.data?.pages[0];
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];
  const filtered = ws !== "all" || owner !== "all" || type !== "all";
  const clear = () => { setWs("all"); setOwner("all"); setType("all"); };
  return (
    <>
      <h1 className="font-display text-[28px] leading-[1.2] font-bold">History</h1>
      <p className="text-muted-foreground text-sm">Every task that was completed or deleted, newest first</p>
      <Card className="mt-6 gap-0 py-0 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
          <Filter label="Workstream" value={ws} onChange={setWs} options={(opts.data?.workstreams ?? []).map((w) => [w.id, w.name])} loading={opts.isPending} />
          <Filter label="Owner" value={owner} onChange={setOwner} options={(opts.data?.owners ?? []).map((o) => [o.id, o.name])} loading={opts.isPending} />
          <Filter label="Status" value={type} onChange={setType} options={[["COMPLETED", "Completed"], ["DELETED", "Deleted"]]} />
          {filtered && <Button variant="ghost" size="sm" type="button" onClick={clear}>Clear filters</Button>}
          <span className="text-muted-foreground ml-auto text-sm tabular-nums">{q.isPending ? "" : events.length}{q.hasNextPage ? "+" : ""} event{events.length === 1 ? "" : "s"}</span>
        </div>
        <CardContent className="p-0">
          {first?.demo ? <p className="text-muted-foreground p-10 text-center text-sm">History needs the database; this is demo mode.</p>
            : q.isError ? (
              <div className="grid justify-items-center gap-3 p-10 text-center" role="alert">
                <p className="text-destructive text-sm">{describe(q.error)}</p>
                <Button variant="outline" size="sm" type="button" onClick={() => void q.refetch()}>Retry</Button>
              </div>
            ) : q.isPending || events.length ? (
              <Table>
                <TableHeader className="bg-muted/60">
                  <TableRow><TableHead className="pl-6">When</TableHead><TableHead>Status</TableHead><TableHead>Task</TableHead><TableHead>Workstream</TableHead><TableHead>Owner</TableHead><TableHead className="pr-6">By</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {q.isPending && Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i} aria-hidden="true">
                      <TableCell className="pl-6"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="pr-6"><Skeleton className="h-4 w-16" /></TableCell>
                    </TableRow>
                  ))}
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-muted-foreground pl-6 font-mono text-[13px] whitespace-nowrap tabular-nums">{when(e.at)}</TableCell>
                      <TableCell><Badge variant={e.type === "DELETED" ? "destructive" : "secondary"}>{e.type === "DELETED" ? "Deleted" : "Completed"}</Badge></TableCell>
                      <TableCell className="font-medium">{e.taskName}{e.note && <div className="text-muted-foreground text-xs font-normal">{e.note}</div>}</TableCell>
                      <TableCell>{e.workstreamName}</TableCell>
                      <TableCell className="text-muted-foreground">{e.owner || "—"}</TableCell>
                      <TableCell className="text-muted-foreground pr-6">{e.actor ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : filtered ? (
              <div className="grid justify-items-center gap-3 p-10 text-center">
                <p className="text-muted-foreground text-sm">No events match these filters</p>
                <Button variant="outline" size="sm" type="button" onClick={clear}>Clear filters</Button>
              </div>
            ) : <p className="text-muted-foreground p-10 text-center text-sm">Brand new tracker — completed and deleted tasks will appear here</p>}
        </CardContent>
        {q.hasNextPage && (
          <div className="border-t p-3 text-center">
            <Button variant="outline" size="sm" type="button" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
