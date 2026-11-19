# Notion integration via Notion MCP: implementation plan

Status: plan only. The Google integration is on branch `connectingGoogle`; Notion uses a different route (see §0).

Goal: each logged-in user connects **their own** Notion workspace with a single "Allow" click. They can then:
- browse, search and read **every page they can see in Notion**, including pages created after connecting;
- create a new page in the app that **shows up in their Notion**, the same way Compose sends a Gmail message.

## 0. Why Notion MCP and not Composio

Composio, Nango, Pipedream and direct API use all go through Notion's public-integration OAuth. That flow makes the user **tick pages in a page picker**, and the app never sees pages outside those picks, including new top-level pages created later.

Notion's hosted MCP server (`https://mcp.notion.com/mcp`) works differently: "MCP tools act with your full Notion permissions. They can access everything you can access." There's no picker, and custom apps are allowed to connect.

Costs of this route:
- **We store the tokens** (encrypted), and we refresh them ourselves.
- **Tool results are written for AI agents**, not as a fixed data format, so we parse them defensively.
- **Two kinds of users can't connect:**
  - Notion guests, who are workspace guests rather than members.
  - Enterprise workspaces where the admin allows "Approved MCP clients only". Their admin approves us by our redirect URL.

## 1. Decisions

| # | Question | Default | Why |
|---|---|---|---|
| N1 | How we talk to Notion | `@modelcontextprotocol/client@2` (2.4.0 on npm today, exact pin), Streamable HTTP to `mcp.notion.com/mcp`, protocol version pinned to `2026-07-28` | Notion's recommended client. One new dependency |
| N2 | App registration | **Dynamic client registration**, run once per redirect URI (dev and prod differ) and stored in our DB | Notion: re-registering "orphans prior grants", so the registration must persist |
| N3 | Token storage | New `NotionConnection` table, one row per user, with access and refresh tokens **encrypted with AES-256-GCM** (`node:crypto`) using a key from `NOTION_TOKEN_KEY` | Notion requires tokens on the server and encrypted at rest. No new dependency |
| N4 | Refresh | Access tokens last about 8 hours; read `expires_in` instead of assuming. Refresh within 60 seconds of expiry, **inside a Postgres row lock** (`SELECT … FOR UPDATE`), and save the rotated refresh token in the same transaction | Each refresh rotates the token. Two refreshes at once, or reusing a rotated token, can **revoke the whole grant**. Vercel runs many server instances, so an in-memory lock isn't enough |
| N5 | Ended grants | `invalid_grant` is final: delete the row and return 409 `NOTION_RECONNECT`. Never retry | Notion's guidance. Refresh tokens also expire 180 days after authorization at the latest, so users reconnect about twice a year |
| N6 | Permission | New `integrations:notion` | Separate from Google |
| N7 | Rendering pages | `react-markdown` + `remark-gfm`, with raw HTML left off (the default) | Pages come back as Notion-flavoured markdown. Raw HTML off means page content can't inject markup |
| N8 | Creating pages | The MCP create-page tool with title and markdown content. **Parent is optional**: no parent puts the page in the user's private pages (confirm in phase 0), and a parent picker is offered | Matches "write it here, it appears in their Notion" |
| N9 | Editing, moving or deleting existing pages | Not in scope | Not requested; these are the destructive tools |
| N10 | Demo mode | Feature off | Same as Google |
| N11 | Workspaces per user | One | Several = several rows; add when someone needs it |

## 2. Phases

### Phase 0: spike (scratchpad script, not committed)

A Node script that does the full flow against one test workspace:
- registers our app (dynamic client registration);
- signs in with PKCE (S256) and `resource=https://mcp.notion.com/mcp`, using a local redirect;
- exchanges the code;
- runs `tools/list`;
- calls the search, fetch, get-self and create-page tools;
- refreshes once.

It prints **tool names, input schemas, and result shapes, keys and counts only**, never page content. It saves one scrubbed fixture per tool for tests.

Things to confirm and write into this doc:
1. The exact tool names and arguments. Named in Notion's docs: `notion-search`, `notion-fetch`, `notion-get-self`, `notion-get-users`. The create tool is expected to be `notion-create-pages`.
2. **Search format**:
   - Is each result's ID, title, URL and last-edited time machine-readable (JSON in the text), or does it need parsing?
   - Does an empty query list recent pages?
   - Can results be limited to Notion only, excluding connected Slack or Drive sources?
3. **Create without a parent**: where does the page land, and does the result return its URL?
4. Whether `http://localhost` redirect URIs are accepted for development (production must be HTTPS).
5. Whether the consent screen lets the user choose which workspace, and how get-self reports it.
6. What a rate limit looks like, and whether a revoke or disconnect endpoint is advertised in the server metadata.

### Phase 1: connect and disconnect

1. **Schema** (Prisma migration):
   ```prisma
   model OAuthClient {          // our dynamic client registration, kept forever
     id           String @id @default(cuid())
     issuer       String
     redirectUri  String
     clientId     String
     clientSecret String?       // encrypted if issued
     @@unique([issuer, redirectUri])
   }
   model NotionConnection {
     userId       String   @id
     user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
     workspace    String   // name from get-self, for Settings
     accessToken  String   // AES-256-GCM, "iv.tag.ciphertext" base64
     refreshToken String
     expiresAt    DateTime
     updatedAt    DateTime @updatedAt
   }
   ```
   Deleting a user removes their Notion tokens through the cascade.
2. **`src/lib/crypto.ts`**:
   - `seal(text)` and `open(text)` with AES-256-GCM.
   - The key comes from `NOTION_TOKEN_KEY` (32 bytes, base64); a missing key gives 503 "Notion isn't configured".
   - One test: round-trip, a tampered value is rejected, and a wrong key is rejected.
3. **Routes**:
   - `POST /api/integrations/notion` (`integrations:notion`):
     - registers us if needed, using the MCP SDK's discovery;
     - creates `state` and a PKCE verifier and puts them in an **httpOnly, SameSite=Lax cookie** (10 minutes, holding the user ID);
     - returns `{ redirectUrl }`.
   - `GET /api/integrations/notion/callback`:
     - requires the logged-in session;
     - checks `state` against the cookie and that the cookie's user is the current user, then clears the cookie;
     - exchanges the code **on the server**, calls get-self for the workspace name, then upserts `NotionConnection`;
     - redirects to `/v2/settings?connected=notion`.

     This GET changes data. The checks on `state`, PKCE and the session are the cross-site protection, because `authorize()`'s same-origin check only covers non-GET requests.
   - `GET /api/integrations/notion` returns `{ status: "connected" | "none", workspace? }`.
   - `DELETE /api/integrations/notion` revokes the token if Notion advertises a way to, then deletes the row.
4. **Permission**: `"integrations:notion": "Connect their own Notion workspace"` in `src/lib/permissions.ts`.
5. **Settings**: a Notion row in the "Connected accounts" card, showing the workspace name and a Connect / Disconnect / Reconnect button.
   - If Notion refuses because the user is a guest or the client isn't approved, show its message, with "Ask your Notion admin to approve <redirect URL>" for the second case.

Exit: connect with one Allow click, see the workspace name, disconnect. Tokens in the DB are unreadable without the key.

### Phase 2: read

1. **`src/lib/notion.ts`**:
   - `notionTool(userId, name, args)`:
     - loads the row and refreshes it if it's close to expiry (the N4 lock);
     - opens an MCP client with `Authorization: Bearer <access>`, calls the tool and closes the client;
     - maps errors:
       - 401 → refresh once, then 409 `NOTION_RECONNECT`
       - rate limit → 429
       - tool error → 502
       - unexpected shape → 502 via an `upstream()` helper, the same one Google uses (move it to a shared file)
     - **never logs arguments or results**.

     `// ponytail:` note: one MCP connection per call. Cache a client per user per server instance if the handshake shows up in timings.
   - `searchPages(q, cursor?)` returns `{ id, title, icon, url, lastEdited, kind }[]`.
   - `getPage(id)` returns `{ title, url, markdown }`. Databases come back as their rows in markdown and render as a table.
   - Mappers are zod schemas written against the phase 0 fixtures.
2. **Routes** (GET, `integrations:notion`): `/api/notion?q=&cursor=` and `/api/notion/pages/[id]`. The ID is checked as a Notion UUID (32 hex characters, with or without dashes).
3. **UI**: a `/v2/notion` page with a sidebar entry and a `TopBar` title.
   - A search box over a list showing Name (icon + title), Type and Last edited.
   - Opening a page shows the title, "Open in Notion" and the markdown rendered with `react-markdown`. Links open in a new tab with `noopener`; Notion's custom tags are dropped.
   - Not-connected and reconnect states link to Settings, same as Google.
4. **Tests**: mappers against the fixtures, plus the refresh decision as a pure function (refresh or not, given `expiresAt` and now).

Exit: a connected user searches their workspace, sees a page created in Notion a minute ago without doing anything extra, and reads it with headings, tables and to-dos intact.

### Phase 3: create

1. **Route**: `POST /api/notion/pages` with a zod body `{ title (1–200), markdown (≤100k), parentId? }`.
   - It's a POST, so `authorize()` already blocks cross-origin requests.
   - It calls the create tool and returns `{ id, url }`.
   - **No retry.** A timeout may still have created the page, so return "Couldn't confirm. Check Notion before retrying".
   - Per-user cap: generalise `takeSend` in `google.ts` to a key per action, e.g. 30 pages per hour.
2. **"New page" UI**, styled like the redesigned Compose card:
   - "New page" header, a title line, and an optional **"In: Private ▾"** parent picker that searches pages.
   - A large markdown body with a Write / Preview toggle (Preview uses the phase 2 renderer).
   - "Create in Notion" button and a discard button.
   - On success: toast "Created in Notion" with an Open link, and the new page goes to the top of the list immediately.

Exit: a user writes a page in the app and it appears in their Notion, in their private pages or under a chosen parent, with the formatting intact.

### Phase 4: hardening

- Never log tokens, page content or tool results.
- `NOTION_TOKEN_KEY` goes in `.env.example` (blank) and Vercel. Rotating the key means every user reconnects; that's acceptable at this size.
- Revoking in Notion (Settings, then Connections) shows up as `NOTION_RECONNECT` on the next call, and Reconnect works.
- Composio outages don't affect Notion and the other way round.
- Add setup to the README, and update this status line.

### Phase 5: hand to the agent

The Cohere agent (planned next) calls the same `notionTool` with search, fetch and create. MCP tools are built for agents, so no extra wrappers are needed; create stays behind the same confirmation card as sending email.

## 3. Not planned

- Editing, appending to, moving or deleting existing pages (N9).
- Database rows as structured data, or syncing tasks to a Notion database.
- Comments, files, views.
- Linking Notion pages to tasks, which needs the same `TaskLink` table as Google.
- Composio for Notion (§0). Revisit only if Notion MCP blocks custom clients or the result formats prove unusable in phase 0.
