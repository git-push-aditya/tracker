# Prime Care Tracker

Cross-team progress dashboard for Prime Care: workstreams → tasks on a live Gantt, with login and role-based access.
Next.js (App Router) · Postgres on Supabase via Prisma 7 · deployed on Vercel. Design and phase notes: `docs/implementation-plan.md`.

## Run it

```bash
npm install            # also runs `prisma generate`
npm run dev
```

- **Demo mode** — leave `DATABASE_URL` unset. No login; the 30 sample tasks from `data/dummy-data.json`; edits live in the browser session only and vanish on refresh.
- **Database mode** — copy `.env.example` to `.env` and fill it in, then:

```bash
npx prisma migrate dev     # create tables (uses DIRECT_URL)
npx prisma db seed         # permissions, roles, first admins, 7 empty workstreams (safe to re-run)
```

Seeded admins (`snehpriya`, `aditya`) must change their password on first login. `SEED_PASSWORD_*` are only needed for the first seed.

## Scripts

| | |
|---|---|
| `npm test` | unit tests (auth rules, schemas, import, gantt layout, dashboard ops) |
| `npm run build` | production build (`vercel-build` also runs migrate + seed on Vercel production deploys) |
| `npx tsx --env-file=.env scripts/check-data-source.ts` | prints whether the app would serve demo data, DB data, or a DB error |

## Environment variables

`DATABASE_URL` (Supabase transaction pooler :6543, runtime) · `DIRECT_URL` (session pooler :5432, Prisma CLI). Use the pooler hosts (`aws-0-<region>.pooler.supabase.com`, user `postgres.<project-ref>`): the direct host is IPv6-only · `SEED_PASSWORD_SNEHPRIYA`, `SEED_PASSWORD_ADITYA` (first seed only).
The migrations enable row-level security on every table (no policies), so Supabase's public REST API can't read or write them; the app only talks to the database through Prisma.
Vercel (function region `bom1`, next to the Mumbai database): set the first two on **Production** only; Preview deploys then run in demo mode and can't touch the production database.

## Integrations (database mode only)

Each user connects **their own** accounts in **Settings**; nothing is shared between users. Grant the permissions `integrations:google` / `integrations:notion` to roles in Settings → Roles (admins have them).

- **Google** (Gmail, Calendar, Docs, Sheets) via Composio: set `COMPOSIO_API_KEY`. Details: `docs/google-integration-implementation.md`.
- **Notion** via Notion's hosted MCP server (one Allow click, no page picker; read, search and create pages). Details: `docs/notion-integration-implementation.md`.
  - `NOTION_TOKEN_KEY`: `openssl rand -base64 32`. Encrypts the stored Notion tokens; changing it means every user reconnects. Set it on Vercel Production.
  - `NOTION_CLIENT_ID`: **local dev only**, leave unset in production (production identifies itself with `/oauth/notion-client.json`). For `localhost:3000`, register once and paste the `client_id`:
    ```bash
    curl -s -X POST https://mcp.notion.com/register -H 'content-type: application/json' \
      -d '{"client_name":"Prime Care Tracker (local dev)","redirect_uris":["http://localhost:3000/api/integrations/notion/callback"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}'
    ```
  - Enterprise workspaces that only allow approved MCP clients: send their admin `docs/notion-admin-note.md`.
