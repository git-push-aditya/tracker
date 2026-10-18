// Single source of truth for permission keys; synced to the DB by prisma/seed.ts.
export const PERMISSIONS = {
  "dashboard:read": "View the dashboard",
  "workstream:create": "Create workstreams",
  "workstream:update": "Edit workstreams",
  "workstream:delete": "Delete workstreams",
  "task:create": "Create tasks",
  "task:update": "Edit tasks",
  "task:delete": "Delete tasks",
  "data:import": "Import data (replaces everything)",
  "users:read": "List users",
  "users:manage": "Create, edit and delete users",
  "roles:read": "List roles and permissions",
  "roles:manage": "Create, edit and delete roles",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];
export const VIEWONLY_PERMISSION_KEYS: PermissionKey[] = ["dashboard:read"];
