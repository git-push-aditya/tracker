import { z } from "zod";
import { composio } from "./composio";
import { GOOGLE_TOOLKITS } from "./google-toolkits";
import { HttpError } from "./http";
import { takeQuota } from "./quota";

// Runs one Composio tool as this user and returns its `data`. Composio/Google output is untrusted: every caller
// parses it with a schema below before it reaches the browser.
// One Composio session per user (all Google toolkits), reused across calls to skip a round trip.
// ponytail: per-process memory, so each server instance builds its own; move to Redis/DB if instances multiply.
const sessions = new Map<string, ReturnType<ReturnType<typeof composio>["create"]>>();
export const forgetSession = (userId: string) => void sessions.delete(userId);

export async function runTool(userId: string, slug: string, args: Record<string, unknown>) {
  let r;
  try {
    let session = sessions.get(userId);
    if (!session) sessions.set(userId, (session = composio().create(userId, { toolkits: [...GOOGLE_TOOLKITS] })));
    r = await (await session).execute(slug, args);
  } catch (e) {
    forgetSession(userId); // a failed create or an expired session must not stick
    if (e instanceof HttpError) throw e;
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("NoActiveConnection")) throw new HttpError(409, "Connect this Google product in Settings first", "GOOGLE_NOT_CONNECTED");
    if ((e as { status?: number }).status === 429) throw new HttpError(429, "Too many Google requests, try again in a minute");
    console.error(slug, (e as { status?: number }).status, msg.slice(0, 300)); // never log args or results: they hold mail/doc content
    throw new HttpError(502, "Google service unavailable");
  }
  if (r.resultType !== "completed") {
    console.error(slug, r.resultType, r.logId);
    throw new HttpError(502, `Google request failed (Composio log ${r.logId})`);
  }
  return r.data;
}

const str = z.string().nullish(); // Composio sends null for some absent fields

// Upstream shape drift is Google's/Composio's problem (502), not a bad request from our user (400).
function upstream<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  console.error("Unexpected Google response shape:", r.error.issues.map((i) => i.path.join(".")).join(", "));
  throw new HttpError(502, "Unexpected response from Google");
}

// --- Gmail -------------------------------------------------------------------------------------------------------
const Part = z.object({
  mimeType: str, filename: str, body: z.object({ data: str }).nullish(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).nullish(),
  get parts() { return z.array(Part).nullish(); },
});
type Part = z.infer<typeof Part>;
const GmailMessage = z.object({
  messageId: z.string(), threadId: z.string(), sender: str, to: str, subject: str,
  messageTimestamp: str, messageText: str, labelIds: z.array(z.string()).nullish(),
  preview: z.object({ body: str }).nullish(), payload: Part.nullish(),
});
// First inline (non-attachment) body of this MIME type, depth-first, as Gmail nests multipart/mixed > alternative.
const findPart = (p: Part | null | undefined, type: string): Part | undefined =>
  !p ? undefined : p.mimeType === type && !p.filename && p.body?.data ? p : p.parts?.map((c) => findPart(c, type)).find(Boolean);
// ponytail: assumes UTF-8; other charsets (rare now) show mojibake, decode by the part's Content-Type charset if it bites.
const decode = (p: Part | undefined) => (p?.body?.data ? Buffer.from(p.body.data, "base64url").toString("utf8") : null);
export const toMailList = (data: unknown) => {
  const d = upstream(z.object({ messages: z.array(GmailMessage).nullish().transform((v) => v ?? []), nextPageToken: str }), data);
  return {
    messages: d.messages.map((m) => ({
      id: m.messageId, threadId: m.threadId, from: m.sender ?? "", to: m.to ?? "", subject: m.subject ?? "", date: m.messageTimestamp ?? "",
      snippet: (m.preview?.body ?? "").slice(0, 200), unread: !!m.labelIds?.includes("UNREAD"),
    })),
    nextPage: d.nextPageToken || null,
  };
};
export const toThread = (data: unknown) => {
  const d = upstream(z.object({ messages: z.array(GmailMessage).nullish().transform((v) => v ?? []) }), data);
  return {
    subject: d.messages[0]?.subject ?? "",
    messages: d.messages.map((m) => {
      const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
      return {
        id: m.messageId, from: h("from") || (m.sender ?? ""), to: h("to") || (m.to ?? ""), cc: h("cc"), replyTo: h("reply-to"),
        date: m.messageTimestamp ?? "",
        html: decode(findPart(m.payload, "text/html")), // untrusted: the browser renders it only in a sandboxed iframe
        text: decode(findPart(m.payload, "text/plain")) ?? m.messageText ?? "",
      };
    }),
  };
};

// --- Calendar ----------------------------------------------------------------------------------------------------
const When = z.object({ dateTime: str, date: str }).nullish(); // all-day events only have `date`
export const toEvents = (data: unknown) => {
  const d = upstream(z.object({
    items: z.array(z.object({
      id: z.string(), summary: str, location: str, htmlLink: str, hangoutLink: str, status: str, start: When, end: When,
      attendees: z.array(z.unknown()).nullish(),
    })).nullish().transform((v) => v ?? []),
  }), data);
  return {
    events: d.items.filter((e) => e.status !== "cancelled").map((e) => ({
      id: e.id, title: e.summary ?? "(no title)", start: e.start?.dateTime ?? e.start?.date ?? "", end: e.end?.dateTime ?? e.end?.date ?? "",
      allDay: !e.start?.dateTime, location: e.location ?? "", link: e.htmlLink ?? "", meet: e.hangoutLink ?? "", guests: e.attendees?.length ?? 0,
    })),
  };
};

// --- Docs and Sheets ---------------------------------------------------------------------------------------------
const Person = z.object({ displayName: str, emailAddress: str, me: z.boolean().nullish() });
const File = z.object({ id: z.string(), name: str, modifiedTime: str, webViewLink: str, owners: z.array(Person).nullish() });
const toFile = (f: z.infer<typeof File>) => {
  const o = f.owners?.[0];
  return { id: f.id, name: f.name ?? "(untitled)", modified: f.modifiedTime ?? "", link: f.webViewLink ?? "", owner: o?.me ? "me" : o?.displayName || o?.emailAddress || "" };
};
export const toDocList = (data: unknown) => {
  const d = upstream(z.object({ files: z.array(File).nullish().transform((v) => v ?? []), next_page_token: str }), data);
  return { files: d.files.map(toFile), nextPage: d.next_page_token || null };
};
export const toSheetList = (data: unknown) => {
  const d = upstream(z.object({ spreadsheets: z.array(File).nullish().transform((v) => v ?? []), next_page_token: str }), data);
  return { files: d.spreadsheets.map(toFile), nextPage: d.next_page_token || null };
};
// A Google Doc (Docs API JSON from GOOGLEDOCS_GET_DOCUMENT_BY_ID) as markdown: headings, bullet and numbered lists,
// tables, bold, italic, links and smart chips. Images, drawings, colours and fonts are dropped (open in Google for those).
// Only the top level is schema-checked; the body is walked defensively because docs can be ~1MB of nested JSON.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- walked defensively below
const DocJson = z.object({ title: str, body: z.object({ content: z.array(z.record(z.string(), z.unknown())).nullish() }).nullish(), lists: z.record(z.string(), z.unknown()).nullish() });
const esc = (t: string) => t.replace(/[\\`*_[\]<>|~]/g, "\\$&");
const HEADING: Record<string, string> = { TITLE: "#", HEADING_1: "#", HEADING_2: "##", HEADING_3: "###", HEADING_4: "####", HEADING_5: "#####", HEADING_6: "######" };

function runText(el: Json, heading: boolean) {
  if (el.richLink) { const p = el.richLink.richLinkProperties ?? {}; return p.uri ? `[${esc(p.title || p.uri)}](${p.uri})` : esc(p.title ?? ""); }
  if (el.dateElement) return esc(el.dateElement.dateElementProperties?.displayText ?? "");
  if (el.person) return esc(el.person.personProperties?.name ?? el.person.personProperties?.email ?? "");
  const raw: string = el.textRun?.content ?? "";
  const text = esc(raw.replace(/\n$/, "")).replace(/\u000b/g, heading ? " " : "<br>"); // \u000b = Shift+Enter line break
  const st = el.textRun?.textStyle ?? {};
  const core = text.trim();
  if (!core) return text;
  let out = core;
  if (st.bold && !heading) out = `**${out}**`;
  if (st.italic) out = `*${out}*`;
  if (st.link?.url) out = `[${out}](${st.link.url})`;
  return text.slice(0, text.indexOf(core[0])) + out + text.slice(text.lastIndexOf(core.at(-1)!) + 1); // spaces stay outside the markers
}
const paraText = (p: Json, heading = false) => (p.elements ?? []).map((el: Json) => runText(el, heading)).join("").trim();
// A paragraph that happens to start with "1." or "-" must not turn into a list
const blockSafe = (t: string) => t.replace(/^(\d+)\.(\s)/, "$1\\.$2").replace(/^([#>+-])(\s)/, "\\$1$2");

export const toDoc = (data: unknown) => {
  const d = upstream(DocJson, data);
  const lists = (d.lists ?? {}) as Json;
  const blocks: { text: string; list: boolean }[] = [];
  for (const el of (d.body?.content ?? []) as Json[]) {
    if (el.paragraph) {
      const p = el.paragraph, style: string = p.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT";
      const text = paraText(p, !!HEADING[style]);
      if (!text) continue;
      if (p.bullet) {
        const level: number = p.bullet.nestingLevel ?? 0;
        const glyph = lists[p.bullet.listId]?.listProperties?.nestingLevels?.[level] ?? {};
        const ordered = !glyph.glyphSymbol && glyph.glyphType && glyph.glyphType !== "GLYPH_TYPE_UNSPECIFIED" && glyph.glyphType !== "NONE";
        blocks.push({ text: `${"    ".repeat(level)}${ordered ? "1." : "-"} ${text}`, list: true });
      } else blocks.push({ text: HEADING[style] ? `${HEADING[style]} ${text}` : style === "SUBTITLE" ? `*${text}*` : blockSafe(text), list: false });
    } else if (el.table) {
      const rows: string[][] = (el.table.tableRows ?? []).map((r: Json) => (r.tableCells ?? []).map((c: Json) =>
        (c.content ?? []).filter((x: Json) => x.paragraph).map((x: Json) => paraText(x.paragraph)).filter(Boolean).join("<br>")));
      const cols = Math.max(0, ...rows.map((r) => r.length));
      if (!cols) continue;
      const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? "").join(" | ")} |`;
      blocks.push({ text: [line(rows[0]), line(Array(cols).fill("---")), ...rows.slice(1).map(line)].join("\n"), list: false });
    }
  }
  // List items sit on consecutive lines; everything else is separated by a blank line
  const markdown = blocks.map((b, i) => (i && !(b.list && blocks[i - 1].list) ? "\n\n" : i ? "\n" : "") + b.text).join("");
  return { title: d.title ?? "", markdown };
};
export const toValues = (data: unknown) => {
  const d = upstream(z.object({ range: str, values: z.array(z.array(z.unknown())).nullish().transform((v) => v ?? []) }), data);
  return { range: d.range ?? "", rows: d.values.map((r) => r.map((c) => (c == null ? "" : String(c)))) };
};

// --- Request params (our trust boundary) -------------------------------------------------------------------------
export const GoogleId = z.string().regex(/^[\w-]{1,200}$/, "Invalid id");
export const SearchParams = z.object({
  q: z.string().max(400).default(""), page: z.string().max(2000).optional(), shared: z.literal("1").optional(),
});

// --- Sending ------------------------------------------------------------------------------------------------------
const Emails = z.array(z.email()).max(20);
export const SendMail = z.object({ to: Emails.min(1), cc: Emails.default([]), subject: z.string().max(300), body: z.string().max(50_000) });
export const ReplyMail = z.object({ to: Emails.min(1), body: z.string().min(1).max(50_000) });

// Caps damage from a stolen session or a buggy client. Google's own limit (~500/day) still applies on top.
// ponytail: per-process memory like the session cache; a DB counter if we run several instances.
export const takeSend = (userId: string, now = Date.now()) => takeQuota(`gmail-send:${userId}`, 30, "Send", now);
export const params = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
