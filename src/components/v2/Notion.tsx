"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, FilePlus2, Lock, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { api, ApiError } from "@/lib/api";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/v2-utils";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type Workspace = { id: string; workspace: string; icon: string | null };
type Item = { id: string; title: string; icon: string; url: string; kind: "page" | "database"; edited: string };
type Page = { title: string; url: string; icon: string; edited: string; kind: "page" | "database"; markdown: string };

const FOLDERS = [["recent", "Recent"], ["private", "Private"], ["shared", "Shared"], ["favorites", "Favorites"]] as const;
type Folder = (typeof FOLDERS)[number][0];
const WS_KEY = "notion-workspace"; // per-browser choice; falls back to the first (default) workspace
const fresh = { staleTime: 60_000, retry: false } as const;

const when = (iso: string) => {
  const d = new Date(iso);
  return !iso || isNaN(+d) ? iso : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const Rows = () => <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>;

function Problem({ error }: { error: unknown }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.code === "NOTION_NOT_CONNECTED" || e?.code === "NOTION_RECONNECT")
    return <p className="text-muted-foreground text-sm">{e.code === "NOTION_RECONNECT" ? "This workspace needs reconnecting." : "No Notion workspace connected yet."} <Link className="underline" href="/v2/settings">Connect it in Settings</Link>.</p>;
  return <p className="text-destructive text-sm" role="alert">{e?.message ?? "Something went wrong."}</p>;
}

// Emoji, or an image URL for custom icons
function Icon({ icon, fallback = "📄" }: { icon: string; fallback?: string }) {
  if (icon.startsWith("https://"))
    // eslint-disable-next-line @next/next/no-img-element -- tiny icon from Notion's CDN; next/image would need remotePatterns
    return <img src={icon} alt="" className="size-4 shrink-0 rounded-sm" referrerPolicy="no-referrer" />;
  return <span className="w-4 shrink-0 text-center" aria-hidden>{icon || fallback}</span>;
}

// Notion-flavoured markdown. Raw HTML is parsed (Notion uses tags for tables, toggles, callouts) and then sanitised
// with GitHub's allow-list: scripts, styles, event handlers and unknown tags never reach the DOM (unknown tags are
// unwrapped, so their text stays). Links open in a new tab.
const MD = [
  "text-sm leading-relaxed break-words",
  "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2 [&_a]:underline [&_a]:underline-offset-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5",
  "[&_li:has(>input)]:list-none [&_li>input]:mr-2 [&_li>input]:-ml-5 [&_li>input]:align-middle",
  "[&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-4",
  "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:text-[0.85em] [&_pre]:bg-muted [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-3 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_details]:my-2 [&_summary]:cursor-pointer [&_summary]:font-medium [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded",
].join(" ");
export function NotionMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className={MD}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function PageView({ ws, item, onBack }: { ws: string; item: Item; onBack: () => void }) {
  const q = useQuery({ queryKey: ["notion", ws, "page", item.id], ...fresh, queryFn: () => api<Page>("GET", `/api/notion/pages/${item.id}?${new URLSearchParams({ ws })}`) });
  const p = q.data;
  return (
    <div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <a className="ml-auto inline-flex items-center gap-1 text-xs underline" href={p?.url || item.url} target="_blank" rel="noopener noreferrer">Open in Notion <ExternalLink className="size-3" /></a>
      </div>
      <h2 className="mt-3 flex items-center gap-2 text-2xl font-bold"><Icon icon={p?.icon || item.icon} />{p?.title ?? item.title}</h2>
      {p?.edited && <p className="text-muted-foreground mt-1 text-xs">Last edited {when(p.edited)}</p>}
      <div className="mt-4">
        {q.isPending ? <Rows /> : q.error ? <Problem error={q.error} /> : p!.markdown ? <NotionMarkdown markdown={p!.markdown} />
          : <p className="text-muted-foreground text-sm">This page is empty.</p>}
      </div>
    </div>
  );
}

// Where the new page goes: private (Notion's draft mode, the default) or under a page found by search.
function ParentPicker({ ws, value, onChange }: { ws: string; value: Item | null; onChange: (v: Item | null) => void }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(""), [term, setTerm] = useState("");
  const found = useQuery({
    queryKey: ["notion", ws, "search", term], enabled: open && !!term, ...fresh,
    queryFn: () => api<{ items: Item[] }>("GET", `/api/notion?${new URLSearchParams({ ws, q: term })}`),
  });
  const choose = (v: Item | null) => { onChange(v); setOpen(false); };
  return (
    <div className="border-b">
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <span className="text-muted-foreground w-14 shrink-0">In</span>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="hover:bg-accent inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 font-medium">
          {value ? <><Icon icon={value.icon} /><span className="truncate">{value.title}</span></> : <><Lock className="size-3.5" aria-hidden />Private</>}
          <ChevronDown className="text-muted-foreground size-3.5" aria-hidden />
        </button>
      </div>
      {open && (
        <div className="bg-muted/30 border-t px-4 py-3">
          <div className="flex gap-2">
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a parent page" aria-label="Search for a parent page" maxLength={200}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setTerm(q.trim()); } }} />
            <Button type="button" variant="outline" onClick={() => setTerm(q.trim())}>Find</Button>
          </div>
          <ul className="mt-2 max-h-56 overflow-y-auto text-sm">
            <li><button type="button" className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left" onClick={() => choose(null)}>
              <Lock className="size-3.5" aria-hidden />Private <span className="text-muted-foreground text-xs">(only you, in your workspace)</span></button></li>
            {found.isFetching && <li className="text-muted-foreground px-2 py-1.5">Searching…</li>}
            {found.error && <li className="px-2 py-1.5"><Problem error={found.error} /></li>}
            {found.data?.items.filter((i) => i.kind === "page").map((i) => (
              <li key={i.id}><button type="button" className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left" onClick={() => choose(i)}>
                <Icon icon={i.icon} /><span className="truncate">{i.title}</span></button></li>
            ))}
            {found.data && !found.data.items.some((i) => i.kind === "page") && <li className="text-muted-foreground px-2 py-1.5">No pages found.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// Write a page here; it's saved straight into the user's Notion. Never retried (see the API route).
function NewPage({ ws, onClose, onCreated }: { ws: string; onClose: () => void; onCreated: (it: Item) => void }) {
  const qc = useQueryClient();
  const [parent, setParent] = useState<Item | null>(null), [title, setTitle] = useState(""), [body, setBody] = useState(""), [preview, setPreview] = useState(false);
  const create = useMutation({
    mutationFn: () => api<{ id: string; url: string }>("POST", "/api/notion/pages", { ws, title, markdown: body, ...(parent && { parentId: parent.id }) }),
    onSuccess: (r) => {
      emitToast(parent ? `Created in Notion under ${parent.title}` : "Created in Notion (private)");
      void qc.invalidateQueries({ queryKey: ["notion", ws] });
      onCreated({ id: r.id, url: r.url, title: title.trim(), icon: "", kind: "page", edited: "" });
    },
  });
  const tab = (on: boolean) => cn("rounded-md px-2.5 py-1 text-xs font-medium", on ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground");
  return (
    <form className="bg-card mx-auto w-full max-w-3xl overflow-hidden rounded-xl border shadow-sm" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <header className="bg-muted/50 flex items-center gap-2 border-b py-1.5 pr-1.5 pl-4">
        <FilePlus2 className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-sm font-semibold">New Notion page</h2>
        <Button type="button" variant="ghost" size="icon" className="ml-auto size-8" aria-label="Close" onClick={onClose}><X className="size-4" /></Button>
      </header>
      <ParentPicker ws={ws} value={parent} onChange={setParent} />
      <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus maxLength={200} placeholder="Untitled" aria-label="Page title"
        className="placeholder:text-muted-foreground/50 m-0 block w-full appearance-none border-0 bg-transparent px-4 pt-5 pb-2 text-2xl font-bold shadow-none outline-none" />
      <div className="flex items-center gap-2 px-4">
        <div className="bg-muted inline-flex rounded-lg p-0.5" role="tablist" aria-label="Editor mode">
          <button type="button" role="tab" aria-selected={!preview} className={tab(!preview)} onClick={() => setPreview(false)}>Write</button>
          <button type="button" role="tab" aria-selected={preview} className={tab(preview)} onClick={() => setPreview(true)}>Preview</button>
        </div>
        <span className="text-muted-foreground hidden text-xs sm:inline">Markdown: # heading, - list, - [ ] to-do, **bold**, | table |</span>
      </div>
      {preview
        ? <div className="min-h-64 px-4 py-3">{body.trim() ? <NotionMarkdown markdown={body} /> : <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>}</div>
        : <textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label="Page content" rows={14} maxLength={100_000} placeholder="Start writing…"
            className="placeholder:text-muted-foreground/70 m-0 block min-h-64 w-full resize-y border-0 bg-transparent px-4 py-3 align-top font-mono text-sm leading-relaxed shadow-none outline-none" />}
      {create.error && <div className="px-4 pb-2"><Problem error={create.error} /></div>}
      <div className="flex items-center gap-3 border-t px-4 py-3">
        <Button type="submit" disabled={create.isPending || !title.trim()} className="gap-2 px-5">
          <FilePlus2 className="size-4" aria-hidden />{create.isPending ? "Creating…" : "Create in Notion"}
        </Button>
        <span className="text-muted-foreground hidden text-xs sm:inline">{parent ? `Saved under “${parent.title}”` : "Saved as a private page in your workspace"}</span>
        <Button type="button" variant="ghost" size="icon" className="text-muted-foreground ml-auto" aria-label="Discard page" onClick={onClose}><Trash2 className="size-4" /></Button>
      </div>
    </form>
  );
}

function Browser({ ws }: { ws: string }) {
  const [folder, setFolder] = useState<Folder>("recent"), [q, setQ] = useState(""), [open, setOpen] = useState<Item | null>(null), [writing, setWriting] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ["notion", ws, q ? "search" : folder, q], initialPageParam: "", ...fresh,
    queryFn: ({ pageParam }) => api<{ items: Item[]; cursor: string | null }>("GET", `/api/notion?${new URLSearchParams({ ws, folder, q, ...(pageParam && { cursor: pageParam }) })}`),
    getNextPageParam: (last) => last.cursor ?? undefined,
  });
  if (writing) return <NewPage ws={ws} onClose={() => setWriting(false)} onCreated={(it) => { setWriting(false); setOpen(it); }} />;
  if (open) return <PageView ws={ws} item={open} onBack={() => setOpen(null)} />;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <form className="mb-3 flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setQ(String(new FormData(e.currentTarget).get("q") ?? "").trim()); }}>
        <Input name="q" placeholder="Search pages and databases" aria-label="Search Notion" maxLength={200} key={q ? "s" : "c"} defaultValue={q} />
        <Button type="submit" variant="outline">Search</Button>
        {q && <Button type="button" variant="ghost" onClick={() => setQ("")}>Clear</Button>}
        <Button type="button" className="gap-2" onClick={() => setWriting(true)}><FilePlus2 className="size-4" aria-hidden />New page</Button>
      </form>
      {!q && (
        <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Notion folders">
          {FOLDERS.map(([k, label]) => (
            <Button key={k} role="tab" aria-selected={folder === k} size="sm" variant={folder === k ? "secondary" : "ghost"} onClick={() => setFolder(k)}>{label}</Button>
          ))}
        </div>
      )}
      {list.isPending ? <Rows /> : list.error ? <Problem error={list.error} /> : items.length ? (
        <>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead>{q && <TableHead className="text-right">Last edited</TableHead>}</TableRow></TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id} className="cursor-pointer" onClick={() => it.kind === "database" ? window.open(it.url, "_blank", "noopener") : setOpen(it)}>
                  <TableCell className="max-w-96">
                    <button type="button" className="flex w-full items-center gap-2 text-left hover:underline"><Icon icon={it.icon} fallback={it.kind === "database" ? "🗂️" : "📄"} /><span className="truncate">{it.title}</span></button>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{it.kind === "database" ? "Database ↗" : "Page"}</TableCell>
                  {q && <TableCell className="text-muted-foreground text-right text-xs">{when(it.edited)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {list.hasNextPage && <Button className="mt-3" variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>{list.isFetchingNextPage ? "Loading…" : "Load more"}</Button>}
        </>
      ) : <p className="text-muted-foreground py-3 text-sm">{q ? "Nothing found." : folder === "recent" ? "No recently viewed pages. Try Private, or search." : "Nothing here."}</p>}
    </div>
  );
}

export function Notion() {
  const wsList = useQuery({ queryKey: ["notion-workspaces"], ...fresh, queryFn: () => api<Workspace[]>("GET", "/api/integrations/notion") });
  const [picked, setPicked] = useState<string | null>(() => { try { return localStorage.getItem(WS_KEY); } catch { return null; } });
  const rows = wsList.data ?? [];
  const ws = rows.find((w) => w.id === picked) ?? rows[0]; // the first connected is the default
  const pick = (id: string) => { setPicked(id); try { localStorage.setItem(WS_KEY, id); } catch {} };
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-display text-[28px] leading-[1.2] font-bold">Notion</h1>
          <p className="text-muted-foreground text-sm">Everything you can see in your Notion workspace</p>
        </div>
        {rows.length > 1 && ws && (
          <Select value={ws.id} onValueChange={pick}>
            <SelectTrigger className="ml-auto w-60" aria-label="Notion workspace"><SelectValue /></SelectTrigger>
            <SelectContent>
              {rows.map((w) => <SelectItem key={w.id} value={w.id}><span className="flex items-center gap-2"><Icon icon={w.icon ?? ""} fallback={w.workspace[0]} />{w.workspace}</span></SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      <Card className="mt-6 shadow-sm">
        <CardContent>
          {wsList.isPending ? <Rows /> : wsList.error ? <Problem error={wsList.error} />
            : ws ? <Browser key={ws.id} ws={ws.id} /> : <Problem error={new ApiError(409, "", "NOTION_NOT_CONNECTED")} />}
        </CardContent>
      </Card>
    </>
  );
}
