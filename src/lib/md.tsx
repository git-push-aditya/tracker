import type { ReactNode } from "react";

// Tiny markdown: paragraphs, "- " bullets, **bold**. Returns React nodes (escaped by React), not an HTML string.
const inline = (s: string): ReactNode[] =>
  s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));

export function md(src: string | null | undefined): ReactNode {
  const out: ReactNode[] = [];
  let para: string[] = [], list: string[] = [];
  const flushP = () => {
    if (!para.length) return;
    out.push(<p key={out.length}>{para.flatMap((l, i) => (i ? [<br key={"b" + i} />, ...inline(l)] : inline(l)))}</p>);
    para = [];
  };
  const flushL = () => {
    if (!list.length) return;
    out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of String(src || "").replace(/\r/g, "").split("\n")) {
    const l = raw.trim();
    if (!l) { flushP(); flushL(); continue; }
    const m = l.match(/^[-*•]\s+(.*)$/);
    if (m) { flushP(); list.push(m[1]); } else { flushL(); para.push(l); }
  }
  flushP(); flushL();
  return out.length ? out : <p style={{ color: "var(--muted)" }}>No description yet — click Edit to add one.</p>;
}

export function plain(src: string | null | undefined, n: number) {
  const s = String(src || "").replace(/\*\*/g, "").replace(/\n+/g, " ").replace(/\s-\s/g, " · ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
