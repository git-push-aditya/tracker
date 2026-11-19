"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { GOOGLE_LABELS, GOOGLE_TOOLKITS, type GoogleStatus, type GoogleToolkit } from "@/lib/google-toolkits";
import { ACTORS_KEY, type ActorRow } from "@/hooks/v2/useActors";
import { can } from "@/lib/auth-rules";
import { wsVars } from "@/lib/palette";
import { cn } from "@/lib/v2-utils";
import { PasswordChange } from "@/lib/schemas";
import type { Workstream } from "@/lib/schemas";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type User = { id: string; username: string; isActive: boolean; mustChangePassword: boolean; role: { id: string; name: string } };
type Role = { id: string; name: string };

function PasswordInput(props: React.ComponentProps<"input">) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative flex">
      <Input {...props} type={shown ? "text" : "password"} className="pr-10" />
      <button type="button" className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2" aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown} onClick={() => setShown((v) => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />{shown && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </span>
  );
}

// One small form: validates, calls the API, shows the error or a success note.
function SetForm({ title, button, onSubmit, children }: {
  title: string; button: string; onSubmit: (f: FormData) => Promise<string | void>; children: React.ReactNode;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="grid content-start gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      setBusy(true); setMsg(null);
      try {
        const text = await onSubmit(new FormData(form));
        form.reset(); setMsg({ ok: true, text: text || "Saved" });
      } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : "Something went wrong" }); }
      finally { setBusy(false); }
    }}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
      <p className={msg?.ok ? "text-sm text-emerald-600" : "text-destructive text-sm"} role="status" aria-live="polite">{msg?.text}</p>
      <Button className="justify-self-start" type="submit" disabled={busy}>{busy ? "Saving…" : button}</Button>
    </form>
  );
}

const val = (f: FormData, k: string) => String(f.get(k) ?? "");
const tempPassword = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("");
};

const Section = ({ title, desc, action, children }: { title: string; desc?: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <Card className="shadow-sm">
    <CardHeader className="flex-row items-start justify-between gap-4">
      <div className="grid gap-1.5"><CardTitle>{title}</CardTitle>{desc && <CardDescription>{desc}</CardDescription>}</div>
      {action}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

function Account() {
  const qc = useQueryClient();
  return (
    <Section title="Account" desc="Change how you sign in.">
      <div className="grid gap-8 md:grid-cols-2">
        <SetForm title="Change username" button="Update username" onSubmit={async (f) => {
          const r = await api<{ username: string }>("PATCH", "/api/auth/username", { currentPassword: val(f, "currentPassword"), username: val(f, "username") });
          await qc.invalidateQueries({ queryKey: ["me"] });
          return `Username is now ${r.username}`;
        }}>
          <div className="grid gap-1.5"><Label>New username</Label><Input name="username" autoComplete="username" required /></div>
          <div className="grid gap-1.5"><Label>Current password</Label><PasswordInput name="currentPassword" autoComplete="current-password" required /></div>
        </SetForm>
        <SetForm title="Change password" button="Update password" onSubmit={async (f) => {
          const r = PasswordChange.safeParse({ currentPassword: val(f, "currentPassword"), newPassword: val(f, "newPassword") });
          if (!r.success) throw new Error(r.error.issues[0].message);
          if (val(f, "newPassword") !== val(f, "confirm")) throw new Error("The new passwords don't match.");
          await api("PATCH", "/api/auth/password", r.data);
          return "Password changed. Other devices were signed out.";
        }}>
          <div className="grid gap-1.5"><Label>Current password</Label><PasswordInput name="currentPassword" autoComplete="current-password" required /></div>
          <div className="grid gap-1.5"><Label>New password</Label><PasswordInput name="newPassword" autoComplete="new-password" required /></div>
          <div className="grid gap-1.5"><Label>Confirm new password</Label><PasswordInput name="confirm" autoComplete="new-password" required /></div>
        </SetForm>
      </div>
    </Section>
  );
}

function Workstreams({ workstreams, canCreate, canEdit }: { workstreams: Workstream[]; canCreate: boolean; canEdit: boolean }) {
  return (
    <Section title="Workstreams" desc="Each one gets its own tab in the sidebar."
      action={canCreate && <Button type="button" id="btnAddWs">+ New workstream</Button>}>
      <ul className="divide-y">
        {workstreams.map((w) => (
          <li key={w.id} className="c-ws flex items-center gap-3 py-2.5" style={wsVars(w.color)}>
            <span className="size-2.5 rounded-[3px] bg-[var(--c)]" />
            <b className="text-sm">{w.name}</b>
            <span className="text-muted-foreground text-sm">{w.tasks.length} tasks{w.owner ? ` · ${w.owner}` : ""}</span>
            {canEdit && <Button className="ml-auto" size="sm" variant="outline" type="button" data-edit-ws={w.id}>Edit</Button>}
          </li>
        ))}
        {!workstreams.length && <li className="text-muted-foreground py-2.5 text-sm">No workstreams yet.</li>}
      </ul>
    </Section>
  );
}

function Google() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["google-status"], queryFn: () => api<Record<GoogleToolkit, GoogleStatus>>("GET", "/api/integrations/google") });
  const act = useMutation({
    mutationFn: async ({ toolkit, connect }: { toolkit: GoogleToolkit; connect: boolean }) => {
      if (!connect) return api("DELETE", `/api/integrations/google/${toolkit}`);
      const { redirectUrl } = await api<{ redirectUrl: string }>("POST", `/api/integrations/google/${toolkit}`);
      location.assign(redirectUrl); // Google sign-in on Composio's page, then back here with ?connected=
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["google-status"] }),
  });
  // Back from sign-in: drop the hint from the URL; the status query re-checks with the server
  useEffect(() => {
    const u = new URL(location.href);
    if (u.searchParams.has("connected")) { u.searchParams.delete("connected"); history.replaceState(history.state, "", u); }
  }, []);
  const err = act.error ?? q.error;
  return (
    <Section title="Connected accounts" desc="Connect your own Google account to use Gmail, Calendar, Docs and Sheets here. Each product asks for its own permission.">
      {err && <p className="text-destructive mb-3 text-sm" role="alert">{(err as ApiError).message}</p>}
      <ul className="divide-y">
        {GOOGLE_TOOLKITS.map((t) => {
          const st = q.data?.[t];
          const pending = act.isPending && act.variables?.toolkit === t;
          return (
            <li key={t} className="flex items-center gap-3 py-2.5">
              <b className="text-sm">{GOOGLE_LABELS[t]}</b>
              {st === "connected" && <Badge variant="secondary">Connected</Badge>}
              {st === "expired" && <Badge variant="destructive">Needs reconnect</Badge>}
              {st && (
                <Button className="ml-auto" size="sm" variant={st === "connected" ? "outline" : "default"} type="button" disabled={act.isPending}
                  onClick={() => act.mutate({ toolkit: t, connect: st !== "connected" })}>
                  {pending ? "…" : st === "connected" ? "Disconnect" : st === "expired" ? "Reconnect" : "Connect"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function RoleSelect({ roles, ...props }: { roles?: Role[] } & React.ComponentProps<typeof Select>) {
  return (
    <Select {...props}>
      <SelectTrigger className="w-44"><SelectValue placeholder="Role" /></SelectTrigger>
      <SelectContent>{roles?.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function People() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ACTORS_KEY, queryFn: () => api<{ actors: ActorRow[] }>("GET", "/api/actors"), staleTime: Infinity, refetchOnWindowFocus: false });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const done = () => { // owner text changes on tasks, workstreams and history rows
    void qc.invalidateQueries({ queryKey: ACTORS_KEY }); void qc.invalidateQueries({ queryKey: ["dashboard"] }); void qc.invalidateQueries({ queryKey: ["history"] });
  };
  const act = useMutation({
    mutationFn: (v: { method: string; path: string; body?: object }) => api(v.method, v.path, v.body),
    onSuccess: () => { setEditing(null); done(); },
  });
  const actors = q.data?.actors ?? [];
  return (
    <Section title="People" desc="Everyone who can own a task or workstream. Merge duplicates here; they are not login accounts.">
      {act.error && <p className="text-destructive mb-3 text-sm" role="alert">{(act.error as ApiError).message}</p>}
      <Table>
        <TableHeader className="bg-muted/60">
          <TableRow><TableHead>Name</TableHead><TableHead>Tasks</TableHead><TableHead>Workstreams</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {actors.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">
                {editing?.id === a.id ? (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act.mutate({ method: "PATCH", path: `/api/actors/${a.id}`, body: { name: editing.name } }); }}>
                    <Input autoFocus value={editing.name} maxLength={80} aria-label={`New name for ${a.name}`} onChange={(e) => setEditing({ id: a.id, name: e.target.value })} />
                    <Button size="sm" type="submit" disabled={act.isPending}>Save</Button>
                    <Button size="sm" variant="outline" type="button" onClick={() => setEditing(null)}>Cancel</Button>
                  </form>
                ) : a.name}
              </TableCell>
              <TableCell>{a.taskCount}</TableCell>
              <TableCell>{a.workstreamCount}</TableCell>
              <TableCell className="flex justify-end gap-2">
                <Button size="sm" variant="outline" type="button" onClick={() => setEditing({ id: a.id, name: a.name })}>Rename</Button>
                <Select value="" onValueChange={(intoId) => {
                  const into = actors.find((x) => x.id === intoId);
                  if (into && confirm(`Merge "${a.name}" into "${into.name}"? Everything "${a.name}" owns moves to "${into.name}".`)) act.mutate({ method: "POST", path: `/api/actors/${a.id}/merge`, body: { intoId } });
                }}>
                  <SelectTrigger size="sm" className="w-36" aria-label={`Merge ${a.name} into`}><SelectValue placeholder="Merge into…" /></SelectTrigger>
                  <SelectContent>{actors.filter((x) => x.id !== a.id).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="text-destructive" type="button" disabled={a.taskCount + a.workstreamCount > 0}
                  title={a.taskCount + a.workstreamCount > 0 ? "Still owns work: merge instead" : undefined}
                  onClick={() => confirm(`Delete "${a.name}"?`) && act.mutate({ method: "DELETE", path: `/api/actors/${a.id}` })}>Delete</Button>
              </TableCell>
            </TableRow>
          ))}
          {!actors.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground py-6 text-center">{q.isPending ? "Loading…" : "No people yet. They appear when you give a task or workstream an owner."}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Section>
  );
}

function Team({ me }: { me: string }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: User[] }>("GET", "/api/users"), select: (d) => d.users });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: Role[] }>("GET", "/api/roles"), select: (d) => d.roles });
  const [pw, setPw] = useState(tempPassword);
  const patch = useMutation({
    mutationFn: (v: { id: string; body: object }) => api("PATCH", `/api/users/${v.id}`, v.body),
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
  return (
    <Section title="Team" desc="Invite people and choose what they can do.">
      {patch.error && <p className="text-destructive mb-3 text-sm" role="alert">{(patch.error as ApiError).message}</p>}
      <Table>
        <TableHeader className="bg-muted/60">
          <TableRow><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {users.data?.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">
                {u.username}
                {u.username === me && <span className="text-muted-foreground font-normal"> (you)</span>}
                {u.mustChangePassword && <Badge className="ml-2" variant="outline">invited</Badge>}
              </TableCell>
              <TableCell>
                <RoleSelect roles={roles.data} value={u.role.id} disabled={u.username === me}
                  onValueChange={(roleId) => patch.mutate({ id: u.id, body: { roleId } })} />
              </TableCell>
              <TableCell>
                <Button size="sm" variant={u.isActive ? "outline" : "secondary"} type="button" disabled={u.username === me}
                  onClick={() => patch.mutate({ id: u.id, body: { isActive: !u.isActive } })}>
                  {u.isActive ? "Active · deactivate" : "Inactive · activate"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-8">
        <SetForm title="Invite a user" button="Create user" onSubmit={async (f) => {
          await api("POST", "/api/users", { username: val(f, "username"), password: val(f, "password"), roleId: val(f, "roleId") });
          await qc.invalidateQueries({ queryKey: ["users"] });
          const text = `Created ${val(f, "username")}. Share the username and this temporary password; they must change it at first sign-in.`;
          setPw(tempPassword());
          return text;
        }}>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-1.5"><Label>Username</Label><Input name="username" required autoComplete="off" /></div>
            <div className="grid gap-1.5"><Label>Role</Label><RoleSelect roles={roles.data} name="roleId" required /></div>
            <div className="grid gap-1.5"><Label>Temporary password</Label><Input name="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="off" /></div>
          </div>
        </SetForm>
      </div>
    </Section>
  );
}

// Backup and restore. The file round-trips everything the app stores except accounts (see /api/export).
function Data({ demo, canImport, onExport, onImport }: { demo: boolean; canImport: boolean; onExport: () => Promise<void>; onImport: (f: File) => Promise<void> }) {
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const run = (kind: "export" | "import", p: Promise<void>) => { setBusy(kind); p.finally(() => setBusy(null)); };
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Import and export</CardTitle>
        <CardDescription>
          {demo ? "Download or load the workstreams and tasks in this browser session."
            : "A JSON backup of all workstreams, tasks and subtasks at every level, dependencies, descriptions, people and history. Logins and roles aren't included."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={!!busy} onClick={() => run("export", onExport())}>{busy === "export" ? "Exporting…" : "Export JSON"}</Button>
          {canImport && (
            <label className={cn(buttonVariants({ variant: "outline" }), busy ? "pointer-events-none opacity-50" : "cursor-pointer")}>
              {busy === "import" ? "Importing…" : "Import JSON"}
              <input type="file" accept="application/json,.json" className="sr-only" disabled={!!busy}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run("import", onImport(f)); }} />
            </label>
          )}
        </div>
        {canImport && (
          <p className="text-muted-foreground text-xs">
            Importing <b>replaces</b> every workstream and task with the file&apos;s. {!demo && "People are added if missing, and history entries are merged in, never removed."} Export first if you might want the current data back.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function Settings({ workstreams, user, demo, permissions, onExport, onImport }: {
  workstreams: Workstream[]; user?: { username: string; role: string }; demo: boolean; permissions: string[];
  onExport: () => Promise<void>; onImport: (f: File) => Promise<void>;
}) {
  return (
    <>
      <h1 className="font-display text-[28px] leading-[1.2] font-bold">Settings</h1>
      <p className="text-muted-foreground text-sm">Account, workstreams and team</p>
      <div className="mt-6 grid gap-6">
        {demo ? <Card><CardContent className="text-muted-foreground text-sm">Account and team settings need the database; this is demo mode.</CardContent></Card> : <Account />}
        {!demo && can(permissions, "integrations:google") && <Google />}
        <Workstreams workstreams={workstreams} canCreate={can(permissions, "workstream:create")} canEdit={can(permissions, "workstream:update")} />
        {!demo && can(permissions, "actors:manage") && <People />}
        {!demo && can(permissions, "users:manage") && can(permissions, "roles:read") && <Team me={user?.username ?? ""} />}
        <Data demo={demo} canImport={demo || can(permissions, "data:import")} onExport={onExport} onImport={onImport} />
      </div>
    </>
  );
}
