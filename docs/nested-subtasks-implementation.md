# Nested subtasks — implementation guideline

Status: built with the decisions in section 1 (D1–D6) — phase 1 `cbbf0bb`, phase 2 `09cd945`, phase 3 `68549bc`.
`MAX_DEPTH` was then raised from 2 to 10 (D1); the depth-2 examples below still hold at any depth. Extends `docs/subtasks-implementation.md` (one level, shipped in `cd69178`) so a
subtask can have subtasks of its own. Wording: a **node** is any task row; **top-level** = `parentId` null; **depth** =
number of ancestors (top-level 0, subtask 1, sub-subtask 2).

## 1. Decisions (defaults approved and built)

| # | Question | Default | Why |
|---|---|---|---|
| D1 | How deep? | `MAX_DEPTH = 10` levels of subtasks below a task, one constant in `subtasks.ts` (first built as 2) | Every rule below is written for any depth. The UI indents up to `--indent-cap` levels (6; 4 on phones) and lines deeper ones up with the cap, so names keep their room in the Gantt's 270px label column |
| D2 | What does a parent's progress average? | Its **direct children**, each using its own rollup (recursive) | Same rule as today applied at every level; "3 of 5 done" stays meaningful. Averaging leaves would weight deep branches more |
| D3 | What does Promote / "Extract" do on a sub-subtask? | Moves it **up one level** (becomes a subtask of its grandparent). On a depth-1 subtask it stays as today (becomes a task) | Always valid: grandparent end ≥ parent end ≥ its end, so R4 can't fail. No dates touched |
| D4 | Deleting a mid-level node with "keep subtasks" | Its children move **up one level** to its parent (top-level parent: they become tasks, as today) | Same mechanic as D3 |
| D5 | Dependencies | Still top-level tasks only | Unchanged; keeps the Gantt arrows simple |
| D6 | v1 UI | Ignores subtasks, as today | Unchanged |

## 2. Rules at any depth

Each existing rule now holds **between every node and its direct parent**; transitivity covers the rest.

| # | Rule | Change from one-level |
|---|---|---|
| R1 | A node with children has progress = rounded avg of its children's (rolled-up) progress | Recursive: a change syncs **every ancestor, bottom-up** |
| R2 | A node can't be Done while any direct child isn't Done | Unchanged check; transitive because the child obeys it too |
| R3 | Normal task rules per node | Unchanged |
| R4 | child.end ≤ parent.end | Checked against the direct parent only. "Extend parent" in the UI may need to extend the whole ancestor chain |
| R5 | A node shows Delayed if any descendant is Delayed | `effStatus` recurses into `subtasks` |
| R6 | An unfinished child reopens a Done parent | Propagates up: **every Done ancestor** goes to In progress, same transaction |
| R7 | Last child removed → node keeps its last stored progress | Unchanged, per level |
| R8 | **new** Depth: a node can only be created under a parent of depth < `MAX_DEPTH` | Server rejects (400); UI hides "+ Add subtask" at max depth |
| R9 | **new** No cycles | Holds by construction: `parentId` is set only on create (new row) or by promote/keep (moves to an ancestor). Keep `parentId` off `TaskUpdate` |

## 3. Refined tasks

### Phase 1 — rules and server (no UI change visible)

1. **Pure rules** — `src/lib/subtasks.ts`
   - Add `MAX_DEPTH`, `depthOf(id, byId)`, `descendants(node)` (flat walk) and `rollupTree(node)` (recursive R1, replaces `withRollup` for nested input).
   - `parentChangeError` / `subtaskChangeError` stay per-level; add `canHaveChildren(depth)`.
   - Unit tests in `subtasks.test.ts`: recursive rollup and rounding at 2 levels, R2 transitivity, R5 from a depth-2 Delayed node, depth limit.
2. **Status** — `src/lib/status.ts`: `effStatus` recurses (`subs` items carry their own `subtasks`). Tests.
3. **Schemas** — `src/lib/schemas.ts`: replace `SubtaskShape = TaskCore` with a recursive `z.lazy` node (`subtasks` optional on every node), with an explicit TS type for the recursion. Drop the "one level only" comment. `TaskInput.parentId` unchanged.
4. **DB helpers** — `src/lib/subtasks-db.ts`
   - `ancestorsOf(tx, id)`: recursive CTE returning the chain top-first (depth ≤ `MAX_DEPTH`, so cheap).
   - `lockChain(tx, id)`: locks ancestors **top-first, then the node** (keeps today's "parent before child" order, so no deadlocks).
   - `lockParent` → stop rejecting a parent that has a parent; reject when `depth(parent) ≥ MAX_DEPTH` instead (R8).
   - `syncParentProgress` → `syncAncestors(tx, parentId)`: walk up, re-average each level from its direct children, same raw-SQL Done-drop per level.
   - `reopenAncestors(tx, parentId)` for R6.
   - `detachSubtask` → `moveUp(tx, id)`: if the parent is top-level, today's slotting among workstream tasks; otherwise re-parent to the grandparent at the end of its children.
   - `descendantIds(tx, id)` (recursive CTE) for moves and delete logging.
5. **Routes**
   - `api/tasks/route.ts` (POST): `lockChain(parentId)`, R8, R4 vs direct parent, `reopenAncestors`, `syncAncestors`.
   - `api/tasks/[id]/route.ts` (PUT): lock chain; a mid-level node gets **both** checks (as child: R4 vs parent; as parent: R2/R4 vs its children, progress from rollup); workstream move updates **all descendants** (`descendantIds`), not just `parentId: id`; `syncAncestors`.
   - DELETE: log events for all descendants ("deleted with its parent"); `?subtasks=keep` moves direct children up one level (D4) and their own children travel with them; `syncAncestors` from the deleted node's parent.
   - `api/tasks/[id]/promote/route.ts`: use `moveUp` (D3); lock the chain; sync old parent's ancestors **and** (for depth-2) the new parent's.
   - `api/workstreams/[id]` DELETE already logs every task row in the workstream (all depths) — verify only.
6. **History notes** — `src/lib/task-events.ts`: "Subtask of "X"" uses the direct parent; optionally full path "A › B". Pick one, keep it short.

### Phase 2 — read path, import/export, demo data

7. **Dashboard read** — `src/lib/data-source.ts`: Prisma can't include recursively. Load each workstream's tasks **flat** (one query, ordered by position) and build the tree in JS (`buildTree`), then `rollupTree`. `workstream.tasks` stays top-level only. `toSubtask` becomes the recursive `toTask`.
8. **Shared helpers** — `src/lib/dashboard.ts`
   - `findTask` returns `{ ws, t, parent, ancestors }` at any depth.
   - `everyOwner`, the owner/status filter in `matches`, `taskOwners`: use `descendants(t)` instead of `t.subtasks`.
9. **Search / Attention** — `task-search.ts`, `attention.ts`: flatten with `descendants`; Attention label shows the path ("Parent › Sub › Sub-sub").
10. **Import / export** — `src/lib/import.ts`: `mapTask` recursive with a depth argument; deeper levels than `MAX_DEPTH` are dropped (as level 2 is today); the repair step (parent end ≥ latest child, not Done early, rollup) runs **bottom-up**. Old files still import. Tests in `import.test.ts`: round trip at depth 2, over-deep input truncated, repair at the middle level.
11. **Optimistic / demo ops** — `src/lib/dashboard-ops.ts`
    - Replace `editParent` (top-level only) with a tree updater `editNode(wss, id, fn)` that re-applies `rollupTree` and R6 up the path.
    - `upsertSubtask`, `promoteSubtask` (D3), `removeTask(…, keep)` (D4) work at any depth.
    - Tests in `dashboard-ops.test.ts` mirroring each server rule.
12. **Demo data** — `data/dummy-data.json`: give one existing subtask two children.

### Phase 3 — UI (v2)

13. **Details panel** — `src/components/v2/Subtasks.tsx`
    - Render recursively: a row with children gets a chevron and an indented child list; "x of y done" per node.
    - A row with children: % input read-only ("calculated"), Done option disabled with the reason (mirrors the dialog).
    - "+ Add subtask" on a row only when `depth < MAX_DEPTH` (it sets `data-add-sub` to that row's id — `DashboardApp` already routes it).
    - Extract button label/tooltip: "Move up a level" for depth 2, "Extract as a task" for depth 1.
    - CSS in `src/app/v2/v2.css`: indent per depth for `.sub-row`; check the 2-column mobile layout.
14. **Dialogs** — `src/components/v2/Dialogs.tsx`: `TaskDialog` already reads `task.subtasks` for the read-only progress and Done limit, so a mid-level node mostly works; add the breadcrumb ("Subtask of A › B") and `max={parent.end}`. `DeleteParentDialog` copy for a mid-level node ("move them up to <parent>"). Create-with-subtasks (`SubDraft`) stays one level.
15. **Board logic** — `src/components/v2/DashboardApp.tsx`
    - `persistSub`: when the new end passes the parent's, offer to extend **every ancestor whose end is earlier**, in one confirm, top-first saves.
    - Promote confirm text for D3; delete flow for a mid-level node with children uses `DeleteParentDialog`.
    - `dlgParent` from `findTask(...).parent` already works once `findTask` is deep.
16. **Hooks** — `src/hooks/useDashboard.ts`: `useSaveSubtask` / `usePromoteSubtask` use the deep `findTask` for `updatedAt` and workstream id. No new endpoints.
17. **Gantt** — `src/lib/gantt-layout.ts` + `Gantt.tsx`
    - Row `sub?: boolean` → `depth: number`; emit rows recursively while each ancestor is expanded (`ui.expanded` already stores ids, works for any node).
    - Indent label by depth; toggle button on any row with children; tooltip "Subtask of A › B".
    - `timeRange` uses `descendants` so deep nodes stay in range.

### Phase 4 — docs and checks

18. Update `docs/subtasks-implementation.md` status line and point to this doc; update README test list if needed.
19. Run `npx eslint`, `npx tsc --noEmit`, `npm test`; click through in demo mode and DB mode (create depth-2, edit dates past parent, Done blocking, promote, delete keep/all).

## 4. Tests (beyond those listed per task)

- R1: editing a depth-2 node updates its parent **and** the top-level task in one write.
- R4: depth-2 end after its parent's is refused; extending parent then child succeeds.
- R6: reopening a depth-2 node under Done parent and Done grandparent reopens both.
- R8: creating under a depth-2 node returns 400.
- Moving a top-level task to another workstream moves all depths.
- Delete: all-depth cascade logs one event per row; keep moves children up one level with their own children.
- Promote: depth-2 → child of grandparent, dates unchanged, both parents re-averaged; depth-1 unchanged from today.

## 5. No migration needed

`parentId`, its index, the cascade FK and the not-self CHECK already support any depth. Depth (R8) and cycles (R9) are
enforced in the API; a DB trigger for depth is possible later but not needed while `parentId` is immutable.
