# Prime Care Dashboard — Implementation Plan (Next.js rebuild of `refer.html`)

Goal: recreate everything in `docs/refer.html` (feature list in `docs/current.md`) as a Next.js app, pixel-perfect, backed by Postgres on Neon via Prisma, with login and role-based access, hosted on Vercel. When `DATABASE_URL` is not set, the app runs in **demo mode** on `dummy-data.json`.

Scope: `current.md` §1–2 + auth/RBAC. Items from `future works.md` are out of scope; the schema just shouldn't block them.

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (latest, App Router, TypeScript, `src/` dir) — frontend + route handlers as backend |
| Hosting | Vercel (serverless functions, Node runtime) |
| Styling | **Plain CSS copied from `refer.html`** into `globals.css`, same class names. No Tailwind |
| Validation | Zod — shared by API, import, `dummy-data.json` loading and auth |
| Server state | TanStack Query |
| DB | Postgres on **Supabase** (was Neon; see "Database provider change") |
| ORM | **Prisma 7** + `@prisma/adapter-pg` (`PrismaPg`, node-postgres pool, `max: 5`) |
| Passwords | bcrypt via `bcryptjs` (same algorithm, pure JS — no native build), cost 12 |
| Sessions | In-house: random token in an httpOnly cookie, hashed copy in a `Session` table |
| Tests | Node's built-in runner: `node --import tsx --test` |
| Package manager | npm |

## Project layout

The Next.js project lives in the **repo root `./`**. `docs/` holds reference material only.

```
/
├─ docs/                   ← refer.html, current.md, future works.md, this plan
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts              ← permissions, roles, first-install bootstrap
├─ prisma.config.ts        ← Prisma 7: datasource URL, seed command
├─ data/
│  └─ dummy-data.json
├─ scripts/
│  └─ vercel-build.mjs     ← migrate + seed on production builds only
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx        ← theme no-flash script, QueryProvider
│  │  ├─ page.tsx          ← dashboard (auth-gated unless demo mode)
│  │  ├─ login/page.tsx
│  │  ├─ change-password/page.tsx
│  │  ├─ globals.css       ← CSS from refer.html <style>, verbatim
│  │  └─ api/…             ← route handlers (Phase 2)
│  ├─ components/          ← Phase 3
│  ├─ hooks/               ← Phase 4/5
│  ├─ generated/prisma/    ← Prisma 7 client output (git-ignored, generated at build)
│  └─ lib/
│     ├─ prisma.ts         ← client singleton with Neon adapter
│     ├─ data-source.ts    ← demo-or-DB logic
│     ├─ auth.ts           ← hash/verify, sessions, getSession, requirePermission
│     ├─ auth-rules.ts     ← pure guard logic (tested)
│     ├─ permissions.ts    ← permission keys (single source of truth)
│     ├─ schemas.ts        ← Zod
│     └─ date.ts / status.ts / palette.ts / md.ts / gantt-layout.ts  ← ported from refer.html
├─ .env                    ← local secrets (git-ignored)
└─ .env.example            ← every variable, no values
```

## Core design decisions (apply to every phase)

1. **One data shape everywhere.** API response, `dummy-data.json`, Export and Import all use `refer.html`'s shape:
   `{ workstreams: [{ id, name, color, owner, goal, tasks: [{ id, name, owner, start, end, progress, status, isMilestone, dependsOn[], description }] }] }`
   Dates are `"YYYY-MM-DD"`; statuses are display strings (`"Not started"` …). Old exports stay importable. In DB mode each workstream and task also carries `updatedAt` (for conflict detection); import/export ignore it.
2. **Per-viewer UI state stays in the browser** (zoom, collapsed groups, closed cards, theme), same `localStorage` keys as today.
3. **Derived values are computed on the client, never stored:** auto-"Delayed", averages, summary counts, today line.
4. **Demo mode = `DATABASE_URL` is not set. Nothing else.**
   - The server returns `dummy-data.json` with `source: "demo"`.
   - No login — there's no users table to check against. The viewer gets full edit rights.
   - Edits live only in the TanStack Query cache and **vanish on refresh**; the API is never called for writes.
   - "Demo data — changes are not saved" banner; "Reset to sample data" visible (resets the cache).
   - Dummy data is never written to the database and never shipped in the client bundle (it's served by `/api/dashboard`).
5. **DB configured but unreachable ≠ demo mode.** The server retries once (covers Neon waking from scale-to-zero, ~1 s), then returns `503 "Database unreachable"`. The UI shows an error panel with **Retry**. Real users never get silently switched to fake data or lose the login screen.
6. **Bugs 1–7 from `current.md` §3** are fixed during the rebuild; logic/data-model gaps are not.
7. **Auth is checked on the server for every request.** The UI hiding buttons for view-only users is convenience, not security.
8. **Task/workstream `owner` stays free text**, deliberately not linked to `User`. Owners are often people who never log in (agency, partners). Linking is future work.

---

## Phase 1 — Setup, dummy data, DB design

### 1.1 Scaffold
- Run `create-next-app` in `./` (it tolerates `docs/`; otherwise scaffold in a temp dir and move the files in).
- Options: TypeScript, ESLint, App Router, `src/`, **no Tailwind**, alias `@/*`.
- Install: `prisma@7`, `@prisma/client@7`, `@prisma/adapter-neon`, `zod`, `@tanstack/react-query`, `bcryptjs`, `dotenv` (+ dev: `@tanstack/react-query-devtools`, `tsx`).
- `git init`; `.gitignore` gets `.env` and `src/generated/`.
- `.env.example` lists: `DATABASE_URL`, `DIRECT_URL`, `SEED_PASSWORD_SNEHPRIYA`, `SEED_PASSWORD_ADITYA`.

### 1.2 `data/dummy-data.json`
- `SAMPLE_DATA` from `docs/refer.html:449–554` converted to strict JSON, content unchanged (7 workstreams, 30 tasks). Validated by the shared Zod schema on load. Only imported by server code.

### 1.3 Prisma 7 + Neon
- `DATABASE_URL` = Neon **pooled** string (`-pooler` host) — used by the app at runtime. `DIRECT_URL` = direct string — used by the Prisma CLI (migrate, seed). Both `sslmode=require`.
- `schema.prisma`: generator `prisma-client` with `output = "../src/generated/prisma"`; datasource has only the provider.
- `prisma.config.ts`: `import "dotenv/config"` (Prisma 7 no longer loads `.env` itself), datasource URL = `DIRECT_URL`, seed command `tsx prisma/seed.ts`. Seeding is run explicitly (`prisma db seed`), not as a side effect of migrate.
- `src/lib/prisma.ts`: `new PrismaClient({ adapter: new PrismaNeon({ connectionString: DATABASE_URL }) })`, cached on `globalThis` so dev hot-reload doesn't leak connections. Only constructed when `DATABASE_URL` is set.
- `package.json`: `postinstall: prisma generate` (the generated client is git-ignored, so Vercel must generate it).
- Vercel function region set to the same region as the Neon project.
- Verify these Prisma 7 details against the docs at install time; they changed from v6.

### 1.4 Schema — dashboard data

**enum `TaskStatus`**: `NOT_STARTED`, `IN_PROGRESS`, `DONE`, `AT_RISK`, `DELAYED` ↔ display strings, mapped in one lookup in `lib/status.ts`.

**`Workstream`**
| Field | Type | Notes |
|---|---|---|
| id | String @id @default(cuid()) | accepts provided ids on import |
| name | String | ≤60 (Zod) |
| color | String | `#rrggbb` |
| owner | String @default("") | free text |
| goal | String @default("") | ≤400 |
| position | Int | display order |
| createdAt / updatedAt | DateTime | `updatedAt` used for conflict detection |
| tasks | Task[] | |

**`Task`**
| Field | Type | Notes |
|---|---|---|
| id | String @id @default(cuid()) | |
| workstreamId | → Workstream, **onDelete: Cascade** | |
| name | String | ≤140 |
| owner | String @default("") | ≤80, free text |
| start / end | DateTime @db.Date | |
| progress | Int | 0–100 |
| status | TaskStatus | manual status; auto-Delayed is derived |
| isMilestone | Boolean | |
| description | String @db.Text @default("") | |
| position | Int | order within workstream |
| createdAt / updatedAt | DateTime | `updatedAt` used for conflict detection |

**`TaskDependency`** — `taskId` (dependent) + `dependsOnId` (prerequisite), both → Task with **onDelete: Cascade**, `@@id([taskId, dependsOnId])`. Cascade reproduces "deleting a task removes it from other tasks' dependencies".

### 1.5 Schema — auth & RBAC

**`User`**
| Field | Type | Notes |
|---|---|---|
| id | String @id @default(cuid()) | |
| username | String @unique | stored lowercased, 3–32 chars `[a-z0-9._-]` |
| passwordHash | String | bcrypt, cost 12 — never returned by any API |
| roleId | → Role, **onDelete: Restrict** | a role in use can't be deleted |
| isActive | Boolean @default(true) | deactivate instead of delete |
| mustChangePassword | Boolean @default(false) | forces a password change before anything else |
| lastLoginAt | DateTime? | |
| createdAt / updatedAt | DateTime | |

One role per user; can become many-to-many later without touching other tables.

**`Role`**
| Field | Type | Notes |
|---|---|---|
| id | String @id @default(cuid()) | |
| name | String @unique | `admin`, `viewonly`, later e.g. `editor` |
| description | String @default("") | |
| isSystem | Boolean @default(false) | `true` for `admin` and `viewonly` → can't be deleted or renamed; `admin` can't lose permissions |
| permissions | RolePermission[] | |
| users | User[] | |

**`Permission`** — `id`, `key` String @unique (e.g. `task:update`), `description`. Defined in code (`lib/permissions.ts`), synced by the seed; can't be created through the API. Roles (bundles of permissions) can.

**`RolePermission`** — `roleId` + `permissionId`, both cascade, `@@id([roleId, permissionId])`.

**`Session`**
| Field | Type | Notes |
|---|---|---|
| id | String @id @default(cuid()) | |
| tokenHash | String @unique | SHA-256 of the cookie token |
| userId | → User, onDelete: Cascade | |
| expiresAt | DateTime | 7 days |
| createdAt | DateTime | |

**`LoginAttempt`** (rate limiting — in-memory counters don't work on Vercel, where each request can hit a fresh instance)
| Field | Type | Notes |
|---|---|---|
| id | String @id @default(cuid()) | |
| key | String | `username|ip`, @@index with createdAt |
| createdAt | DateTime @default(now()) | |

One row per **failed** login; rows for a key are deleted on successful login; rows older than 15 min are deleted lazily on each attempt.

### 1.6 Permission catalogue

| Key | admin | viewonly |
|---|:-:|:-:|
| `dashboard:read` | ✓ | ✓ |
| `workstream:create` / `workstream:update` / `workstream:delete` | ✓ | |
| `task:create` / `task:update` / `task:delete` | ✓ | |
| `data:import` | ✓ | |
| `users:read` / `users:manage` | ✓ | |
| `roles:read` / `roles:manage` | ✓ | |

Granular keys mean a future role like "editor" needs no code change. Export needs only `dashboard:read` (client-side).

### 1.7 Seed (`prisma/seed.ts`)
Runs on **every production deploy** (see 1.9), so it must be safe to repeat and must never undo what admins did in the app.

**Every run (sync):**
1. Upsert every permission from `lib/permissions.ts`.
2. Upsert roles `admin` (all permissions — so new permissions added in code reach admins automatically) and `viewonly` (`dashboard:read`), both `isSystem`.

**First install only — when the `User` table is empty:**

3. Create users, both with `mustChangePassword = true` (their passwords have been shared in plain text, so both get rotated):
   - `snehpriya` → admin, password from `SEED_PASSWORD_SNEHPRIYA`
   - `aditya` → admin, password from `SEED_PASSWORD_ADITYA`

   Hashed with bcrypt; plaintext never in the repo. The seed bypasses the ≥10-character rule (`password` is 8) — the forced change fixes that on first login.
4. Create the **7 workstreams as empty sections**, names exactly as in `refer.html`, with their original colours and ids, in this order; owner and goal blank (they were dummy), no tasks:

   | position | id | name | color |
   |---|---|---|---|
   | 0 | `product` | Product | `#2a78d6` |
   | 1 | `tech` | Tech Integrations | `#eb6834` |
   | 2 | `growth` | Growth & CRM | `#1baf7a` |
   | 3 | `sales` | Sales | `#eda100` |
   | 4 | `social` | Social Media | `#e87ba4` |
   | 5 | `media` | Media Planner | `#008300` |
   | 6 | `hiring` | Hiring | `#4a3aa7` |

Gating 3 and 4 on "no users yet" means a deleted user or a renamed/deleted workstream is never resurrected by a later deploy. Once the first deploy has run, `SEED_PASSWORD_*` can be removed from Vercel.

### 1.8 Data source module (`lib/data-source.ts`)
- `isDemoMode()` = `!process.env.DATABASE_URL`.
- `getDashboard()`:
  - demo → `{ source: "demo", workstreams: <dummy-data.json> }`
  - DB → query workstreams + tasks + deps ordered by `position` → `{ source: "db", workstreams }`
  - DB query fails → retry once, then throw `DatabaseUnavailableError` (route handlers map it to 503).

### 1.9 Deploy workflow (Vercel)
- **Environment variables:**
  - Production: `DATABASE_URL`, `DIRECT_URL`, `SEED_PASSWORD_*` (first deploy only).
  - Preview: **none** → previews run in demo mode and can't touch the production DB. (A Neon branch per preview can be added later.)
- **Build:** `package.json` `vercel-build` → `node scripts/vercel-build.mjs`, which:
  - when `VERCEL_ENV === "production"`: runs `prisma migrate deploy`, then `prisma db seed` — **any failure fails the build**, so a broken migration never goes live;
  - always runs `next build`.
- **Local:** `prisma migrate dev` against a Neon dev branch, then `prisma db seed`.

**Phase 1 done when:**
- `prisma migrate dev` creates all tables on a Neon dev branch.
- Seed run twice: permissions, 2 roles, 2 users (bcrypt hashes, `mustChangePassword = true`) and 7 empty workstreams — the second run changes nothing.
- A one-off `tsx` script calling `getDashboard()` returns demo data with `DATABASE_URL` unset, the 7 empty workstreams with `source: "db"` when set, and throws `DatabaseUnavailableError` with a wrong URL.

---

## Phase 2 — API endpoints

Route handlers under `src/app/api/`. Every body parsed with Zod → `400 { error, issues }`. `DatabaseUnavailableError` → `503`. Route `params` is a Promise in current Next.js — `await` it.

### 2.1 Auth plumbing (`lib/auth.ts`, `lib/auth-rules.ts`)
- `hashPassword` / `verifyPassword` (bcryptjs, cost 12).
- `createSession(userId)`: 32 random bytes → cookie `pc_session` (httpOnly, `Secure` in production, `SameSite=Lax`, path `/`, 7 days); store SHA-256 hash in `Session`.
- `getSession()`: cookie → hash → session (not expired) + user (`isActive`) + role + permission keys, in one query. Expired session rows deleted lazily.
- `requirePermission(key)` in every route handler: no session → **401**; `mustChangePassword` → **403 `PASSWORD_CHANGE_REQUIRED`** (except `/api/auth/me`, `/api/auth/password`, `/api/auth/logout`); missing permission → **403**. In demo mode, writes → **503** (demo writes never reach the server anyway).
- **Same-origin check** on every mutating request **including login**: `Origin` must match the host, else 403.
- Client IP for rate limiting: first value of `x-forwarded-for` (set by Vercel).
- **Pure rule functions in `auth-rules.ts`** (no DB access, so they're unit-testable): `can(permissions, key)`, `checkUserChange({ actorId, target, change, activeAdminCount })` → ok / `SELF_DELETE` / `LAST_ADMIN`, `isRateLimited(failureCount)`. Route handlers stay thin and call these.

### 2.2 Shared Zod schemas (`lib/schemas.ts`)
- `Password`: ≥10 chars and **≤72 bytes UTF-8** (bcrypt ignores everything after 72 bytes; non-English characters take several bytes, so check bytes, not characters).
- `Id` (for import): 1–64 chars `[A-Za-z0-9_-]`.
- `TaskInput`: name (1–140), workstreamId, owner (≤80), start/end (valid ISO), progress (int 0–100), status (display strings), isMilestone, dependsOn (Id[]), description. Refinements: `end ≥ start`; milestone → `start = end`; `Done` → progress 100; no self-dependency.
- `WorkstreamInput`: name (1–60), owner (≤80), goal (≤400), color (`#rrggbb`, lowercased).
- Updates add `expectedUpdatedAt` (ISO datetime) to the above.
- `DashboardData`: full shape. Import variant is **lenient like `normalize()`** (defaults, clamped progress, fixed dates, palette fallback), with `Id` rules and duplicate-id rejection.
- `LoginInput`: username, password (both required; password length-capped, but *not* held to the ≥10 rule, so existing short passwords can still log in).
- `PasswordChange`: currentPassword, newPassword (`Password`, must differ from current).
- `UserInput`: username, password (create only, `Password`), roleId, isActive.
- `RoleInput`: name, description, permissionKeys (each must exist in the catalogue).

### 2.3 Auth endpoints

| Method | Path | Permission | Does |
|---|---|---|---|
| POST | `/api/auth/login` | public | Rate-limit check → verify → create session → update `lastLoginAt` → return `{ mustChangePassword }`. Unknown username *or* wrong password → same `401 "Invalid username or password"`; for unknown usernames still run one bcrypt compare against a fixed dummy hash so timing doesn't reveal which usernames exist. 5 failures per `username|ip` in 15 min → `429` |
| POST | `/api/auth/logout` | logged in | Delete session row, clear cookie |
| GET | `/api/auth/me` | logged in | `{ user: { id, username, role, mustChangePassword }, permissions }`, or `{ demo: true }` in demo mode |
| PATCH | `/api/auth/password` | logged in | Change own password (requires current); clears `mustChangePassword`; deletes the user's *other* sessions |

### 2.4 Users & roles endpoints (no UI in this scope)

| Method | Path | Permission | Does |
|---|---|---|---|
| GET | `/api/permissions` | `roles:read` | Permission catalogue |
| GET | `/api/roles` | `roles:read` | Roles with permission keys + user count |
| POST | `/api/roles` | `roles:manage` | Create a role with chosen permissions |
| PATCH | `/api/roles/[id]` | `roles:manage` | Edit name/description/permissions. System roles: name locked; `admin` permissions locked |
| DELETE | `/api/roles/[id]` | `roles:manage` | Refused for system roles and roles still assigned to users (409) |
| GET | `/api/users` | `users:read` | List users (never `passwordHash`) |
| POST | `/api/users` | `users:manage` | Create user with role + initial password; `mustChangePassword = true` |
| PATCH | `/api/users/[id]` | `users:manage` | Change role, activate/deactivate, reset password. **Any of these deletes the target's sessions**; a password reset also sets `mustChangePassword = true` |
| DELETE | `/api/users/[id]` | `users:manage` | Delete user |

Guards (via `checkUserChange`): no deleting or deactivating **yourself**; the system always keeps **at least one active admin**. The admin count and the change run **inside one transaction with `Serializable` isolation**, retried once on a serialization conflict — so two admins demoting each other at the same moment can't leave zero admins.

### 2.5 Dashboard endpoints

| Method | Path | Permission | Does |
|---|---|---|---|
| GET | `/api/dashboard` | `dashboard:read` (none in demo) | `{ source, workstreams }`; 503 if DB unreachable |
| POST | `/api/workstreams` | `workstream:create` | Create, `position` = last |
| PUT | `/api/workstreams/[id]` | `workstream:update` | Full replace of editable fields (the dialog always sends everything) |
| DELETE | `/api/workstreams/[id]` | `workstream:delete` | Delete + cascade |
| POST | `/api/tasks` | `task:create` | Create, `position` = last, insert deps |
| PUT | `/api/tasks/[id]` | `task:update` | Full replace; workstream change → move to end of target; replace deps — one transaction |
| DELETE | `/api/tasks/[id]` | `task:delete` | Delete (deps cascade) |
| POST | `/api/import` | `data:import` | Replace all workstreams/tasks/deps in one transaction; drop deps to missing ids |

- **Conflict detection on PUT:** update `where { id, updatedAt: expectedUpdatedAt }`; if nothing matched (someone else saved first) → `409 "Changed by someone else — reload to see their version"`.
- Task create/update verifies every `dependsOn` id and the `workstreamId` exist → else 400.

Not endpoints: **Export** (client-side from cache), **Reset to sample data** (demo only, client-side), health check (`source` + 503 cover it).

### 2.6 Tests
- `src/lib/auth-rules.test.ts`: `can()` allow/deny; `checkUserChange` → self-delete, self-deactivate, last-admin demote/deactivate/delete refused, normal change allowed; `isRateLimited` boundary (4 ok, 5 blocked).
- `src/lib/schemas.test.ts`: `Password` rejects 73-byte multibyte input; `TaskInput` rejects `end < start` and self-dependency.
- `npm test` = `node --import tsx --test`.

**Phase 2 status: implemented and verified** (8 unit tests; curl run against Neon covering every item below, plus demo mode). Deviations/additions:
- Every `route.ts` is wrapped by `handle()` (`lib/http.ts`): `await connection()` first (Cache Components is on in `next.config.ts`, so `GET`s would otherwise be prerendered), then maps errors → 400/401/403/404/409/429/503. Helpers shared by routes live in `lib/` (`roles.ts`, `users.ts`, `task-deps.ts`, `import.ts`), since `route.ts` may only export HTTP methods.
- Unreachable DB surfaces from Neon's driver as a bare `ErrorEvent` (no `Error`); `handle()` maps it to 503 and retries `GET`s once. Writes are never retried.
- A missing `Origin` header on a mutating request is also rejected (curl needs `-H "Origin: http://host"`).
- Demo mode: only `GET /api/dashboard` and `GET /api/auth/me` answer; everything else is 503.

**Phase 2 done when:** `npm test` passes, plus a curl run against the Neon dev branch:
- log in as each admin → `mustChangePassword` → every dashboard call 403 until the password is changed → then it works;
- each dashboard/user/role endpoint: happy path + one Zod rejection;
- a `viewonly` user (created via `POST /api/users`): 200 on GET, 403 on every write;
- no cookie → 401; wrong `Origin` → 403; 6th bad login → 429; stale `expectedUpdatedAt` → 409;
- wrong `DATABASE_URL` → 503.

---

## Phase 3 — Frontend components (static, pixel-perfect, not wired)

Rule: **copy, don't redesign.** The whole `<style>` block from `refer.html` goes into `globals.css` unchanged. Components output the **same DOM and class names** `refer.html` generates. System font stack, so no `next/font`. Components take plain props, rendered from `dummy-data.json` with a fixed "today", no state.

### Pure helper modules (ported as-is from the `<script>`)
- `lib/date.ts`: `isISO, toDay, iso, todayDay, parts, monthStart, addMonths, quarterStart, fmtShort, fmt`
- `lib/status.ts`: `STATUSES, STATUS_META, effStatus`
- `lib/palette.ts`: `PALETTE, DARK_STEP, wsColor`
- `lib/md.ts`: `md` → React nodes (not an HTML string), `plain`
- `lib/gantt-layout.ts`: range per zoom, header tiers, `X()`, row y-positions, dependency arrow paths (`refer.html:825–826`). Gets `gantt-layout.test.ts` (tier boundaries per zoom, both arrow path shapes).

### Component inventory

| Component | Source in refer.html | Notes |
|---|---|---|
| `Header` | `.top` / `.brand` / `.actions` | logo, title, date, action buttons |
| `ThemeButton` | `#btnTheme` | |
| `UserMenu` | new | username + role badge + Log out, from existing `.btn` / `.badge`; hidden in demo |
| `StatsBar` + `StatTile` | `renderSummary` | |
| `StatusBadge` | `badge()` | |
| `ProgressBar` | `.meter` / `.pbar` / `.mini` | variant prop |
| `GanttPanel` | `.panel` | |
| `GanttToolbar` | `.panel-head` | live dot, `ZoomSegment`, Jump to today, Collapse all |
| `FilterBar` | `.filters` | |
| `Gantt` | `renderGantt` | |
| `GanttHeader` | `.g-head` / `.g-tiers` | TODAY pill |
| `GanttOverlay` | `.g-overlay` | gridlines, weekends, today line |
| `DependencyArrows` | `svg.deps` | |
| `GanttGroupRow` | `.g-row.group` | |
| `GanttTaskRow` | `.g-row` | |
| `TaskBar` | `.bar` | |
| `MilestoneDiamond` | `.ms` | |
| `BarMeta` | `.meta` | |
| `Legend` | `#legend` | |
| `Tooltip` | `.tip` | |
| `DetailsSection` | `.section-head` | |
| `WorkstreamCard` | `.ws-card` | |
| `TaskArticle` | `.task` | |
| `TaskDialog` | `#taskDlg` | native `<dialog>` |
| `WorkstreamDialog` | `#wsDlg` | |
| `ColorChips` | `.chips` | |
| `Toast` | `.toast` | |
| `Footer` | `footer` | Reset only in demo |
| `EmptyState` | `.empty` | "No tasks yet" vs "No tasks match these filters" |
| `DemoBanner` | new | "Demo data — changes are not saved"; warning tokens |
| `ErrorPanel` | new | "Database unreachable" + Retry; `.panel` + critical tokens |
| `AuthCard` | new | centred `.panel` with the logo; shell for the two forms below |
| `LoginForm` | new | Username / Password `.field`s, `.err`, `.btn.primary` "Sign in" |
| `ChangePasswordForm` | new | Current / New / Confirm, same styling; shown on first login |

Every component with edit actions takes permission props so the view-only rendering can be checked statically.

### Pixel-perfect check
`refer.html` vs the Next page side by side, same viewport and day: light + dark, all 3 zooms, a collapsed group, tooltip, both dialogs, ≤640 px. Manual comparison (Playwright screenshot diff only if needed). Also the view-only variant, demo banner, error panel and both auth forms in both themes.

**Expected differences — not regressions:**
| Bug (current.md) | What looks different |
|---|---|
| 1 | No "Delete" button in the *Add* task/workstream dialogs; "Clear filters" hidden when no filter is active |
| 2 | Hovering a task label shows `Edit "<task name>"` as the browser tooltip |
| 3 | Empty data shows "No tasks yet" instead of "No tasks match these filters" |
| 4 | With zero workstreams the collapse buttons read "Collapse all" |
| 5 | Group row count and % both reflect the same (filtered) set; card task count matches the list shown |
| 6 | No stray "· ·" next to bars/diamonds without an owner |
| 7 | Owner filter only lists people who own at least one task |
| — | New: user menu in header, demo banner, error panel, view-only hides edit controls |

**Phase 3 status: implemented and verified.** How it was checked: `refer.html` and the Next page were loaded in the same browser at the same fixed day, and the rendered DOM of `#stats`, `.filters`, `#gantt`, `#legend` and `#cards` was diffed node-by-node (after stripping React's `<!-- -->` separators, `0`/`0px` and the colour variables). Month, week and quarter zoom, collapsed groups/closed cards and a filtered state are identical apart from the expected differences. Dialogs, tooltip, view-only, demo banner, error panel, empty states and both auth forms were checked by assertions on the rendered HTML plus screenshots (dark theme). Not done: the ≤640 px layout (CSS is verbatim, not re-checked) and the light theme screenshots.

Deviations from the plan as written:
- **Components are grouped into a few files** (`ui`, `Header`, `StatsBar`, `Gantt`, `Details`, `Dialogs`, `Auth`, `Footer`) instead of one file each; every component in the inventory exists as a named export.
- **Workstream colour in dark mode is CSS, not JS.** A server render can't know the theme, so elements get `class="c-ws"` + `--c-l` / `--c-d` (from `wsVars()` in `lib/palette.ts`) and `globals.css` picks one. Custom colours have no dark step and fall back to the light one. `wsColor()`/`isDark()` from `refer.html` are therefore not ported.
- **`status.ts` imports `@/generated/prisma/enums`** (pure constants), not the Prisma client, so client components can import it.
- **`page.tsx` is a static preview:** fixed today (`2026-10-18`), reads `data/dummy-data.json` directly (removed in Phase 5), and takes query params (`today, zoom, readonly, demo, error, user, collapsed, closed, ws, owner, status, dialog, tip, empty, toast`) so each state in the checklist can be reached. Phase 4 replaces these with real state. Dialogs render as `<dialog open>` only for this preview.
- Initial scroll-to-today and all behaviour are Phase 4 (the static Gantt opens at the left edge).
- `/login` and `/change-password` pages exist as static forms; guards come in Phase 5.

Additional expected differences vs `refer.html` (add to the table above):
| — | Footer reads "Changes are kept in this session only…" in demo mode and "saved to the shared database" otherwise (Reset button demo-only) |
| 5 | The thin summary bar in a group row spans only the visible (filtered) tasks |
| — | The date under the title is formatted `Sunday 18 October 2026` (fixed locale on the server) instead of the browser's locale; Phase 4 can localise after mount |
| 1 | View-only: the Gantt row label scrolls to the task card (`data-scroll`) instead of opening the editor |

**Phase 3 done when:** apart from the table above, the static page is indistinguishable from `refer.html` in all the listed states.

---

## Phase 4 — Wire up the frontend (local data, mock user, no API yet)

All interactions from `current.md` §2 work. Data access goes through **TanStack Query from the start** — `useDashboard()`, plus mutation hooks (`useSaveTask`, `useDeleteTask`, `useSaveWorkstream`, `useDeleteWorkstream`, `useImport`) that update the cache with `setQueryData`. **This cache-only mutation path is exactly demo mode**, so it stays in the final app; Phase 5 adds the API path beside it.

**Temporary in this phase only:** `useDashboard()`'s `queryFn` imports `dummy-data.json` directly in the client. Phase 5 removes that import (see 5.1).

Auth: a `useMe()` hook returning a hard-coded user, switchable between admin / viewonly / must-change-password, to wire the UI gating.

### Client state
| State | Where | Persisted |
|---|---|---|
| Filters | `useState` | no |
| zoom, collapsed groups, closed cards | `useUiState` | `localStorage` `primecare.ui.v1` (try/catch) |
| theme | `useTheme` + `data-theme` on `<html>` | `localStorage` `primecare.theme` |
| today | `useToday` (60 s check) | no |
| current user + permissions | `useMe` | no |
| tooltip, toast, open dialog | local | no |

### Behaviours to wire
- Zoom (+ scroll to today), Jump to today, Collapse/expand all (gantt and cards separately); scroll kept across rerenders; initial scroll puts today ~30% from the left; re-layout when `--label-w` changes.
- Tooltip on hover/focus; hides on scroll, mouseleave, focusout, Escape; stays on screen.
- Bar/diamond click → open card, scroll, focus, flash (+ 900 ms fallback scroll).
- Dialogs: prefill, milestone toggle, slider ↔ number, Done → 100%, validation in `.err`, Delete with `confirm()`, next unused palette colour, custom colour.
- Filters: options rebuilt from data, invalid selection reset, "Showing X of Y", Clear.
- Export (blob, `prime-care-dashboard-YYYY-MM-DD.json`, without `updatedAt`); Import (file → lenient parse → confirm → replace).
- Theme cycle System → Light → Dark; follows OS in System.
- **View-only gating:** hide + Add task, + Add workstream, + Task, Edit, Import, Delete. A row-label click (opens the editor for admins) scrolls to the task's card instead. Export, filters, zoom and theme remain.
- **Auth forms:** client-side validation with the shared Zod schemas, error line, button disabled while submitting (mocked).

### SSR gotchas
- Theme flash: inline script in `layout.tsx` `<head>` sets `data-theme` before paint; `suppressHydrationWarning` on `<html>`.
- "Today"-dependent output renders only after mount (`useToday` is null on the server) to avoid hydration mismatches.
- Gantt is a client component (reads computed CSS and scroll sizes).

**Phase 4 status: implemented and verified** in the browser (dev server, real clicks/events) and by 4 new unit tests (`dashboard-ops.test.ts`, 16 total).

What was built: `components/DashboardApp.tsx` (client; owns filters, dialogs, tooltip, scroll, toast and the delegated click handling, using the same `data-*` hooks as `refer.html`), `hooks/` (`useDashboard` + the five mutation hooks, `useUiState`, `useTheme`, `useToday`, `useMe`, `storage`), `lib/dashboard-ops.ts` (pure edits + `buildTask`), `QueryProvider` in `layout.tsx`. `page.tsx` is now just `<DashboardApp />`; the Phase 3 preview query params were removed.

Verified working: zoom (+ persisted, scrolls to today), Jump to today, collapse/expand all (Gantt and cards separately), single group/card toggles, filters (options follow the data, "Showing X of Y", Clear), tooltip (position, Esc/leave/scroll hide), bar click → opens a closed card, scrolls, focuses and flashes, task dialog (prefill, milestone toggle, slider ↔ number, Done → 100%, validation messages, move workstream, dependencies, Delete), workstream dialog (next unused colour, custom colour, validation, edit, Delete), dependency clean-up on delete, export (no `updatedAt`, dated filename), import (lenient repair, bad file → alert, export round-trips), Reset to sample data, theme cycle (persisted, no flash on reload), view-only gating (no add/edit/import/delete controls; row label scrolls to the card; export, filters, zoom, theme remain), mock user switch, auth forms (shared Zod validation, error line, button disabled while "submitting", mocked), no console errors or hydration warnings.

Deviations / notes:
- **localStorage-backed state uses `useSyncExternalStore`** (`useUiState`, `useTheme`, `useToday`), not effect + `setState` (the project's React lint rules reject that, and it avoids hydration mismatches). The page renders an empty shell until today and the stored UI state are available; Phase 5's prefetch removes the loading flash for data.
- **Mock user** is a dev-only `<select>` at the bottom of the page (hidden in production builds); "must change password" navigates to `/change-password`. Demo mode shows the banner and Reset button; admin / viewonly do not. Phase 5 deletes the select and `useMe` becomes `GET /api/auth/me`.
- `canEdit` = has `task:update`. Finer per-permission gating (e.g. create but not delete) is not needed with the two seeded roles; revisit if an "editor" role is added.
- Dialog **Cancel / ✕** unmount immediately; **Esc** relies on the dialog's `close` event.
- "Re-layout when `--label-w` changes" is unnecessary: Gantt geometry doesn't depend on it (width uses CSS `calc(var(--label-w) + …)`); only the initial scroll-to-today reads it.
- A filter selection whose option disappears is ignored (derived), rather than reset in state.
- The 60 s date check is the `useToday` interval; tab-to-tab refresh via the `storage` event applies to the UI state and theme, not to data (data sync is a Phase 5 / DB concern).

**Phase 4 done when:** every item in `current.md` §2 works on dummy data, bugs 1–7 are fixed, and switching the mock user to viewonly removes every edit path.

---

## Phase 5 — Connect frontend to backend

### 5.1 Data loading
- `QueryClientProvider` in `layout.tsx` (client wrapper); devtools in dev only.
- **Remove the client-side `dummy-data.json` import.** `useDashboard()` → `GET /api/dashboard`, key `["dashboard"]`. Demo data now only ever comes from the server.
  Check: `grep` the `.next/static` build output for a string from the dummy data (e.g. `"Patient onboarding redesign"`) → must find nothing.
- `page.tsx` prefetches by calling `getDashboard()` **directly** (not an HTTP call to its own API) and passes it via `HydrationBoundary` — no loading flash.
- `DatabaseUnavailableError` (from prefetch or a 503) → `ErrorPanel` with Retry (refetch).

### 5.2 Routing guard (server, in `page.tsx` / `login/page.tsx` / `change-password/page.tsx`)
| Situation | `/` | `/login` | `/change-password` |
|---|---|---|---|
| Demo mode | render | → `/` | → `/` |
| No valid session | → `/login` | render | → `/login` |
| Session, `mustChangePassword` | → `/change-password` | → `/change-password` | render |
| Session, normal | render | → `/` | render (voluntary change) |

No proxy/middleware — every API route checks the session itself.

### 5.3 Auth wiring
- `useMe()` → `GET /api/auth/me`.
- Login → `POST /api/auth/login` → `/change-password` if `mustChangePassword`, else `/`. 429 → "Too many attempts, try again in 15 minutes".
- Change password → `PATCH /api/auth/password` → `/`.
- Log out → `POST /api/auth/logout`, clear the query cache, `/login`.
- Any **401** → clear cache, `/login`. **403 `PASSWORD_CHANGE_REQUIRED`** → `/change-password`. Other **403** → toast "You don't have permission to do that".

### 5.4 Mutations
Hooks branch on the cached `source`:
- **`db`** → API call with **optimistic update**, sending `expectedUpdatedAt`; on error roll back + toast (server's Zod message where useful); **409** → toast "Someone else changed this — reloaded" + refetch; invalidate on settle; same success toasts as today.
- **`demo`** → cache-only update (the Phase 4 path). Demo query uses `staleTime: Infinity` and no refetch-on-focus, so edits survive until refresh and no longer. "Reset to sample data" refetches.
- Import → `POST /api/import` (db) or cache replace (demo). Export always client-side.
- Freshness across users: TanStack's `refetchOnWindowFocus` (db mode only) replaces `refer.html`'s `storage` event.

**Phase 5 status: implemented; items 1–7 verified, item 8 (Vercel) not yet.**

Built: server pages (`/`, `/login`, `/change-password`) do the routing guard behind `<Suspense>` (`sessionOrDown()` in `lib/auth.ts`; `redirect()` per the 5.2 table) and `/` prefetches `["me"]` + `["dashboard"]` into `HydrationBoundary`; `lib/api.ts` (fetch wrapper + `ApiError`); `QueryProvider` with global 401 / 403 handling and dev-only devtools; `useMe` → `/api/auth/me`; `useDashboard` → `/api/dashboard` (demo: `staleTime: Infinity`, no focus refetch; db: refetch on focus); the five mutation hooks share one `useEdit` helper (demo → cache only; db → optimistic update, API call, roll back + toast on failure, always refetch); login / change-password / logout wired; `vercel.json` (`sin1`); README rewritten; the client-side dummy-data import and the Phase 4 mock-user dropdown are gone.

Verified in the browser against Neon (production DB, restored afterwards):
1. Signed out `/` → `/login`; wrong password → generic error; `snehpriya` logs in, is forced to change the password, reaches the dashboard with the 7 empty workstreams, admin user menu, no demo banner (`aditya` verified at the API level: `mustChangePassword`, dashboard 403 until changed).
2. Create → edit → move → dependencies → delete tasks, add / rename / delete workstream, reload persists; export → import round-trips identically; new rows scroll/focus/flash under their **server** id.
3. A save made elsewhere, then a stale edit in the UI → "Someone else changed this — reloaded" and the other version shown.
4. `viewonly` user: no edit controls; direct API writes 403.
5. Demo mode (`DATABASE_URL=''`): no login (`/login` → `/`), banner, 30 tasks, Reset button, edits work and vanish on refresh, API writes 503, dummy data absent from `.next/static`.
6. Wrong `DATABASE_URL` with a real session cookie: error panel + Retry; no demo data, no login bypass.
7. Password change / deactivation ending other sessions: verified at the API in Phase 2.
8. **Not verified:** the Vercel production deploy (migrate + seed twice) and preview-runs-in-demo-mode; there is no Vercel project yet. `vercel-build.mjs` and `vercel.json` are written but unexercised.

Notes:
- **Next keeps visited routes mounted (hidden)** under Cache Components, so logout is a hard navigation (`location.assign`) to avoid leaving the previous user's dashboard in the page; the same applies to the global 401 handler.
- **Edits are blocked while a save is in flight** (db mode): a just-created row has a temporary id until the save and refetch finish, so the dialogs show "Saving… try again in a moment" instead of sending that id to the server.
- Writes and logins are never retried on a connection failure (they may have partly run); the UI shows a message and the user retries.

**Phase 5 done when:**
1. Logged out → `/` redirects to `/login`. Wrong password → generic error. `snehpriya` and `aditya` both log in, are forced to change their passwords, then reach the dashboard with the 7 empty workstreams.
2. As admin: create → edit → move → dependencies → delete, reload → persists. A `refer.html` export imports and round-trips.
3. Two browsers, same task: save in A, then save stale edit in B → B gets the 409 toast and A's version.
4. `viewonly` user: dashboard visible, no edit controls; direct API writes → 403.
5. `DATABASE_URL` unset → no login, 30 dummy tasks, banner, edits work and vanish on refresh; dummy data absent from the client bundle.
6. `DATABASE_URL` wrong → error panel with Retry; no dummy data, no login bypass.
7. Changing a password or an admin resetting/deactivating a user ends that user's other sessions.
8. Vercel: production deploy migrates + seeds (second deploy changes nothing); a preview deploy runs in demo mode.

---

## UI updates after Phase 5
- **Password fields** (login, change-password) have a show/hide eye toggle (`PasswordInput` in `components/Auth.tsx`).
- **"Depends on"** in the task dialog is a scrollable checkbox list grouped by workstream (replaces the Ctrl-click multi-select, which was hard to use). Same `dependsOn` form field; a task is never offered as its own prerequisite.
- **Workstream detail cards start collapsed.** The saved UI state (`primecare.ui.v1`) now stores `openCards` (cards the viewer opened) instead of `closedCards`, so the default is all collapsed, new workstreams start collapsed, and opening a task from the Gantt opens its card. Old saved `closedCards` values are ignored. The Gantt's own group rows are unchanged (expanded by default).
- **Logo:** the official Prime Care shield + heartbeat SVG replaces the blue tile with a plus icon (`Logo` in `components/ui.tsx`, also `src/app/icon.svg` as the tab icon). The `.logo` rule in `globals.css` no longer paints a background.

## Database provider change: Neon → Supabase (after Phase 5)

Why: the machine this was developed on has no working IPv6 route most of the time, and the Neon endpoints resolved to IPv6 addresses, so connections failed intermittently ("Database unreachable"). Supabase's pooler has IPv4.

What changed (everything else in this plan is unchanged):
- **Pool settings (`lib/prisma.ts`):** `max: 5`, `idleTimeoutMillis: 300000`, `connectionTimeoutMillis: 15000`, and Prisma `transactionOptions { maxWait: 15000, timeout: 30000 }`. pg's default connect timeout is 0 (wait forever), which once left a request hanging for 15 minutes; Prisma's default 2 s transaction wait failed (`P2028`) while the pool was still opening its first connection.
- **Driver:** `@prisma/adapter-pg` replaces `@prisma/adapter-neon` / `@neondatabase/serverless`; no WebSocket constructor needed. `ssl: { rejectUnauthorized: false }` (Supabase's pooler uses its own CA; pin it if that matters).
- **Connection strings:** `DATABASE_URL` = **transaction pooler** `…@aws-0-<region>.pooler.supabase.com:6543/postgres` (runtime, user `postgres.<project-ref>`); `DIRECT_URL` = **session pooler** `…:5432/postgres` (Prisma CLI: migrate, seed). The direct host `db.<ref>.supabase.co` is IPv6-only, so it is not used.
- **Row-level security:** new migration `20261018000000_enable_rls` enables RLS (no policies) on every table and revokes `anon`/`authenticated` on `public`. Supabase exposes `public` tables over its REST API with the publishable key, which is public; without this anyone with the key could read `User.passwordHash`. Prisma connects as `postgres`, which bypasses RLS. Any new table needs `ENABLE ROW LEVEL SECURITY` in its migration.
- **Not used:** `supabase-js`, `@supabase/ssr`, Supabase Auth. Login and sessions stay in-house (decision 4). The publishable key and project URL are therefore not needed by the app.
- **Region:** Supabase project `PrimeCareTracker` is `ap-south-1` (Mumbai) → Vercel function region `bom1` (was `sin1` for Neon). The first Supabase project was in Tokyo (`ap-northeast-1`, ~1–2 s per new connection from the dev machine) and was replaced by the Mumbai one; the pooler host is `aws-0-ap-south-1.pooler.supabase.com`.
- The Neon-specific notes below (WebSocket pool, `ErrorEvent`, scale-to-zero retry) no longer apply; the retry-once-then-503 behaviour is kept for any transient connection failure.

## DB architecture review (after Phase 1)

### Applied — migration `20261017170511_indexes_and_checks`
- **FK indexes** (Postgres doesn't create them, and cascades/lookups scan without them): `TaskDependency(dependsOnId)`, `User(roleId)`, `RolePermission(permissionId)`, `Session(userId)`, `Session(expiresAt)` (expired-row cleanup), `LoginAttempt(createdAt)` (the lazy 15-min purge runs across all keys).
- **CHECK constraints** (raw SQL; Prisma can't express them). They mirror the Zod rules, so no code path (import, seed, future scripts) can write bad rows:
  - `Task`: `progress` 0–100; `end >= start`; milestone ⇒ `start = end`; `Done` ⇒ `progress = 100`.
  - `TaskDependency`: `taskId <> dependsOnId`.
  - `Workstream`: `color ~ '^#[0-9a-f]{6}$'`.
  - `User`: `username = lower(username)`.
- **Consequence for Phase 2:** a violated CHECK surfaces as a Prisma error, not a Zod 400. Zod stays the user-facing validator; the import's lenient normaliser must fix `end < start`, milestone dates and Done-progress *before* insert, or the whole import transaction fails.

### Rules for later phases
1. **Dates:** `@db.Date` round-trips as UTC midnight. Write with `new Date("YYYY-MM-DD")` and read with `toISOString().slice(0,10)` (as `data-source.ts` does). Never build dates from local-time parts.
2. **Ordering:** `position` is not unique (concurrent creates can tie). Order reads by `position`, then `createdAt`. Compute "last" as `max(position)+1` inside the create transaction.
3. **Conflict detection (decision 7):** use `updateMany({ where: { id, updatedAt } })` and check `count`. `count = 0` means either 409 (changed) or 404 (deleted), so re-read the row to tell which. `updatedAt` has ms precision; if two writers ever collide within 1 ms, switch to an integer `version` column (`increment`). Not needed at this scale.
4. **Interactive transactions** (import, task update, `Serializable` user changes) must pass `{ timeout: 20000 }` for import. Prisma's 5 s default is too tight for ~hundreds of rows over a websocket to Singapore.
5. **Import** = `deleteMany` workstreams (cascades tasks and deps), then `createMany` workstreams, tasks, deps, all in one transaction.
6. **Reads:** in `getDashboard`, `include: { dependsOn: true }` can become `select: { dependsOnId: true }`. Minor.
7. **Session lookup** is one join query per request. Wrap `getSession()` in React `cache()` so the page and its prefetch share one lookup per request.
8. **Region:** keep the Vercel function region next to the database (now `bom1`, see "Database provider change"). Every cross-region round trip is ~150–250 ms and a request makes several.
9. **Pool size:** the Neon `Pool` lives per function instance. Keep `max` small (≈5) to avoid exhausting Neon's pooler under concurrent instances.

### Known ceilings (not worth fixing now)
- `/api/dashboard` returns every task with its full `description` in one payload. Fine for a few hundred tasks. Beyond that: send descriptions lazily (`GET /api/tasks/[id]`) and keep the list light.
- `position` renumbering for reordering is O(n) per workstream. Fine at this size.
- One role per user (§1.5), free-text `owner` (decision 8), no audit tables. None of these block the `future works.md` items.

### Next.js 16 notes (from `node_modules/next/dist/docs`, for Phase 2+)
- `params` in route handlers is a Promise; type it with the global `RouteContext<'/api/tasks/[id]'>` (generated by `next dev` / `next build` / `next typegen`).
- `cookies()` / `headers()` are async; `cookies().set/delete` works in route handlers, not in Server Components.
- Route handler `GET`s are uncached by default. Don't add `dynamic = 'force-static'`.
- `middleware` is now `proxy.ts`. The plan deliberately doesn't use one (it isn't an authorization layer per the docs); every route checks the session itself.
- `layout.tsx` uses the global `LayoutProps<"/">` type.

## Decisions (confirmed)

1. **Demo mode** only when `DATABASE_URL` is unset: editable, changes vanish on refresh, no login. DB unreachable → error state, never demo.
2. **Reset to sample data:** demo mode only.
3. **Bugs 1–7:** fixed during the rebuild; expected visual differences listed in Phase 3.
4. **Auth:** in-house, bcrypt, DB-backed sessions. Tables `users`, `roles`, `permissions` (+ `role_permissions`, `sessions`, `login_attempts`). Roles `admin` and `viewonly`; endpoints for admins to create more roles and users (no UI yet). Seeded admins `snehpriya` and `aditya`, both forced to change password on first login.
5. **Hosting:** Vercel. Production migrates + seeds on deploy; previews run in demo mode.
6. **Initial data:** the 7 workstreams from `refer.html` seeded once as empty sections (names, colours, ids kept; owner/goal blank; no tasks).
7. **Concurrent edits:** last-writer conflict detected via `updatedAt` → 409, not silently overwritten.
8. **Owners** remain free text, not linked to users.

## Out of scope (tracked in `future works.md`)
- User/role management UI (admins use the endpoints until then).
- Activity log, comments, dependency cycle checks, schedule-variance flags.

## /v2 (frontend revamp, in progress)
- `/v2` is a copy of the dashboard UI (`src/components/v2/`, `src/app/v2/`) that evolves separately; v1 (`src/app/(v1)/`, `src/components/*`) is untouched.
- Shell: shadcn sidebar → Dashboard (header, stat tiles, Gantt, "Needs attention" list: at risk / due ≤ 2 days / overdue), one tab per workstream (`/v2/ws/[id]`), Settings (`/v2/settings`: username, password, new workstream, invite user + role).
- shadcn lives in `src/components/v2/ui/`; Tailwind is loaded only from `v2.css` (theme + utilities, no full preflight; legacy CSS sits in `@layer legacy` below utilities).
- Backend addition (additive): `PATCH /api/auth/username`.
- Not yet converted to shadcn: Gantt, stat tiles, task/workstream dialogs, workstream cards.

### /v2 History (audit log)
- New table `TaskEvent` (migration `20261018120000_task_events`, RLS on): one row per task **completion** (status changes to Done) and per task **deletion**. No foreign keys, so it keeps its own copy of task/workstream names and outlives both.
- Written in the same transaction as the change by `src/lib/task-events.ts`, from: task create (born Done), task update (→ Done), task delete, workstream delete (each task, note "Workstream deleted"), import (tasks the import doesn't bring back, note "Removed by import").
- Backfill: tasks already Done got a COMPLETED row at their `updatedAt`. Tasks deleted before this migration are not recoverable.
- `GET /api/history?workstream=&owner=&type=&cursor=` (dashboard:read), 50 per page; `/v2/history` page with Workstream / Owner / Status (Completed, Deleted) filters and "Load more".
- v1 is unaffected in the UI, but its deletes/completions are logged too (the logging lives in the shared API routes).
