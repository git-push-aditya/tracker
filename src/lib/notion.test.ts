import assert from "node:assert/strict";
import { test } from "node:test";
import { needsRefresh } from "./notion-auth";
import { idFromUrl, NotionId, toList, toPage, toSearch } from "./notion";

// Synthetic fixtures shaped like the live Notion MCP results from the phase 0 spike (no real data).
const ID = "1a2b3c4d5e6f708192a3b4c5d6e7f809";

test("idFromUrl takes the 32-hex tail of app.notion.com and slugged URLs", () => {
  assert.equal(idFromUrl(`https://app.notion.com/p/${ID}`), ID);
  assert.equal(idFromUrl(`https://www.notion.so/acme/Roadmap-${ID}?pvs=4`), ID);
  assert.equal(idFromUrl("https://app.notion.com/p/not-an-id"), "");
  assert.equal(idFromUrl("not a url"), "");
});

test("toList maps folder results, drops rows without an id, defaults titles, reads the cursor", () => {
  const r = toList({ results: [
    { type: "page", url: `https://app.notion.com/p/${ID}`, title: " Roadmap ", icon: "🗺️" },
    { type: "database", url: `https://app.notion.com/p/${ID.replace("1", "2")}`, title: "", icon: null },
    { type: "page", url: "https://app.notion.com/p/broken", title: "x", icon: "" },
  ], nextCursor: "c2" });
  assert.deepEqual(r.items.map((i) => [i.title, i.kind, i.icon]), [["Roadmap", "page", "🗺️"], ["Untitled", "database", ""]]);
  assert.equal(r.cursor, "c2");
  assert.equal(toList({ results: [] }).cursor, null);
  assert.throws(() => toList({ pages: [] }), (e: { status?: number }) => e.status === 502);
});

test("toSearch strips dashes from ids and keeps the timestamp", () => {
  const r = toSearch({ type: "workspace_search", results: [{ id: "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809", title: "Plan", url: "https://app.notion.com/p/x", type: "page", highlight: "…", timestamp: "2026-11-18T10:00:00.000Z" }], notices: ["upsell"] });
  assert.deepEqual(r.items[0], { id: ID, title: "Plan", icon: "", url: "https://app.notion.com/p/x", kind: "page", edited: "2026-11-18T10:00:00.000Z" });
});

test("toPage keeps only the <content> markdown", () => {
  const p = toPage({
    metadata: { type: "page" }, title: "Spec", url: "https://app.notion.com/p/x", cover: null, icon: { type: "emoji", emoji: "📘" },
    full_width: false, verification: { state: "none" }, page_last_edited_at: "2026-11-18T10:00:00.000Z",
    text: '<page url="x">\n<ancestor-path>\n<parent-page url="y" title="Home"/>\n</ancestor-path>\n<properties>{"title":"Spec"}</properties>\n<content>\n## Goals\n- [ ] ship\n</content>\n</page>',
  });
  assert.deepEqual(p, { title: "Spec", url: "https://app.notion.com/p/x", icon: "📘", edited: "2026-11-18T10:00:00.000Z", kind: "page", markdown: "## Goals\n- [ ] ship" });
  assert.equal(toPage({ metadata: { type: "page" }, title: null, url: null, text: "plain", icon: null }).markdown, "plain");
});

test("NotionId accepts plain and dashed UUIDs only; needsRefresh triggers a minute early", () => {
  assert.ok(NotionId.safeParse(ID).success && NotionId.safeParse("1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809").success);
  assert.ok(!NotionId.safeParse("../etc").success && !NotionId.safeParse(ID + "0").success);
  assert.equal(needsRefresh(new Date(100_000), 30_000), false);
  assert.equal(needsRefresh(new Date(100_000), 50_000), true);
});

test("createArgs uses draft mode without a parent and page_id with one; toCreated reads the new page", async () => {
  const { createArgs, NewPage, toCreated } = await import("./notion");
  assert.deepEqual(createArgs(NewPage.parse({ title: " Plan ", markdown: "## Hi" })), { creation_mode: "draft", pages: [{ properties: { title: "Plan" }, content: "## Hi" }] });
  assert.deepEqual(createArgs(NewPage.parse({ title: "Plan", parentId: ID })), { parent: { type: "page_id", page_id: ID }, pages: [{ properties: { title: "Plan" }, content: "" }] });
  assert.ok(!NewPage.safeParse({ title: "  " }).success && !NewPage.safeParse({ title: "x", parentId: "../x" }).success);
  assert.deepEqual(toCreated({ pages: [{ id: "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809", url: "https://app.notion.com/p/x", properties: { title: "Plan" } }] }), { id: ID, url: "https://app.notion.com/p/x" });
  assert.throws(() => toCreated({ pages: [] }), (e: { status?: number }) => e.status === 502);
});

test("icons: Notion-internal paths load from notion.so, junk is dropped; titles lose a repeated emoji", async () => {
  const { iconOf } = await import("./notion");
  assert.equal(iconOf("/icons/notepad_blue.svg"), "https://www.notion.so/icons/notepad_blue.svg");
  assert.equal(iconOf("https://cdn.example/x.png"), "https://cdn.example/x.png");
  assert.equal(iconOf("👋"), "👋");
  assert.equal(iconOf("javascript:alert(1)"), "");
  assert.equal(iconOf("folder.svg"), "");
  assert.equal(iconOf(null), "");
  const l = toList({ results: [{ type: "database", url: `https://app.notion.com/p/${ID}`, title: "Docs", icon: "/icons/folder_blue.svg" }] });
  assert.equal(l.items[0].icon, "https://www.notion.so/icons/folder_blue.svg");
  const p = toPage({ metadata: { type: "page" }, title: "👋 Getting Started", url: null, text: "<content>x</content>", icon: { type: "emoji", emoji: "👋" } });
  assert.equal(p.title, "Getting Started");
});

test("notionTool refuses tools and update commands outside the allow-list before touching Notion", async () => {
  const { notionTool } = await import("./notion");
  await assert.rejects(notionTool("u", undefined, "http://x", "notion-delete-pages", { page_ids: ["a"] }), /not allowed/);
  await assert.rejects(notionTool("u", undefined, "http://x", "notion-update-page", { page_id: "a", command: "apply_template" }), /not allowed/);
  await assert.rejects(notionTool("u", undefined, "http://x", "notion-update-page", { page_id: "a", command: "replace_content", new_str: "", allow_deleting_content: true }), /not allowed/);
});
