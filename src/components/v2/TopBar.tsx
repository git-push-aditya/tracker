import { ChevronRight, FileText } from "lucide-react";
import { SidebarTrigger } from "./ui/sidebar";

const TITLES = { dashboard: "Dashboard", settings: "Settings", history: "History" } as const;

// Sticky 52px bar at the top of the content card: page icon + breadcrumb, last segment as a pill.
export function TopBar({ view, wsName }: { view: "dashboard" | "ws" | "settings" | "history"; wsName?: string }) {
  const trail = view === "ws" ? ["Workstreams", wsName ?? "Not found"] : [TITLES[view]];
  return (
    <div className="bg-[var(--side-card)] border-[var(--side-card-border)] sticky top-0 z-30 font-heading flex h-[52px] shrink-0 items-center gap-2 border-b px-4 text-[13px]">
      <SidebarTrigger className="md:hidden" />
      <FileText className="text-muted-foreground size-4" strokeWidth={1.5} aria-hidden="true" />
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5">
        {trail.map((t, i) => (
          <span key={t} className="flex items-center gap-1.5">
            <ChevronRight className="text-muted-foreground size-3.5" strokeWidth={1.5} aria-hidden="true" />
            <span className={i === trail.length - 1 ? "bg-muted rounded-md px-2 py-0.5 font-medium" : "text-muted-foreground"}
              aria-current={i === trail.length - 1 ? "page" : undefined}>{t}</span>
          </span>
        ))}
      </nav>
    </div>
  );
}
