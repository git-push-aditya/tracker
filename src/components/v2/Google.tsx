"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, PenLine, Reply as Reply1, Send as SendIcon, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/v2-utils";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type Mail = { id: string; threadId: string; from: string; to: string; subject: string; date: string; snippet: string; unread: boolean };
type Message = { id: string; from: string; to: string; cc: string; replyTo: string; date: string; html: string | null; text: string };
type Thread = { subject: string; messages: Message[] };
type Event = { id: string; title: string; start: string; end: string; allDay: boolean; location: string; link: string; meet: string; guests: number };
type GFile = { id: string; name: string; modified: string; link: string; owner: string };

const TABS = [["mail", "Mail"], ["calendar", "Calendar"], ["docs", "Docs"], ["sheets", "Sheets"]] as const;
type Tab = (typeof TABS)[number][0];

// Gmail folders are just saved searches. "Notifications" is Gmail's Updates category.
const FOLDERS = [
  ["Inbox", "in:inbox"], ["Starred", "is:starred"], ["Sent", "in:sent"], ["Drafts", "in:drafts"],
  ["Notifications", "category:updates"], ["Promotions", "category:promotions"], ["Social", "category:social"],
  ["Archive", "-in:inbox -in:sent -in:drafts -in:spam -in:trash"], ["Spam", "in:spam"], ["Trash", "in:trash"],
] as const;
const OUTGOING = new Set(["in:sent", "in:drafts"]);

// Google data changes outside this app, so refetch on focus, but not more than once a minute (Composio free tier).
const fresh = { staleTime: 60_000, retry: false } as const;

const when = (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) => {
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleString("en-GB", opts);
};
const nameOnly = (from: string) => from.replace(/\s*<[^>]+>$/, "").replace(/^"|"$/g, "") || from;
const emailsIn = (s: string) => s.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? [];
const splitList = (s: string) => s.split(/[,;\s]+/).filter(Boolean);

function Problem({ error }: { error: unknown }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.code === "GOOGLE_NOT_CONNECTED")
    return <p className="text-muted-foreground text-sm">Not connected yet. <Link className="underline" href="/v2/settings">Connect it in Settings</Link>.</p>;
  return <p className="text-destructive text-sm" role="alert">{e?.message ?? "Something went wrong."}</p>;
}

const Rows = () => <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>;

function Search({ onSearch, placeholder, children }: { onSearch: (q: string) => void; placeholder: string; children?: React.ReactNode }) {
  return (
    <form className="mb-3 flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); onSearch(String(new FormData(e.currentTarget).get("q") ?? "").trim()); }}>
      <Input name="q" placeholder={placeholder} aria-label={placeholder} maxLength={200} />
      <Button type="submit" variant="outline">Search</Button>
      {children}
    </form>
  );
}

const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox"; // no allow-scripts, ever
const CSP = {
  blocked: "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
  images: "default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https: http:; font-src data: https:",
};

// Email HTML is untrusted. It renders in a sandboxed iframe: no scripts, no forms, can't touch our page. The CSP also
// blocks remote images and styles until asked, so senders can't track when the mail is opened (as Gmail does).
function MailBody({ m }: { m: Message }) {
  const [images, setImages] = useState(false);
  if (!m.html) return <pre className="mt-2 font-sans text-sm break-words whitespace-pre-wrap">{m.text}</pre>;
  return (
    <div className="mt-2">
      {!images && /<img|url\(/i.test(m.html) && (
        <p className="text-muted-foreground mb-2 text-xs">
          Images are hidden so the sender can&apos;t tell you opened this.{" "}
          <button type="button" className="underline" onClick={() => setImages(true)}>Show images</button>
        </p>
      )}
      <iframe
        key={String(images)} title="Email body" sandbox={SANDBOX} className="h-40 w-full rounded border bg-white"
        srcDoc={`<meta http-equiv="Content-Security-Policy" content="${images ? CSP.images : CSP.blocked}"><base target="_blank">${m.html}`}
        onLoad={(e) => { const d = e.currentTarget.contentDocument; if (d) e.currentTarget.style.height = `${d.documentElement.scrollHeight + 4}px`; }}
      />
    </div>
  );
}

// One header line of a mail form ("To", "Cc", "Subject"): label left, borderless input right, like Gmail.
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="focus-within:bg-accent/40 flex items-center gap-3 border-b px-4 py-2.5 text-sm transition-colors focus-within:shadow-[inset_2px_0_0_var(--primary)]">
      <span className="text-muted-foreground w-14 shrink-0">{label}</span>
      {children}
    </label>
  );
}
// Explicit resets: the browser's default input border/padding isn't removed globally in /v2.
const bare = "placeholder:text-muted-foreground/70 m-0 min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 shadow-none outline-none";

// Plain text only, and never retried: a lost response may still mean it was sent.
function useSend(path: string, onDone: () => void) {
  return useMutation({ mutationFn: (body: object) => api("POST", path, body), onSuccess: () => { emitToast("Sent"); onDone(); } });
}

function Compose({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [cc, setCc] = useState(false);
  const send = useSend("/api/google/mail", () => { qc.invalidateQueries({ queryKey: ["google", "mail"] }); onClose(); });
  return (
    <form className="bg-card mx-auto w-full max-w-3xl overflow-hidden rounded-xl border shadow-sm" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget), v = (k: string) => String(f.get(k) ?? "");
      send.mutate({ to: splitList(v("to")), cc: splitList(v("cc")), subject: v("subject"), body: v("body") });
    }}>
      <header className="bg-muted/50 flex items-center gap-2 border-b py-1.5 pr-1.5 pl-4">
        <PenLine className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-sm font-semibold">New message</h2>
        <Button type="button" variant="ghost" size="icon" className="ml-auto size-8" aria-label="Close" onClick={onClose}><X className="size-4" /></Button>
      </header>
      <Line label="To">
        <input name="to" required autoFocus autoComplete="email" placeholder="name@example.com, another@example.com" className={bare} />
        {!cc && <button type="button" className="text-muted-foreground hover:text-foreground text-xs font-medium" onClick={() => setCc(true)}>Cc</button>}
      </Line>
      {cc && <Line label="Cc"><input name="cc" autoFocus autoComplete="email" className={bare} /></Line>}
      <Line label="Subject"><input name="subject" maxLength={300} className={bare} /></Line>
      <textarea name="body" aria-label="Message" rows={14} maxLength={50_000} placeholder="Write your message…"
        className="placeholder:text-muted-foreground/70 m-0 block min-h-64 w-full resize-y border-0 bg-transparent px-4 py-3 align-top text-sm leading-relaxed shadow-none outline-none" />
      {send.error && <div className="px-4 pb-2"><Problem error={send.error} /></div>}
      <div className="flex items-center gap-3 border-t px-4 py-3">
        <Button type="submit" disabled={send.isPending} className="gap-2 px-5">
          <SendIcon className="size-4" aria-hidden />{send.isPending ? "Sending…" : "Send"}
        </Button>
        <span className="text-muted-foreground hidden text-xs sm:inline">Sent from your Gmail as plain text</span>
        <Button type="button" variant="ghost" size="icon" className="text-muted-foreground ml-auto" aria-label="Discard draft" onClick={onClose}><Trash2 className="size-4" /></Button>
      </div>
    </form>
  );
}

function Reply({ threadId, last }: { threadId: string; last: Message }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const send = useSend(`/api/google/mail/${threadId}`, () => { setBody(""); qc.invalidateQueries({ queryKey: ["google"] }); });
  return (
    <form className="bg-card overflow-hidden rounded-xl border shadow-sm" onSubmit={(e) => {
      e.preventDefault();
      send.mutate({ to: splitList(String(new FormData(e.currentTarget).get("to") ?? "")), body });
    }}>
      <Line label="Reply to"><input name="to" defaultValue={emailsIn(last.replyTo || last.from).join(", ")} required className={bare} /></Line>
      <textarea aria-label="Reply" rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50_000} required placeholder="Write a reply…"
        className="placeholder:text-muted-foreground/70 m-0 block w-full resize-y border-0 bg-transparent px-4 py-3 align-top text-sm leading-relaxed shadow-none outline-none" />
      {send.error && <div className="px-4 pb-2"><Problem error={send.error} /></div>}
      <div className="flex items-center border-t px-4 py-2.5">
        <Button type="submit" size="sm" className="gap-2 px-4" disabled={send.isPending || !body.trim()}>
          <Reply1 className="size-4" aria-hidden />{send.isPending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}

function ThreadView({ id, onBack }: { id: string; onBack: () => void }) {
  const thread = useQuery({ queryKey: ["google", "thread", id], ...fresh, queryFn: () => api<Thread>("GET", `/api/google/mail/${id}`) });
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
      {thread.isPending ? <Rows /> : thread.error ? <Problem error={thread.error} /> : (
        <article className="mt-2 grid gap-4">
          <h2 className="text-lg font-semibold">{thread.data.subject || "(no subject)"}</h2>
          {thread.data.messages.map((m) => (
            <section key={m.id} className="border-t pt-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm [&_dd]:break-words [&_dt]:text-muted-foreground">
                <dt>From</dt><dd><b>{m.from}</b></dd>
                <dt>To</dt><dd>{m.to}</dd>
                {m.cc && <><dt>Cc</dt><dd>{m.cc}</dd></>}
                <dt>Date</dt><dd>{when(m.date, { dateStyle: "medium", timeStyle: "short" })}</dd>
              </dl>
              <MailBody m={m} />
            </section>
          ))}
          {thread.data.messages.length > 0 && <Reply threadId={id} last={thread.data.messages.at(-1)!} />}
        </article>
      )}
    </div>
  );
}

function MailTab() {
  const [folder, setFolder] = useState<string>(FOLDERS[0][1]), [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null), [composing, setComposing] = useState(false);
  const query = `${folder} ${q}`.trim();
  const list = useInfiniteQuery({
    queryKey: ["google", "mail", query], initialPageParam: "", ...fresh,
    queryFn: ({ pageParam }) => api<{ messages: Mail[]; nextPage: string | null }>("GET", `/api/google/mail?${new URLSearchParams({ q: query, ...(pageParam && { page: pageParam }) })}`),
    getNextPageParam: (last) => last.nextPage ?? undefined,
  });
  if (composing) return <Compose onClose={() => setComposing(false)} />;
  if (open) return <ThreadView id={open} onBack={() => setOpen(null)} />;
  const mails = list.data?.pages.flatMap((p) => p.messages) ?? [];
  const outgoing = OUTGOING.has(folder);
  return (
    <div>
      <Search onSearch={setQ} placeholder="Search mail (Gmail syntax, e.g. from:alex is:unread)">
        <Button type="button" onClick={() => setComposing(true)}>Compose</Button>
      </Search>
      <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Mail folders">
        {FOLDERS.map(([label, f]) => (
          <Button key={f} role="tab" aria-selected={folder === f} size="sm" variant={folder === f ? "secondary" : "ghost"} onClick={() => setFolder(f)}>{label}</Button>
        ))}
      </div>
      {list.isPending ? <Rows /> : list.error ? <Problem error={list.error} /> : (
        <>
          <ul className="divide-y">
            {mails.map((m) => (
              <li key={m.id}>
                <button type="button" className="hover:bg-accent grid w-full gap-0.5 rounded px-2 py-2 text-left" onClick={() => setOpen(m.threadId)}>
                  <span className={cn("flex gap-2 text-sm", m.unread && "font-semibold")}>
                    <span className="w-44 shrink-0 truncate">{outgoing ? `To: ${nameOnly(m.to)}` : nameOnly(m.from)}</span>
                    <span className="truncate">{m.subject || "(no subject)"}</span>
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs">{when(m.date)}</span>
                  </span>
                  <span className="text-muted-foreground truncate text-xs">{m.snippet}</span>
                </button>
              </li>
            ))}
            {!mails.length && <li className="text-muted-foreground py-3 text-sm">No messages.</li>}
          </ul>
          {list.hasNextPage && <Button className="mt-3" variant="outline" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button>}
        </>
      )}
    </div>
  );
}

function CalendarTab() {
  const q = useQuery({ queryKey: ["google", "calendar"], ...fresh, queryFn: () => api<{ events: Event[] }>("GET", "/api/google/calendar") });
  if (q.isPending) return <Rows />;
  if (q.error) return <Problem error={q.error} />;
  const days = Map.groupBy(q.data.events, (e) => when(e.start, { weekday: "long", day: "numeric", month: "long" }));
  return (
    <div className="grid gap-5">
      <p className="text-muted-foreground text-sm">Next 14 days, primary calendar.</p>
      {[...days].map(([day, evs]) => (
        <section key={day}>
          <h3 className="mb-1 text-sm font-semibold">{day}</h3>
          <ul className="divide-y">
            {evs.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 py-2 text-sm">
                <span className="text-muted-foreground w-28 shrink-0 text-xs">{e.allDay ? "All day" : `${when(e.start, { hour: "2-digit", minute: "2-digit" })} – ${when(e.end, { hour: "2-digit", minute: "2-digit" })}`}</span>
                <span className="min-w-0 flex-1 truncate">{e.title}{e.location && <span className="text-muted-foreground"> · {e.location}</span>}{e.guests > 0 && <span className="text-muted-foreground"> · {e.guests} guests</span>}</span>
                {e.meet && <a className="text-xs underline" href={e.meet} target="_blank" rel="noreferrer">Meet</a>}
                {e.link && <a className="text-xs underline" href={e.link} target="_blank" rel="noreferrer">Open</a>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!q.data.events.length && <p className="text-muted-foreground text-sm">Nothing scheduled.</p>}
    </div>
  );
}

// Docs and Sheets share the list; only the detail view differs.
function FilesTab({ kind }: { kind: "docs" | "sheets" }) {
  const [q, setQ] = useState(""), [shared, setShared] = useState(false), [open, setOpen] = useState<GFile | null>(null);
  const list = useQuery({
    queryKey: ["google", kind, q, shared], ...fresh,
    queryFn: () => api<{ files: GFile[] }>("GET", `/api/google/${kind}?${new URLSearchParams({ q, ...(shared && { shared: "1" }) })}`),
  });
  if (open) return (
    <div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>← Back</Button>
        {kind !== "docs" && <b className="truncate text-sm">{open.name}</b>}
        {open.link && <a className="ml-auto inline-flex items-center gap-1 text-xs underline" href={open.link} target="_blank" rel="noopener noreferrer">Open in Google <ExternalLink className="size-3" /></a>}
      </div>
      {kind === "docs" ? <DocView id={open.id} name={open.name} /> : <SheetView id={open.id} />}
    </div>
  );
  return (
    <div>
      <Search onSearch={setQ} placeholder={`Search ${kind} by name`} />
      <div className="mb-3 flex gap-1" role="tablist" aria-label="Which files">
        {([[false, "All"], [true, "Shared with me"]] as const).map(([v, label]) => (
          <Button key={label} role="tab" aria-selected={shared === v} size="sm" variant={shared === v ? "secondary" : "ghost"} onClick={() => setShared(v)}>{label}</Button>
        ))}
      </div>
      {list.isPending ? <Rows /> : list.error ? <Problem error={list.error} /> : list.data.files.length ? (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">Last edited</TableHead></TableRow></TableHeader>
          <TableBody>
            {list.data.files.map((f) => (
              <TableRow key={f.id} className="cursor-pointer" onClick={() => setOpen(f)}>
                <TableCell className="max-w-80 truncate"><button type="button" className="text-left hover:underline">{f.name}</button></TableCell>
                <TableCell className="text-muted-foreground max-w-48 truncate">{f.owner}</TableCell>
                <TableCell className="text-muted-foreground text-right text-xs">{when(f.modified)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : <p className="text-muted-foreground py-3 text-sm">Nothing found.</p>}
    </div>
  );
}

// The doc as formatted markdown (headings, lists, tables, links), laid out like a page. Images stay in Google.
function DocView({ id, name }: { id: string; name: string }) {
  const q = useQuery({ queryKey: ["google", "doc", id], ...fresh, queryFn: () => api<{ title: string; markdown: string }>("GET", `/api/google/docs/${id}`) });
  return (
    <article className="bg-background mx-auto mt-4 max-w-3xl rounded-lg border px-6 py-8 shadow-sm sm:px-12 sm:py-10">
      <h2 className="mb-6 text-3xl font-bold">{q.data?.title || name}</h2>
      {q.isPending ? <Rows /> : q.error ? <Problem error={q.error} />
        : q.data.markdown ? <Markdown markdown={q.data.markdown} /> : <p className="text-muted-foreground text-sm">This document is empty.</p>}
    </article>
  );
}

function SheetView({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["google", "sheet", id], ...fresh, queryFn: () => api<{ range: string; rows: string[][] }>("GET", `/api/google/sheets/${id}`) });
  if (q.isPending) return <Rows />;
  if (q.error) return <Problem error={q.error} />;
  return (
    <div className="mt-3 overflow-x-auto">
      <p className="text-muted-foreground mb-2 text-xs">{q.data.range} (first 50 rows × 26 columns)</p>
      <Table>
        <TableBody>
          {q.data.rows.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className="max-w-60 truncate">{c}</TableCell>)}</TableRow>)}
        </TableBody>
      </Table>
      {!q.data.rows.length && <p className="text-muted-foreground text-sm">Empty range.</p>}
    </div>
  );
}

export function Google() {
  const [tab, setTab] = useState<Tab>("mail");
  return (
    <>
      <h1 className="font-display text-[28px] leading-[1.2] font-bold">Google</h1>
      <p className="text-muted-foreground text-sm">Your own Gmail, Calendar, Docs and Sheets</p>
      <div className="mt-6 mb-4 flex gap-1" role="tablist">
        {TABS.map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={tab === k} variant={tab === k ? "default" : "ghost"} size="sm" onClick={() => setTab(k)}>{label}</Button>
        ))}
      </div>
      <Card className="shadow-sm">
        <CardContent role="tabpanel">
          {tab === "mail" && <MailTab />}
          {tab === "calendar" && <CalendarTab />}
          {tab === "docs" && <FilesTab key="docs" kind="docs" />}
          {tab === "sheets" && <FilesTab key="sheets" kind="sheets" />}
        </CardContent>
      </Card>
    </>
  );
}
