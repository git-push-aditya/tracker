"use client";
import { ChevronRight, History as HistoryIcon, LayoutDashboard, LogOut, MoreVertical, PanelLeft, Plus, Search, Settings as Cog, SunMoon } from "lucide-react";
import Link from "next/link";
import { Collapsible } from "radix-ui";
import { fmt, toDay } from "@/lib/date";
import { searchTasks, type Field } from "@/lib/task-search";
import { useState } from "react";
import { WorkstreamIcon } from "@/components/icon";
import { cn } from "@/lib/v2-utils";
import { wsVars } from "@/lib/palette";
import type { Workstream } from "@/lib/schemas";
import { Logo } from "./ui";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import {
  Sidebar as Shell, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "./ui/sidebar";

// Monochrome rows: muted icon + label, white "card" for the active one (colours come from --side-* in v2.css).
const ROW = "h-8 gap-2.5 rounded-lg px-2.5 text-[13px] text-[var(--side-ink)] [&_svg]:size-4 [&_svg]:stroke-[1.5] [&_svg]:text-[var(--side-icon)] " +
  "data-[active=true]:bg-[var(--side-active)] data-[active=true]:font-medium data-[active=true]:text-[var(--side-ink-strong)] " +
  "data-[active=true]:shadow-[0_1px_2px_rgba(0,0,0,.06)] data-[active=true]:[&_svg]:text-[var(--side-ink-strong)]";
const MATCH: Record<Field, string> = { name: "Matched task name", description: "Matched description", workstream: "Matched workstream", owner: "Matched owner" };
const TINY = "text-[var(--side-icon)] hover:text-[var(--side-ink-strong)] flex size-5 items-center justify-center rounded-md hover:bg-sidebar-accent focus-visible:ring-2 ring-sidebar-ring outline-hidden";

export function Sidebar({ workstreams, path, user, themeLabel, canCreate, onLogout, onPickTask }: {
  workstreams: Workstream[]; path: string; user?: { username: string; role: string }; themeLabel: string;
  canCreate: boolean; onLogout: () => void; onPickTask: (taskId: string, wsId: string) => void;
}) {
  const { state, toggleSidebar } = useSidebar();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(true);
  const collapsed = state === "collapsed";
  const results = searchTasks(workstreams, q);
  const pick = (taskId: string, wsId: string) => { setQ(""); onPickTask(taskId, wsId); };

  return (
    <Shell collapsible="icon" variant="inset">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <div className="flex items-center gap-2.5 px-1">
          <Logo height={22} />
          <span className="font-heading text-[15px] font-semibold text-[var(--side-ink-strong)] group-data-[collapsible=icon]:hidden">Prime Care</span>
        </div>
        <Popover open={q.trim() !== ""}>
          <PopoverAnchor asChild>
            <div className="relative group-data-[collapsible=icon]:hidden">
              <Search className="text-[var(--side-icon)] pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" strokeWidth={1.5} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks"
                onKeyDown={(e) => { if (e.key === "Escape") setQ(""); if (e.key === "Enter" && results[0]) pick(results[0].t.id, results[0].ws.id); }}
                className="h-9 w-full rounded-[10px] bg-[var(--side-input)] pr-3 pl-9 text-[13px] text-[var(--side-ink-strong)] outline-none placeholder:text-[var(--side-icon)] focus-visible:ring-2 focus-visible:ring-[var(--side-icon)]/40" />
            </div>
          </PopoverAnchor>
          <PopoverContent align="start" sideOffset={6} className="w-80 p-1" onOpenAutoFocus={(e) => e.preventDefault()} onInteractOutside={() => setQ("")}>
            {results.length ? (
              <ul role="listbox" aria-label="Task results" className="max-h-96 overflow-y-auto">
                {results.map(({ ws, t, field }) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => pick(t.id, ws.id)} className="hover:bg-accent focus-visible:bg-accent grid w-full gap-0.5 rounded-md px-2.5 py-2 text-left outline-hidden">
                      <span className="truncate text-[13px] font-medium">{t.name}</span>
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <span className="c-ws size-1.5 shrink-0 rounded-full bg-[var(--c)]" style={wsVars(ws.color)} />
                        <span className="truncate">{ws.name} · {t.owner || "no owner"} · due {fmt(toDay(t.end))}</span>
                      </span>
                      <span className="text-muted-foreground text-xs">{MATCH[field]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground px-3 py-4 text-center text-sm">No tasks match “{q.trim()}”.</p>}
          </PopoverContent>
        </Popover>
      </SidebarHeader>

      <SidebarContent className="gap-1 px-3">
        <SidebarGroup className="p-0">
          <SidebarMenu className="gap-0.5">
            {(
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={path === "/v2"} tooltip="Dashboard" className={ROW}>
                  <Link href="/v2" aria-current={path === "/v2" ? "page" : undefined}><LayoutDashboard /><span>Dashboard</span></Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={path === "/v2/history"} tooltip="History" className={ROW}>
                <Link href="/v2/history" aria-current={path === "/v2/history" ? "page" : undefined}><HistoryIcon /><span>History</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {(
          <Collapsible.Root open={open || collapsed} onOpenChange={setOpen} asChild>
            <SidebarGroup className="group/ws p-0">
              <div className="flex h-8 items-center gap-1 px-1 group-data-[collapsible=icon]:hidden">
                <Collapsible.Trigger className="text-[var(--side-icon)] hover:text-[var(--side-ink-strong)] flex flex-1 items-center gap-1 rounded-md text-xs font-medium outline-hidden focus-visible:ring-2 ring-sidebar-ring">
                  <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} strokeWidth={1.5} />
                  Workstreams
                </Collapsible.Trigger>
                <span className="flex gap-0.5 opacity-0 transition-opacity group-focus-within/ws:opacity-100 group-hover/ws:opacity-100">
                  {canCreate ? (
                    <button id="btnAddWs" type="button" className={TINY} aria-label="New workstream"><Plus className="size-3.5" strokeWidth={1.5} /></button>
                  ) : (
                    // TODO: enable for roles that may not create workstreams once there is a request flow
                    <button type="button" className={cn(TINY, "opacity-40")} disabled aria-label="New workstream (not allowed)"><Plus className="size-3.5" strokeWidth={1.5} /></button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger className={TINY} aria-label="Workstream options"><MoreVertical className="size-3.5" strokeWidth={1.5} /></DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem asChild><Link href="/v2/settings">Manage workstreams</Link></DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </div>
              <Collapsible.Content>
                <SidebarMenu className="gap-0.5">
                  {workstreams.map((w) => {
                    const href = `/v2/ws/${w.id}`, active = path === href;
                    return (
                      <SidebarMenuItem key={w.id}>
                        <SidebarMenuButton asChild isActive={active} tooltip={w.name} className={ROW}>
                          <Link href={href} aria-current={active ? "page" : undefined}>
                            <WorkstreamIcon id={w.id} name={w.name} strokeWidth={1.5} />
                            <span>{w.name}</span>
                            <span className="c-ws ml-1 size-1.5 shrink-0 rounded-full bg-[var(--c)] group-data-[collapsible=icon]:hidden" style={wsVars(w.color)} aria-hidden="true" />
                          </Link>
                        </SidebarMenuButton>
                        {w.tasks.length > 0 && <SidebarMenuBadge className="text-xs font-normal text-[var(--side-icon)] tabular-nums">{w.tasks.length}</SidebarMenuBadge>}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </Collapsible.Content>
            </SidebarGroup>
          </Collapsible.Root>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-0.5 px-3 pb-3">
        <SidebarMenu className="gap-0.5">
          {(
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={path === "/v2/settings"} tooltip="Settings" className={ROW}>
                <Link href="/v2/settings" aria-current={path === "/v2/settings" ? "page" : undefined}><Cog /><span>Settings</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton id="btnTheme" type="button" tooltip={themeLabel} className={ROW}><SunMoon /><span>{themeLabel}</span></SidebarMenuButton>
          </SidebarMenuItem>
          {user && (
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton tooltip={user.username} className={cn(ROW, "pr-1.5")}>
                    <span className="bg-[var(--side-input)] flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium text-[var(--side-ink-strong)] uppercase">{user.username[0]}</span>
                    <span className="flex-1 truncate">{user.username}</span>
                    <MoreVertical className="ml-auto group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-48">
                  <div className="text-muted-foreground px-2 py-1.5 text-xs">{user.role}</div>
                  <DropdownMenuItem onSelect={onLogout}><LogOut />Log out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem className="hidden md:block">
            <SidebarMenuButton type="button" onClick={toggleSidebar} tooltip={collapsed ? "Expand" : "Collapse"} className={ROW}>
              <PanelLeft /><span>Collapse</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Shell>
  );
}
