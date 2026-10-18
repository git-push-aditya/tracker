"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type Event = { id: string; type: "COMPLETED" | "DELETED"; at: string; taskName: string; workstreamName: string; owner: string; actor: string | null; note: string };
type Page = { demo?: boolean; events: Event[]; nextCursor: string | null; workstreams: { id: string; name: string }[]; owners: string[] };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-muted-foreground font-normal">{label}</Label>
      <Select value={value} onValueChange={onChange}>
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
  const q = useInfiniteQuery({
    queryKey: ["history", ws, owner, type],
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
    staleTime: 0,
    refetchOnMount: "always",
  });
  const first = q.data?.pages[0];
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];
  // options come from the unfiltered log, but the first page of a filtered query only reports the same lists, so they stay stable
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      <p className="text-muted-foreground text-sm">Every task that was completed or deleted, newest first</p>
      <Card className="mt-6 gap-0 py-0 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
          <Filter label="Workstream" value={ws} onChange={setWs} options={(first?.workstreams ?? []).map((w) => [w.id, w.name])} />
          <Filter label="Owner" value={owner} onChange={setOwner} options={(first?.owners ?? []).map((o) => [o, o])} />
          <Filter label="Status" value={type} onChange={setType} options={[["COMPLETED", "Completed"], ["DELETED", "Deleted"]]} />
          <span className="text-muted-foreground ml-auto text-sm">{events.length}{q.hasNextPage ? "+" : ""} event{events.length === 1 ? "" : "s"}</span>
        </div>
        <CardContent className="p-0">
          {first?.demo ? <p className="text-muted-foreground p-10 text-center text-sm">History needs the database; this is demo mode.</p>
            : q.isError ? <p className="text-destructive p-10 text-center text-sm" role="alert">Couldn&apos;t load the history.</p>
            : !q.data ? <p className="text-muted-foreground p-10 text-center text-sm">Loading…</p>
            : events.length ? (
              <Table>
                <TableHeader className="bg-muted/60">
                  <TableRow><TableHead className="pl-6">When</TableHead><TableHead>Status</TableHead><TableHead>Task</TableHead><TableHead>Workstream</TableHead><TableHead>Owner</TableHead><TableHead className="pr-6">By</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-muted-foreground pl-6 whitespace-nowrap">{when(e.at)}</TableCell>
                      <TableCell><Badge variant={e.type === "DELETED" ? "destructive" : "secondary"}>{e.type === "DELETED" ? "Deleted" : "Completed"}</Badge></TableCell>
                      <TableCell className="font-medium">{e.taskName}{e.note && <div className="text-muted-foreground text-xs font-normal">{e.note}</div>}</TableCell>
                      <TableCell>{e.workstreamName}</TableCell>
                      <TableCell className="text-muted-foreground">{e.owner || "—"}</TableCell>
                      <TableCell className="text-muted-foreground pr-6">{e.actor ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="text-muted-foreground p-10 text-center text-sm">Nothing here yet.</p>}
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
