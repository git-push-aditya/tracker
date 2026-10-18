# Actors: one list of owners for tasks and workstreams

Status: **built** (steps 1–8 below); deviations from the proposal are listed at the end. Scope: backend + `/v2` UI. v1 keeps working untouched in the UI.

## 1. Problem

`owner` is free text on `Task` and `Workstream` (and copied into `TaskEvent`). Nothing ties "Rohan", "rohan" and "Rohan " together, so the Owner filters, the History filter and the sidebar search treat them as different people. The dialogs only *suggest* existing names (`OwnerList` datalist); they don't enforce anything.

An **Actor** is a person who can own work. It is separate from `User` (people who can log in). Most actors will never have a login.

## 2. Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | New `Actor` table; `Task.ownerId` and `Workstream.ownerId` point to it. | One row per person, so rename and merge happen in one place. |
| D2 | **Keep the `owner` text column** next to `ownerId` (denormalised display name). | The API, JSON export/import, v1 and every existing read keep working with no change. |
| D3 | The server resolves the typed/selected name to an actor on every write (find-or-create), and writes back the **actor's canonical name**. | Fixes duplicates for v1 and v2 alike. `rohan` typed anywhere becomes the existing `Rohan`. |
| D4 | Matching key `nameKey` = trim, collapse inner spaces, NFKC, lower-case. Unique. | Catches case/space variants. No fuzzy matching: "Rohan" vs "Rohn" is a human call (the dropdown prevents it, merge fixes it later). |
| D5 | `TaskEvent` gets `ownerId` too (nullable) and keeps its name snapshot. Renaming an actor rewrites the snapshot. | A rename is a correction, so history should show one person. Filtering History uses `ownerId`. |
| D6 | Deleting an actor is allowed only when no live task or workstream uses it; otherwise 409 "merge instead". | Avoids orphaned `owner` text. |
| D7 | New permission `actors:manage` (rename / merge / delete). Reading the list needs only `dashboard:read`. | Same RBAC pattern as users and roles. |

## 3. Data model

```prisma
model Actor {
  id         String      @id @default(cuid())
  name       String                       // display name, as first entered
  nameKey    String      @unique          // see D4
  createdAt  DateTime    @default(now())
  tasks      Task[]
  workstreams Workstream[]
}
// Task and Workstream:   owner String @default("")   (kept)   +   ownerId String? -> Actor (onDelete: Restrict)
// TaskEvent:             owner String                (kept)   +   ownerId String?   (no FK, like the rest of that table)
```

Migration `…_actors` (additive, RLS on for `Actor`): create `Actor`, add the nullable `ownerId` columns and indexes. **Schema only; no data work in SQL.**

**Backfill** is a TypeScript script, `scripts/backfill-actors.ts`, run once after the migration and then on every production build (after `migrate deploy`, before `next build`) because it is idempotent. It uses the same `actorKey()` as the app: collect distinct non-empty owner strings from `Task`, `Workstream`, `TaskEvent`; group by `actorKey`; the most frequent spelling wins (ties: alphabetical) and becomes `name`; insert actors; then set `ownerId` and rewrite `owner` to the actor's `name` on all three tables. Rerunning also repairs any rows an older deployment wrote with a null `ownerId`.
(Why not SQL: Postgres `lower()` and JavaScript `toLowerCase()` disagree on a few characters, so a SQL-built key could differ from the app's key and create duplicates later.)

## 4. Backend

| File | Change |
|------|--------|
| `prisma/schema.prisma`, `prisma/migrations/…_actors/` | Section 3. |
| `src/lib/actors.ts` (new) | `actorKey(name)`, `resolveActor(tx, name)` → `{ id, name } \| null` (empty name → null; upsert on `nameKey`, retry once on unique conflict), `resolveMany(tx, names)` for import. Unit tests next to it. |
| `src/app/api/tasks/route.ts`, `tasks/[id]/route.ts` | Call `resolveActor` inside the existing transaction; write `owner` (canonical) + `ownerId`. |
| `src/app/api/workstreams/route.ts`, `workstreams/[id]/route.ts` | Same. |
| `src/app/api/import/route.ts` | Resolve all owner names first (`resolveMany`), then `createMany` with `ownerId`. |
| `src/lib/task-events.ts` | Snapshot gets `ownerId`; callers already pass the task row. |
| `src/app/api/history/route.ts`, `history/filters/route.ts` | Filter by `ownerId` (`?owner=<actor id>`); owner options come from `Actor` ids that appear in the log. |
| `src/app/api/actors/route.ts` (new) | `GET` → `[{ id, name, taskCount, workstreamCount }]` (`dashboard:read`). |
| `src/app/api/actors/[id]/route.ts` (new) | `PATCH {name}` rename: in one transaction update `Actor.name`/`nameKey` **and rewrite the `owner` text** on `Task`, `Workstream`, `TaskEvent` (409 if the new key already exists → "merge instead"). `DELETE` (D6). Both `actors:manage`. |
| `src/app/api/actors/[id]/merge/route.ts` (new) | `POST {intoId}`: one transaction repoints tasks, workstreams and events, rewrites `owner`, deletes the source. |
| `src/lib/permissions.ts`, `src/lib/schemas.ts` | Add `actors:manage`; `ActorRename`, `ActorMerge` schemas. `prisma/seed.ts` already syncs permission keys on every production build, and the admin role gets all keys. |

## 5. Frontend (`/v2` only)

| File | Change |
|------|--------|
| `src/hooks/v2/useActors.ts` (new) | `useQuery(["actors"])`, `staleTime: Infinity`; invalidated after task/workstream save, delete, import, and any actor rename/merge/delete. In demo mode it derives the list from the dashboard data (`suggestedOwners`). |
| `src/components/v2/OwnerSelect.tsx` (new) | shadcn `Select` with: **"No owner"** (empty string, sent to Radix as a sentinel because it rejects `""`), the actors, and **"+ New person…"**. The current value is always included as an option even if it isn't in the list yet (list still loading, demo mode, legacy name). "+ New person…" swaps the control for an `Input` with a Cancel (back to the list). Emits a plain name string, so the dialogs' submit code barely changes. |
| `src/components/v2/Dialogs.tsx` | Replace the Owner `Input` + `list="ownerList"` in `TaskDialog` and `WorkstreamDialog` with `OwnerSelect`. Remove `OwnerList`. |
| `src/components/v2/DashboardApp.tsx` | Drop `<OwnerList …/>`; invalidate `["actors"]` next to the existing `refreshHistory`. |
| `src/components/v2/Settings.tsx` | New **People** card (needs `actors:manage`): list with task counts, rename, merge into…, delete (disabled while in use). |
| `src/components/v2/History.tsx` | Owner filter value becomes the actor id (labels unchanged). |
| Gantt owner filter (`FilterBar`) | Unchanged: it lists owners that actually own tasks, and names are now canonical. |
| Sidebar search (`src/lib/task-search.ts`) | Unchanged: it matches on the owner text, which is now canonical. |

## 6. How existing features are resolved

| Feature | Effect and resolution |
|---------|----------------------|
| **v1 UI** | No code change. Free-text owner still works; the server maps it to an actor. One visible difference: typing `rohan` saves as `Rohan` if that person exists. |
| **Export JSON** | Unchanged: owners stay plain strings. |
| **Import JSON** | Unchanged format. Owners in the file become actors (find-or-create), so importing never reintroduces duplicates. |
| **Optimistic updates** (db mode) | The client may briefly show the typed spelling; the refetch after the save replaces it with the canonical name. `OwnerSelect` already sends canonical names, so v2 doesn't flicker. |
| **Demo mode** (no DB) | No actor table; the dropdown lists names found in the demo data, "+ New person" just types a name. Settings → People is hidden. |
| **History** | Existing rows are backfilled with `ownerId`; later rows get it from the task. Rename rewrites snapshots (D5). |
| **Needs-attention / Gantt / sidebar search / workstream cards** | They read `owner` text, which stays populated and canonical. No change. |
| **Workstream owner vs task owner** | Both reference the same actors, so one person shows up once everywhere. |
| **Roles** | Viewers never open dialogs, so they only need `GET /api/actors`. Rename/merge/delete require `actors:manage` (admin gets it on the next seed). |
| **Concurrency** | `nameKey` is unique; two simultaneous "new person" saves race into one row (upsert, one retry). Rename and merge touch many tasks, which bumps their `updatedAt`; anyone with one of those tasks open in a dialog gets the existing "changed by someone else" 409 on save and reloads. Acceptable for a small team. |
| **Naming clash** | `TaskEvent.actor` already exists and means *the login user who did it*, not an Actor. It stays as is (documented here and in a schema comment) to avoid a rename migration. |
| **Deleted workstreams/tasks** | Their `Actor` stays (people outlive tasks). Unused actors can be deleted from Settings. |

## 7. Steps (each ends with lint, tsc and tests green)

1. Schema + migration; apply to the live DB; `prisma generate`; **restart `next dev`** (the client singleton goes stale otherwise). Then `scripts/backfill-actors.ts` (add it to `scripts/vercel-build.mjs` after `migrate deploy`).
2. `src/lib/actors.ts` + tests (key normalisation, case/space variants collapse, empty → null).
3. Wire `resolveActor` into the task, workstream and import routes; extend `task-events.ts`. Check with the throwaway-script approach used for History: create "rohan" / "Rohan " / "ROHAN", confirm one actor and one canonical `owner`.
4. `GET /api/actors`, rename, merge, delete + `actors:manage` permission; run `npx prisma db seed` once locally (the live DB is the same one) so the admin role gets the key now, not only at the next deploy.
5. History API: filter by `ownerId`.
6. `/v2`: `useActors`, `OwnerSelect`, dialogs, Settings → People, History owner filter.
7. Verify in the browser: new person via dropdown, existing person via dropdown, rename, merge, History filter, demo-mode fallback; update `docs/implementation-plan.md`.
8. Deploy (`vercel deploy --prod`; the build runs `migrate deploy` and the seed).

## 8. Risks and rollback

- **Order:** run the migration before the new code. The Vercel build already does this. Older code that is still running ignores `ownerId`; any owner it writes would leave `ownerId` null until the backfill script is re-run (it is idempotent, and the build runs it).
- **Rollback:** every change is additive (new table, nullable columns). Dropping the new code leaves the `owner` text intact and correct.
- **Not covered:** fuzzy "did you mean…" suggestions, linking an actor to a login `User`, and per-actor avatars or emails. Easy to add later, none needed now.

## 9. As built (differences from the proposal)

- Backfill runs from `scripts/backfill-actors.ts`, wired into `scripts/vercel-build.mjs` (production builds only). Tie-break for the display spelling: most used, then mixed case ("Rohan" beats "rohan"/"ROHAN"), then code-point order.
- Rename/merge/delete live in `src/lib/actors.ts` (`renameActor`, `mergeActors`, `deleteActor`, `ActorError`), and the routes only call them; `http.ts` maps `ActorError` to its 404/409.
- Verified with a throwaway script against the live DB: 3 spellings of one name collapse to 1 actor; a typed `rOhAn` resolves to `Rohan`; blank means no owner; rename rewrites the text on tasks; renaming into an existing name and deleting an in-use actor both return 409; merge repoints everything and removes the source. All test rows were removed afterwards.
- `/v2` has `OwnerSelect` (dialogs), `useActors`, and Settings → People. History's Owner filter now sends the actor id.
