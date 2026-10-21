import { z } from "zod";
import { ALL_PERMISSION_KEYS } from "./permissions";
import { STATUSES } from "./status";

export const isValidIso = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

const Iso = z.string().refine(isValidIso, "Invalid date (YYYY-MM-DD)");
export const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((c) => c.toLowerCase());
const ExpectedUpdatedAt = z.iso.datetime();

// ---- response shape (API, dummy-data.json, export) ----
const TaskCore = z.object({
  id: z.string(),
  parentId: z.string().nullable().optional(), // set on subtasks only
  name: z.string().min(1).max(140),
  owner: z.string().max(80),
  start: Iso,
  end: Iso,
  progress: z.number().int().min(0).max(100),
  status: z.enum(STATUSES),
  isMilestone: z.boolean(),
  dependsOn: z.array(z.string()),
  description: z.string(),
  updatedAt: z.string().optional(), // DB mode only
});
export const SubtaskShape = TaskCore;
// A subtask is a TaskCore with a parentId. One level only, so subtasks carry no subtasks of their own.
export const TaskShape = TaskCore.extend({ subtasks: z.array(SubtaskShape).optional() }); // absent = none

export const WorkstreamShape = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  owner: z.string().max(80),
  goal: z.string().max(400),
  tasks: z.array(TaskShape),
  updatedAt: z.string().optional(), // DB mode only
});

export const DashboardData = z.object({ workstreams: z.array(WorkstreamShape) });
export type DashboardData = z.infer<typeof DashboardData>;

// ---- inputs ----
const TaskBase = z.object({
  name: z.string().trim().min(1).max(140),
  workstreamId: z.string().min(1),
  owner: z.string().trim().max(80),
  start: Iso,
  end: Iso,
  progress: z.number().int().min(0).max(100),
  status: z.enum(STATUSES),
  isMilestone: z.boolean(),
  dependsOn: z.array(z.string()),
  description: z.string().default(""),
});

const taskRules = (t: z.infer<typeof TaskBase>, ctx: z.RefinementCtx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (t.end < t.start) bad("end", "End date must be on or after the start date");
  if (t.isMilestone && t.start !== t.end) bad("start", "A milestone must start and end on the same day");
  if (t.status === "Done" && t.progress !== 100) bad("progress", "A Done task must be 100% complete");
};

// parentId: create as a subtask. Not on TaskUpdate: a task never changes parent (except via /promote).
export const TaskInput = TaskBase.extend({ parentId: Id.nullish() }).superRefine(taskRules);
export const TaskUpdate = TaskBase.extend({ expectedUpdatedAt: ExpectedUpdatedAt }).superRefine(taskRules);

const WorkstreamBase = z.object({
  name: z.string().trim().min(1).max(60),
  owner: z.string().trim().max(80),
  goal: z.string().max(400),
  color: Color,
});
export const WorkstreamInput = WorkstreamBase;
export const WorkstreamUpdate = WorkstreamBase.extend({ expectedUpdatedAt: ExpectedUpdatedAt });

// bcrypt ignores everything after 72 bytes, and non-ASCII characters take several bytes
export const Password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .refine((p) => new TextEncoder().encode(p).length <= 72, "Password must be at most 72 bytes");

export const LoginInput = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(200), // not held to the >=10 rule: seeded passwords are shorter
});

export const PasswordChange = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: Password })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ["newPassword"], message: "New password must differ from the current one" });

const Username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "3–32 chars: a-z 0-9 . _ -");
export const UsernameChange = z.object({ currentPassword: z.string().min(1).max(200), username: Username });
export const ActorRename = z.object({ name: z.string().trim().min(1, "Name is required").max(80) });
export const ActorMerge = z.object({ intoId: z.string().min(1) });
export const UserCreate = z.object({ username: Username, password: Password, roleId: z.string().min(1), isActive: z.boolean().default(true) });
export const UserPatch = z.object({ roleId: z.string().min(1), isActive: z.boolean(), password: Password }).partial();

const PermissionKeys = z.array(z.enum(ALL_PERMISSION_KEYS as [string, ...string[]]));
export const RoleCreate = z.object({ name: z.string().trim().min(1).max(40), description: z.string().max(200).default(""), permissionKeys: PermissionKeys });
export const RolePatch = z.object({ name: z.string().trim().min(1).max(40), description: z.string().max(200), permissionKeys: PermissionKeys }).partial();

export type Task = z.infer<typeof TaskShape>;
export type Subtask = z.infer<typeof SubtaskShape>;
export type Workstream = z.infer<typeof WorkstreamShape>;
