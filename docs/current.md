# Prime Care Dashboard — Current State (`refer.html`)

## 1. What it is

A single HTML file (1,148 lines) with no backend and no build step. Everything is stored in each person's browser (`localStorage`).

**Data model:** Workstreams → Tasks (one level only, no subtasks).

- **Workstream fields:** `id, name, color, owner, goal, tasks[]`
- **Task fields:** `id, name, owner, start, end, progress (0–100), status, isMilestone, dependsOn[], description`
- **Statuses:** Not started, In progress, Done, At risk, Delayed

**Storage keys:** `primecare.dashboard.v1` (data), `primecare.ui.v1` (zoom / collapsed state), `primecare.theme` (theme).

## 2. Features it currently provides

### Header
- Today's date shown under the title.
- Buttons: Add task, Export JSON, Import JSON (replaces all data after a confirm), Theme switch (System / Light / Dark, remembered).

### Summary tiles
- Total tasks, average % complete with a progress bar, and counts for Done, On track, At risk and Delayed.
- Tiles always show all data, even when filters are on.

### Gantt chart ("Live roadmap")
- **Zoom:** Week (day columns, weekends shaded), Month (week columns), Quarter (month columns). Two-tier header; zoom choice is remembered.
- **Today:** red "TODAY" line and pill, a "Jump to today" button; opens scrolled to today.
- **Workstream rows:** collapsible, with colour swatch, task count, average %, and a thin summary bar spanning all their tasks. Collapse/expand all, remembered.
- **Task bars:** filled part shows % complete. At risk → dashed amber outline; Delayed → red outline. Next to each bar: status, %, owner, dates.
- **Milestones:** diamonds on the end date; hollow when Done.
- **Dependency arrows:** from each prerequisite to the dependent task, routed around overlaps.
- **Tooltip** on hover or keyboard focus: owner, dates, duration in days, %, status, dependencies, 170-character description excerpt.
- **Clicks:** clicking a bar scrolls to and highlights that task's card below; clicking a row label opens the edit dialog.
- **Layout:** label column sticky when scrolling sideways, header sticky when scrolling down; scroll position kept across redraws.

### Filters
- Workstream, Owner, Status, with a "Showing X of Y" count and a Clear button. Filters are not remembered.

### Workstream detail cards
- Each card shows goal, owner, % bar and a count per status; collapsible (remembered).
- Each task shows: status badge (+ "auto-flagged: end date passed" when applicable), owner, dates and duration, dependencies, a small progress bar and the description.
- Descriptions support a small Markdown subset: paragraphs, `- ` bullets, `**bold**`.

### Automatic behaviour
- Any task past its end date that isn't Done shows as **Delayed** automatically.
- Choosing "Done" sets progress to 100%.
- Page redraws when the date rolls over (checked every 60 s) and when another tab in the same browser saves.

### Task dialog
- Fields: name, workstream (changing it moves the task), owner (suggests existing names), start/end dates, status, progress (slider + number box), milestone (hides start date), dependencies (multi-select grouped by workstream), description.
- Validation: name required, valid dates, end ≥ start.
- Delete task (also removes it from other tasks' dependencies).

### Workstream dialog
- Fields: name, owner, colour (8 presets with matching dark-mode shades + custom picker), goal.
- Delete workstream (deletes its tasks and clears dependencies on them).

### Other
- All inserted text is escaped, so a malicious import can't inject script.
- Accessibility basics: screen-reader labels, announced progress bars, keyboard focus outlines, reduced-motion support.
- Responsive down to phone width.
- If saving fails, a toast suggests using Export instead.

## 3. Sanity check

### Bugs

| # | Where | Problem |
|---|---|---|
| 1 | `refer.html:73,311,339,399,421` | **The `hidden` attribute never works on buttons.** `.btn` forces `display:inline-flex`, which overrides `hidden`. So "Delete task" and "Delete workstream" appear in the *Add* dialogs (clicking does nothing), and "Clear filters" is always visible. |
| 2 | `refer.html:804` | `title="Edit "${name}""` has unescaped inner quotes; the attribute breaks. Tooltip only says "Edit " and the name spills into junk attributes. |
| 3 | `refer.html:835`, `906` | With no data, the page says "No tasks **match these filters**" even when no filter is on. This becomes the first screen once dummy data is removed. |
| 4 | `refer.html:847,907` | With zero workstreams, `[].every()` is true, so both collapse buttons say "Expand all". |
| 5 | `refer.html:782` vs `773` | Workstream row shows the **filtered** task count next to an **unfiltered** %. The card does the reverse (`refer.html:896`: total count, filtered list). |
| 6 | `refer.html:795,800` | Empty owner leaves a stray "· ·" in the text next to the bar. |
| 7 | `refer.html:685` | Owner filter lists workstream owners who own no tasks; picking one shows nothing. |

### Logic and data-model gaps
- **No cycle check on dependencies.** A can depend on B and B on A. No warning when a task starts before its prerequisite ends.
- **Status and progress aren't linked.** 100% can still be "In progress"; "Not started" can have 60%.
- **Not-started tasks past their start date aren't flagged.** Only a passed end date triggers anything.
- **No "behind schedule" signal.** A task 20% done with 80% of its time gone looks the same as one on pace.
- **% complete is a plain average.** A one-day milestone counts the same as a 3-month task.
- **"On track" includes Not started**, which is misleading.
- **Owner is free text.** "Rohan" and "Rohan Mehta" become two people.
- **Tasks show in insertion order.** No sorting or reordering.
- **Imports aren't checked** for duplicate IDs or dependencies on missing tasks.
- **No Blocked, On hold or Cancelled status.**

### Architecture limits
- **No shared data.** Each browser keeps its own copy; teams can't see each other's updates without passing JSON files around. This is the main blocker for a cross-team tracker.
- **No activity at all:** no change history, no who-changed-what, no comments, no last-updated date. The "Live" dot only means "redraws in the same browser."
- **No logins or permissions.**
- **Multiple tabs can overwrite each other.** Last save wins.
