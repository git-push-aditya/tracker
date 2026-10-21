# Subtasks — implementation guideline

Status: plan only, nothing built. Builds on `Task`, `status.ts`, `/api/tasks`, actors, history.

## 1. Shape

- A subtask is a normal `Task` row with a nullable `parentId` (self-relation, `onDelete: Cascade`, indexed).
  Same fields as a task: name, owner (actor), start, end, status, progress, description.
- **One level only.** The server rejects a `parentId` whose target already has a parent.
- A subtask lives in its parent's workstream (never chosen separately); moving a parent moves its subtasks.
- `parentId` is immutable after creation, except via Promote (section 5). Demote (task → subtask) is out of scope.
- Subtasks take no dependencies in v1. They may be milestones. The parent's owner is independent of its subtasks' owners.
- Deleting a parent deletes its subtasks; the dialog states the count; each gets its own history entry.
- Permissions reuse `task:create`, `task:update`, `task:delete`. No new keys.

## 2. Rules

| # | Rule | Enforced |
|---|---|---|
| R1 | A parent with subtasks has **calculated progress** = rounded average of its subtasks' progress (existing `avg`). Its own progress input is read-only. | Shared pure function, server + UI |
| R2 | A parent cannot be **Done** unless every subtask is Done. | Server rejects; UI disables the option with the reason |
| R3 | Each subtask has its own status, progress, owner, dates, description, under the normal task rules (Done ⇒ 100%, end ≥ start). | Existing validation |
| R4 | **Parent end ≥ latest subtask end**, checked on subtask create/edit and on parent end edit. | Server rejects, inside the transaction. UI offers "Extend parent to <date>" |
| R5 | Parent shows **Delayed** if any subtask is Delayed (stored, or past end and not Done), on top of its own overdue check. | Extend `effStatus`; derived, never stored |
| R6 | A Done parent cannot hold an unfinished subtask: adding a subtask to it, or reopening a Done subtask, moves the parent to In progress (toast). | Server, same transaction |
| R7 | A subtask can be deleted. Rollup recalculates. If it was the last one, the parent becomes a normal task and keeps its last stored progress. | Server |

Defaults chosen: the parent does **not** auto-complete when the last subtask is done (a person clicks Done, so the
completed event has an author); no constraint on the parent's start date.

## 3. Data and API

- One additive migration: `parentId` column, index, FK (cascade). No backfill.
- Parent progress and effective status are **computed on read** (`toTask` and demo mode), not stored, so they can't drift.
  A parent's stored progress is only used while it has no subtasks.
- Dashboard response: each top-level task gets a `subtasks` array. `workstream.tasks` stays top-level only, so stats,
  filters, search and owner lists don't double-count.
- Reuse `/api/tasks` (create with optional `parentId`) and `/api/tasks/[id]` (update, delete). Only Promote gets a new route.
- R2, R4, R6 run in the same transaction as the write, re-reading parent and siblings first, so concurrent edits of
  different subtasks can't break the date or Done rules. Optimistic locking (`expectedUpdatedAt`) applies per subtask.
- Import/export JSON gains optional `subtasks` (default empty; old files still import) and runs the same rules.
  Add one example parent to `data/dummy-data.json`.
- Actors: rename/merge/delete and `scripts/backfill-actors.ts` already cover subtasks (they are `Task` rows with `ownerId`).

## 4. UI

- **Details panel (v2):** "Subtasks" section with progress bar and "3 of 5 done". Each row: inline status select, % input,
  owner dropdown (`OwnerSelect`), due date, extract button, delete button; plus "+ Add subtask". Name/description open the usual dialog.
- **Parent fields:** progress read-only ("calculated from N subtasks"); Done disabled with reason; Delayed shows "due to subtask".
- **Gantt:** parent row gets an expand/collapse chevron, subtask rows indented beneath (`gantt-layout.ts` needs a new row kind).
- **Filters/lists:** owner filter matches parent or any subtask; owner suggestions include subtask owners; Attention lists
  overdue subtasks as "Parent › Subtask"; headline stats count top-level tasks only.
- **History:** subtask completed/deleted logged like any task, with parent name for context.

## 5. Promote (extract a subtask into a task)

- **Same row, no copy:** clears `parentId`. Name, owner, description, status, progress, id and history are unchanged.
- **Dates are never touched.** Start and end stay exactly as they were; no check against the old parent's dates.
- **Placement:** inserted among the workstream's top-level tasks ordered by start, then end — before the first task that
  starts later, else at the end. Later tasks shift down one position in the same transaction.
- It has no dependencies. The parent re-averages its remaining subtasks; if it was the last one, the parent reverts to a
  normal task (R7). The parent's end does not shrink and it does not auto-complete. A Done parent is unaffected.
- **API:** `POST /api/tasks/[id]/promote` with the subtask's `expectedUpdatedAt`. 404 if not a subtask, 409 on conflict.
  Needs `task:update` only.
- **UI:** "Extract as task" button on each subtask row. Confirm dialog shows the effect, e.g. "Move 'Write copy' out of
  'Launch site'? Launch site progress changes from 60% to 75%." Toast "Now a task" with an Open link.
- **History:** no new event type; existing entries stay attached because the id is unchanged.

## 6. Phases

1. Migration, shared rollup/rules function with unit tests, API rules R1–R7, Promote endpoint.
2. Dashboard response, import/export, demo data.
3. UI: Details panel section and Promote button, then filters/Attention/History, then Gantt expand/collapse.
4. v1 UI: only if still used; otherwise it ignores subtasks.

## 7. Tests

- Rollup average (including rounding and zero subtasks); Done blocked while any subtask is unfinished; R4 on subtask
  create/edit and parent end edit; Delayed propagation from a delayed or overdue subtask; R6 reopen; last-subtask delete.
- Cascade delete of a parent; nesting rejected beyond one level; import round trip with and without `subtasks`.
- Promote: attributes and dates identical afterwards, correct slot among earlier/later/equal start dates, parent
  re-averaged, last-subtask promotion reverts the parent, promoting a top-level task returns 404.
