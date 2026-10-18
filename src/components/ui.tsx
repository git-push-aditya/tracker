import type { CSSProperties } from "react";
import { STATUS_META, type StatusLabel } from "@/lib/status";

// Prime Care logo (shield + heartbeat), as published on the official site
export function Logo({ height = 40 }: { height?: number }) {
  return (
    <svg viewBox="0 3 76 88" height={height} width={(height * 76) / 88} aria-hidden="true">
      <path d="M38 4L70 4Q76 4 76 12L76 50Q73 72 38 90Q3 72 0 50L0 12Q0 4 6 4Z" fill="#0C6868" /><polyline points="8,47 36,47 40,29 44,67 49,47 55,41 61,47 72,47" fill="none" stroke="#FFFFFF" strokeOpacity="0.88" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatusBadge({ status }: { status: StatusLabel }) {
  const m = STATUS_META[status];
  return (
    <span className={`badge ${m.cls}`}>
      <span className="ic" aria-hidden="true">{m.icon}</span>
      {status}
    </span>
  );
}

// icon-only badge used in the summary tiles
export function StatusIcon({ status }: { status: StatusLabel }) {
  const m = STATUS_META[status];
  return <span className={`badge ${m.cls}`} style={{ padding: "0 5px" }} aria-hidden="true">{m.icon}</span>;
}

// meter = summary tile, pbar = workstream card, mini = task
export function ProgressBar({ variant, value, label }: { variant: "meter" | "pbar" | "mini"; value: number; label: string }) {
  return (
    <div className={variant} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${value}%` } as CSSProperties} />
    </div>
  );
}

export function EmptyState({ children, panel }: { children: string; panel?: boolean }) {
  return <div className={panel ? "panel empty" : "empty"}>{children}</div>;
}

export function Toast({ message, show }: { message?: string; show?: boolean }) {
  return <div className={`toast${show ? " show" : ""}`} id="toast" role="status" aria-live="polite">{message}</div>;
}

export function DemoBanner() {
  return <div className="demo-banner" role="status">Demo data — changes are not saved</div>;
}

export function ErrorPanel({ message = "Database unreachable", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="panel error-panel" role="alert">
      <p>{message}</p>
      <button className="btn" type="button" id="btnRetry" onClick={onRetry}>Retry</button>
    </div>
  );
}
