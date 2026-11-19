import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { unseal } from "./crypto";
import { HttpError } from "./http";
import { needsRefresh, NOTION_RESOURCE, refreshTokens } from "./notion-auth";
import { prisma } from "./prisma";

// Notion via its hosted MCP server, as one connected workspace of this user. Result shapes were confirmed in the
// phase 0 spike (docs/notion-integration-implementation.md). Notion output is untrusted: every result is parsed below.

// The server exposes ~60 tools, including edit, move and delete. We only ever call these.
const ALLOWED = new Set([
  "notion-list-recent-pages", "notion-list-private-pages", "notion-list-shared-pages", "notion-list-favorite-pages",
  "notion-search", "notion-fetch", "notion-create-pages",
]);
export const FOLDERS = { recent: "notion-list-recent-pages", private: "notion-list-private-pages", shared: "notion-list-shared-pages", favorites: "notion-list-favorite-pages" } as const;

type Conn = { id: string; accessToken: string; expiresAt: Date };

// The workspace to use: the requested one if it's this user's, else the first connected (the default).
async function connection(userId: string, wsId?: string): Promise<Conn> {
  const select = { id: true, accessToken: true, expiresAt: true } as const;
  const row = (wsId && await prisma().notionConnection.findFirst({ where: { id: wsId, userId }, select }))
    || await prisma().notionConnection.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select });
  if (!row) throw new HttpError(409, "Connect Notion in Settings first", "NOTION_NOT_CONNECTED");
  return row;
}

// A usable access token. Notion rotates refresh tokens and may revoke the whole grant if two refreshes race, and
// server instances don't share memory, so the refresh runs under a Postgres row lock and re-checks after waiting.
// `failed` = a token Notion just rejected: refresh unless someone else already replaced it.
// ponytail: holds a DB transaction across one HTTP call to Notion (~0.5s); fine at this scale.
async function freshToken(origin: string, conn: Conn, failed?: string) {
  if (!failed && !needsRefresh(conn.expiresAt)) return unseal(conn.accessToken);
  try {
    return await prisma().$transaction(async (tx) => {
      const [cur] = await tx.$queryRaw<{ accessToken: string; refreshToken: string; expiresAt: Date }[]>`
        SELECT "accessToken", "refreshToken", "expiresAt" FROM "NotionConnection" WHERE id = ${conn.id} FOR UPDATE`;
      if (!cur) throw new HttpError(409, "Reconnect this Notion workspace in Settings", "NOTION_RECONNECT");
      const current = unseal(cur.accessToken);
      if (failed ? current !== failed : !needsRefresh(cur.expiresAt)) return current; // refreshed while we waited
      const next = await refreshTokens(origin, cur.refreshToken);
      await tx.notionConnection.update({ where: { id: conn.id }, data: next });
      return unseal(next.accessToken);
    }, { timeout: 20_000 });
  } catch (e) {
    // The grant is gone for good: drop the row so Settings shows it as disconnected
    if (e instanceof HttpError && e.code === "NOTION_RECONNECT") await prisma().notionConnection.deleteMany({ where: { id: conn.id } });
    throw e;
  }
}

// One MCP connection per workspace per server instance (connecting costs ~1.2s, a call ~0.4s), rebuilt when the
// token changes. ponytail: per-process memory, like the Composio session cache.
const clients = new Map<string, { token: string; client: Promise<Client> }>();
function client(connId: string, token: string) {
  const hit = clients.get(connId);
  if (hit?.token === token) return hit.client;
  hit?.client.then((c) => c.close()).catch(() => {});
  const p = (async () => {
    const c = new Client({ name: "prime-care-tracker", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(NOTION_RESOURCE), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return c;
  })();
  clients.set(connId, { token, client: p });
  p.catch(() => clients.delete(connId));
  return p;
}
const forget = (connId: string) => { clients.get(connId)?.client.then((c) => c.close()).catch(() => {}); clients.delete(connId); };

// Runs one allow-listed tool and returns its structured result. Retries once only when Notion rejected the request
// before running it (401 token, 404 expired MCP session), so a create is never sent twice.
export async function notionTool(userId: string, wsId: string | undefined, origin: string, name: string, args: Record<string, unknown>) {
  if (!ALLOWED.has(name)) throw new Error(`Notion tool not allowed: ${name}`);
  const conn = await connection(userId, wsId);
  let token = await freshToken(origin, conn);
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await (await client(conn.id, token)).callTool({ name, arguments: args });
    } catch (e) {
      forget(conn.id);
      const msg = e instanceof Error ? e.message : "";
      if (/HTTP 401|Unauthorized/i.test(msg) && !attempt) { token = await freshToken(origin, conn, token); continue; }
      if (/HTTP 404/.test(msg) && !attempt) continue;
      if (/HTTP 401|Unauthorized/i.test(msg)) throw new HttpError(409, "Reconnect this Notion workspace in Settings", "NOTION_RECONNECT");
      if (/HTTP 429/.test(msg)) throw new HttpError(429, "Too many Notion requests, try again in a minute");
      console.error(name, msg.slice(0, 200)); // never args or results: they hold page content
      throw new HttpError(502, "Notion is unavailable", "NOTION_UNAVAILABLE"); // may or may not have run
    }
    if (r.isError) {
      console.error(name, "returned an error"); // the text may quote page content, so it goes to the user, not the log
      const text = (r.content as { type: string; text?: string }[] | undefined)?.find((p) => p.type === "text")?.text ?? "";
      throw new HttpError(502, `Notion: ${text.slice(0, 200) || "request failed"}`);
    }
    return r.structuredContent ?? JSON.parse((r.content as { text: string }[])[0]?.text ?? "null");
  }
}

// --- Shapes --------------------------------------------------------------------------------------------------------
const str = z.string().nullish();
function upstream<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  console.error("Unexpected Notion response shape:", r.error.issues.map((i) => i.path.join(".")).join(", "));
  throw new HttpError(502, "Unexpected response from Notion");
}

export const NotionId = z.string().regex(/^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id");
// List results carry no id; it's the 32-hex tail of the page URL (app.notion.com/p/<id>, or <slug>-<id>)
export const idFromUrl = (url: string) => {
  try { return new URL(url).pathname.match(/([0-9a-f]{32})$/i)?.[1] ?? ""; } catch { return ""; }
};

export type NotionItem = { id: string; title: string; icon: string; url: string; kind: "page" | "database"; edited: string };
const kindOf = (t: string): NotionItem["kind"] => (t === "database" ? "database" : "page");

const ListResult = z.object({
  results: z.array(z.object({ type: z.string(), url: z.string(), title: str, icon: str })),
  nextCursor: str, next_cursor: str,
});
export function toList(data: unknown) {
  const d = upstream(ListResult, data);
  const items: NotionItem[] = d.results.map((r) => ({ id: idFromUrl(r.url), title: r.title?.trim() || "Untitled", icon: r.icon ?? "", url: r.url, kind: kindOf(r.type), edited: "" }));
  return { items: items.filter((i) => i.id), cursor: d.nextCursor ?? d.next_cursor ?? null };
}

const SearchResult = z.object({ results: z.array(z.object({ id: z.string(), title: str, url: z.string(), type: z.string(), timestamp: str })) });
export function toSearch(data: unknown) {
  const items: NotionItem[] = upstream(SearchResult, data).results.map((r) => ({
    id: r.id.replace(/-/g, ""), title: r.title?.trim() || "Untitled", icon: "", url: r.url, kind: kindOf(r.type), edited: r.timestamp ?? "",
  }));
  return { items, cursor: null };
}

const Fetched = z.object({
  title: str, url: str, text: z.string(), page_last_edited_at: str,
  icon: z.object({ emoji: str }).passthrough().nullish(), metadata: z.object({ type: z.string() }).passthrough(),
});
// Page text is Notion-flavoured markup: <page><ancestor-path/>…<properties/>…<content>MARKDOWN</content></page>.
// We keep the <content> part; remaining Notion tags are sanitised (unknown ones unwrapped) when rendered.
export function toPage(data: unknown) {
  const d = upstream(Fetched, data);
  const content = d.text.match(/<content>([\s\S]*)<\/content>/)?.[1] ?? d.text;
  return { title: d.title?.trim() || "Untitled", url: d.url ?? "", icon: d.icon?.emoji ?? "", edited: d.page_last_edited_at ?? "", kind: kindOf(d.metadata.type), markdown: content.trim() };
}

// --- Creating ------------------------------------------------------------------------------------------------------
export const NewPage = z.object({
  ws: z.string().max(40).optional(),
  title: z.string().trim().min(1, "Give the page a title").max(200),
  markdown: z.string().max(100_000).default(""),
  parentId: NotionId.optional(), // a page to put it under; omitted = a private page in the workspace (Notion's draft mode)
});
export const createArgs = ({ title, markdown, parentId }: z.infer<typeof NewPage>) => ({
  ...(parentId ? { parent: { type: "page_id", page_id: parentId } } : { creation_mode: "draft" }),
  pages: [{ properties: { title }, content: markdown }],
});
const Created = z.object({ pages: z.array(z.object({ id: z.string(), url: z.string() })).min(1) });
export function toCreated(data: unknown) {
  const p = upstream(Created, data).pages[0];
  return { id: p.id.replace(/-/g, ""), url: p.url };
}
