import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleId, SendMail, takeSend, toDoc, toDocList, toEvents, toMailList, toSheetList, toThread, toValues } from "./google";

// Synthetic fixtures shaped like the live Composio responses (checked against a real account in phase 2; no real data here).
test("toMailList maps messages, unread flag and page token; extra fields are dropped", () => {
  const r = toMailList({
    messages: [{ messageId: "m1", threadId: "t1", sender: "A <a@x.com>", subject: "Hi", messageTimestamp: "2026-11-17T10:00:00Z",
      labelIds: ["INBOX", "UNREAD"], preview: { body: "x".repeat(300) }, messageText: "secret body", attachmentList: [] }],
    nextPageToken: "p2", resultSizeEstimate: 1,
  });
  assert.equal(r.nextPage, "p2");
  assert.deepEqual(Object.keys(r.messages[0]).sort(), ["date", "from", "id", "snippet", "subject", "threadId", "to", "unread"]);
  assert.equal(r.messages[0].unread, true);
  assert.equal(r.messages[0].snippet.length, 200);
  assert.deepEqual(toMailList({}).messages, []);
});

test("toThread decodes nested HTML/plain parts and real headers; attachments are skipped", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const r = toThread({ messages: [{ messageId: "m1", threadId: "t1", subject: "S", messageText: "truncated", sender: "x",
    payload: { mimeType: "multipart/mixed", headers: [{ name: "From", value: "A <a@x.com>" }, { name: "CC", value: "c@x.com" }], parts: [
      { mimeType: "multipart/alternative", parts: [
        { mimeType: "text/plain", body: { data: b64("héllo") } }, { mimeType: "text/html", body: { data: b64("<b>héllo</b>") } }] },
      { mimeType: "text/html", filename: "evil.html", body: { data: b64("<script>") } },
    ] } }] });
  const m = r.messages[0];
  assert.equal(m.html, "<b>héllo</b>");
  assert.equal(m.text, "héllo");
  assert.equal(m.from, "A <a@x.com>");
  assert.equal(m.cc, "c@x.com");
  const plain = toThread({ messages: [{ messageId: "m1", threadId: "t1", messageText: "hello" }] }).messages[0];
  assert.equal(plain.html, null);
  assert.equal(plain.text, "hello");
});

test("toEvents: timed vs all-day, cancelled dropped", () => {
  const r = toEvents({ items: [
    { id: "e1", summary: "Standup", start: { dateTime: "2026-11-17T09:00:00+05:30" }, end: { dateTime: "2026-11-17T09:15:00+05:30" }, attendees: [{}, {}] },
    { id: "e2", start: { date: "2026-11-18" }, end: { date: "2026-11-19" } },
    { id: "e3", status: "cancelled", start: { date: "2026-11-18" } },
  ] });
  assert.equal(r.events.length, 2);
  assert.equal(r.events[0].allDay, false);
  assert.equal(r.events[0].guests, 2);
  assert.equal(r.events[1].allDay, true);
  assert.equal(r.events[1].title, "(no title)");
});

test("doc/sheet lists and values", () => {
  assert.equal(toDocList({ files: [{ id: "d1", name: "Plan" }] }).files[0].name, "Plan");
  assert.equal(toDocList({ files: [{ id: "d1", owners: [{ displayName: "Bo", emailAddress: "b@x.com" }] }] }).files[0].owner, "Bo");
  assert.equal(toSheetList({ spreadsheets: [{ id: "s1", owners: [{ displayName: "Me", me: true }] }] }).files[0].owner, "me");
  assert.equal(toSheetList({ spreadsheets: [{ id: "s1", name: null }], next_page_token: null }).nextPage, null); // live API sends nulls
  assert.deepEqual(toValues({ values: [["a", 1], [null]] }).rows, [["a", "1"], [""]]);
});

test("a wrong upstream shape is a 502, not passed through", () => {
  assert.throws(() => toMailList({ messages: [{ subject: "no ids" }] }), (e: { status?: number }) => e.status === 502);
});

test("GoogleId blocks path tricks", () => {
  assert.equal(GoogleId.safeParse("1AbC_d-9").success, true);
  assert.equal(GoogleId.safeParse("../x").success, false);
  assert.equal(GoogleId.safeParse("").success, false);
});

test("send: recipients must be emails; at most 30 sends per hour per user", () => {
  assert.equal(SendMail.safeParse({ to: ["a@x.com"], subject: "", body: "" }).success, true);
  assert.equal(SendMail.safeParse({ to: [], subject: "", body: "" }).success, false);
  assert.equal(SendMail.safeParse({ to: ["not an email"], subject: "", body: "" }).success, false);
  for (let i = 0; i < 30; i++) takeSend("u-cap", 1000 + i);
  assert.throws(() => takeSend("u-cap", 2000), (e: { status?: number }) => e.status === 429);
  takeSend("u-other", 2000); // other users unaffected
  takeSend("u-cap", 1000 + 3_600_000); // the oldest one has aged out
});

test("toDoc turns Docs API JSON into markdown: headings, lists, tables, styles, links, escaping", () => {
  const run = (content: string, textStyle: object = {}) => ({ textRun: { content, textStyle } });
  const para = (elements: object[], namedStyleType = "NORMAL_TEXT", bullet?: object) => ({ paragraph: { elements, paragraphStyle: { namedStyleType }, ...(bullet && { bullet }) } });
  const r = toDoc({
    title: "Plan",
    lists: { b: { listProperties: { nestingLevels: [{ glyphSymbol: "●" }, { glyphSymbol: "○" }] } }, n: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } } },
    body: { content: [
      { sectionBreak: {} },
      para([run("Goals\n")], "HEADING_1"),
      para([run("Ship "), run("fast", { bold: true }), run(" and "), run("safe ", { italic: true }), run("docs", { link: { url: "https://x.io" } }), run("\n")]),
      para([run("1. not a list * star\n")]),
      para([run("line one\u000bline two\n")]),
      para([run("\n")]),
      para([run("first\n")], "NORMAL_TEXT", { listId: "b" }),
      para([run("nested\n")], "NORMAL_TEXT", { listId: "b", nestingLevel: 1 }),
      para([run("step\n")], "NORMAL_TEXT", { listId: "n" }),
      { table: { tableRows: [
        { tableCells: [{ content: [para([run("A\n")])] }, { content: [para([run("B|C\n")])] }] },
        { tableCells: [{ content: [para([run("1\n")])] }, { content: [para([run("2\n")]), para([run("3\n")])] }] },
      ] } },
      para([{ richLink: { richLinkProperties: { title: "Spec", uri: "https://docs.google.com/d/1" } } }, run("\n")]),
    ] },
  });
  assert.equal(r.title, "Plan");
  assert.equal(r.markdown, [
    "# Goals", "",
    "Ship **fast** and *safe* [docs](https://x.io)", "",
    "1\\. not a list \\* star", "",
    "line one<br>line two", "",
    "- first", "    - nested", "1. step", "",
    "| A | B\\|C |", "| --- | --- |", "| 1 | 2<br>3 |", "",
    "[Spec](https://docs.google.com/d/1)",
  ].join("\n"));
  assert.throws(() => toDoc({ title: 1 }), (e: { status?: number }) => e.status === 502);
});
