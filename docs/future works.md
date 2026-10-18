# Prime Care Dashboard — Future Work

Features from Jira and Confluence worth adding, filtered against the goal: one product (Prime Care), every team (tech, marketing, CRM, sales, hiring…), a Gantt chart and activity status.

## Jira and Confluence features worth adding

### Must-have (directly serves the goal)

| Source | Feature | What it would be here |
|---|---|---|
| Jira (all) | Shared multi-user data, logins, roles (admin / editor / viewer) | Prerequisite for everything below |
| Jira | **Activity stream / issue history** | A log per task and across the product: who changed status, %, dates or owner, and when |
| Jira | **Comments + @mentions** | A thread under each task |
| Jira | Workflow statuses | Add Blocked, On hold, Cancelled. Optionally require a reason when setting Blocked or At risk |
| Jira Timeline / Plans | **Drag to move or resize bars**, dependency warnings | Edit dates directly on the Gantt, flag broken dependencies, catch cycles |
| Jira | Assignees as real people | A team list per workstream instead of free-text names |
| Jira | Priority, labels | Priority field and tags (e.g. "launch-critical") |
| Jira | Text search (simplified JQL) | Search box plus saved filter views |
| Jira | "Updated" date on each task | A "stale: no update in 7 days" flag |

### Should-have

| Source | Feature | What it would be here |
|---|---|---|
| Jira | Epics → Stories → Subtasks | One more level: Workstream → Epic/Task → Subtask |
| Jira Plans | Baselines, schedule variance | "Planned vs actual" ghost bars; automatic *behind schedule* flag |
| Jira Plans | Critical path | Highlight the dependency chain that decides the launch date |
| Jira | Releases | Group milestones into releases (v2 launch, etc.) |
| Jira Work Management | List, Board (Kanban) and Calendar views | Same data, other views; useful for marketing and hiring teams |
| Jira | Dashboard reports | Burndown, created vs resolved, status trend over time, per-team health |
| Jira | Watchers and notifications | Email or Slack when your task changes or you're mentioned |
| Confluence | Status reports | Weekly snapshot page per workstream: what's done, blocked, next |
| Confluence | Decision log | Record decisions with date, owner and linked tasks |
| Jira | Attachments and links | Attach files or link URLs (Figma, docs, PRs) |

### Later / skip (YAGNI for now)

- **Possibly later:** sprints, story points, velocity (only matter for the tech team); time logging; automation rules; CSV import from Jira; GitHub/Slack integrations; custom fields; Confluence-style page tree with templates; whiteboards; AI summaries.
- **Skip:** what-if planning scenarios and capacity planning. Heavyweight and not needed for a single product.

## Recommendations

The biggest jump is **shared data plus an activity log**. Most of the must-have list depends on it, and it's what turns this from a personal planner into a tracker for the whole product. Everything else builds on the existing Gantt, which is already solid.

### Open decisions

1. **Empty starting point:** keep the 7 workstream names (Product, Tech Integrations, Growth & CRM, Sales, Social Media, Media Planner, Hiring) as empty sections, or start completely blank?
2. **Hosting:** stay a single file each person runs on their own machine, or move to a shared app with a backend and logins? The second is required for activity status to mean anything across teams.
