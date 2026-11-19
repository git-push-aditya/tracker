# Notion integration via Notion MCP: implementation plan

Status: phase 0 spike done on 2026-11-19 (findings below). Phase 1 built: connect several workspaces, disconnect, Settings card. Phase 2 built: /v2/notion with workspace dropdown, Recent/Private/Shared/Favorites, search, page reader (react-markdown + rehype-raw + rehype-sanitize). Phase 3 built: "New page" (private by default or under a searched parent, Write/Preview, 30 per user per hour, never retried). Phase 4 not started; phases 1–3 not yet tried end to end against a real workspace in the app. The Google integration is on branch `connectingGoogle`; Notion uses a different route (see §0).

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
| N2 | App identity | **Client ID metadata document**: we serve `/oauth/notion-client.json` (name, redirect URIs) and its HTTPS URL **is** our `client_id`. Notion advertises `client_id_metadata_document_supported: true`. Local dev, which has no public URL, uses a one-time dynamic registration with a `localhost` redirect, kept in `.env` as `NOTION_CLIENT_ID`. Code: `client_id = process.env.NOTION_CLIENT_ID ?? <origin>/oauth/notion-client.json` | One fixed identity per environment, so Enterprise admins always approve the same "Prime Care Tracker". No registration table, and no risk of re-registering and "orphaning prior grants" |
| N3 | Token storage | New `NotionConnection` table, one row per user, with access and refresh tokens **encrypted with AES-256-GCM** (`node:crypto`) using a key from `NOTION_TOKEN_KEY` | Notion requires tokens on the server and encrypted at rest. No new dependency |
| N4 | Refresh | Access tokens last about 8 hours; read `expires_in` instead of assuming. Refresh within 60 seconds of expiry, **inside a Postgres row lock** (`SELECT … FOR UPDATE`), and save the rotated refresh token in the same transaction | Each refresh rotates the token. Two refreshes at once, or reusing a rotated token, can **revoke the whole grant**. Vercel runs many server instances, so an in-memory lock isn't enough |
| N5 | Ended grants | `invalid_grant` is final: delete the row and return 409 `NOTION_RECONNECT`. Never retry | Notion's guidance. Refresh tokens also expire 180 days after authorization at the latest, so users reconnect about twice a year |
| N6 | Permission | New `integrations:notion` | Separate from Google |
| N7 | Rendering pages | `react-markdown` + `remark-gfm` + `rehype-raw` + **`rehype-sanitize`** (GitHub allow-list) | Notion uses HTML-style tags for tables and toggles, so raw HTML is parsed, then sanitised: scripts, styles, iframes, event handlers and `javascript:` links are removed, unknown tags are unwrapped and keep their text |
| N8 | Creating pages | `notion-create-pages` with title and markdown. **Default `creation_mode: "draft"`**, a private page in their workspace (confirmed), with an optional parent picker | Matches "write it here, it appears in their Notion" |
| N9 | Editing, moving or deleting existing pages | Not in scope | Not requested; these are the destructive tools |
| N10 | Demo mode | Feature off | Same as Google |
| N11 | Workspaces per user | **Several.** One row per (user, workspace). The **first connected is the default**, and a dropdown on the Notion page switches between them | Requested. Each Allow grants one workspace, so "+ Add workspace" runs the sign-in again |

## 2. Phases

### Phase 0: spike (done 2026-11-19)

A scratchpad script (not committed) ran the full flow against a real, non-Business workspace:
- dynamic registration;
- PKCE sign-in with a `localhost` redirect;
- `tools/list`;
- listing, search, fetch and create;
- a refresh.

Only shapes and counts were printed. One test page, "Prime Care test page (safe to delete)", was created as a private draft.

| Question | Finding |
|---|---|
| Sign-in | One Allow screen, no page picker. `localhost` redirect accepted. The token response already includes `workspace_name`, `workspace_id`, `workspace_icon` and `user_id`, so there's **no extra call for the workspace name** |
| Tokens | `expires_in` 28800 (8 hours). Refresh works and **rotates** the refresh token. Replaying the previous refresh token right away was still accepted (a grace window), but keep the N4 lock: Notion documents revocation on replay |
| Result format | Read tools return **`structuredContent` JSON**, with the same JSON also in the text part. No text parsing needed. Search adds a `notices` array (plan upsell messages), which we ignore |
| Listing pages | Dedicated tools, all `{ limit ≤200, cursor }` → `{ results: [{ type: "page"\|"database", url, title, icon }] }`. There's no `id` field; the 32-hex ID is in the URL (`app.notion.com/p/<id>`):<br>• `notion-list-recent-pages` (recently **viewed**)<br>• `notion-list-private-pages`<br>• `notion-list-shared-pages`<br>• `notion-list-favorite-pages` |
| Search | `notion-search { query, query_type: "internal", page_size }` → `{ results: [{ id, title, url, type, highlight, timestamp }], type }`. Notion only, not connected apps. **The query must be non-empty.** `sort` and `filters` need a Business or Enterprise plan and are silently dropped otherwise, so "browse everything by last edited" isn't available on Free or Plus. The listing tools cover browsing |
| Reading | `notion-fetch { id: <url or id> }` → `{ title, url, text, icon: { emoji }, page_last_edited_at, metadata: { type } }`. `text` is Notion-flavoured markup: `<page><ancestor-path>…<properties>…<content>MARKDOWN</content>`. Take the `<content>` part and drop Notion's custom tags before rendering |
| Creating | `notion-create-pages { creation_mode: "draft", pages: [{ properties: { title }, content: markdown }] }` creates a **private workspace-level page**, or pass `parent: { page_id }` instead of draft mode. It returns `{ pages: [{ id, url }] }`, took about 1s, and the page appeared **immediately** in the private list and in search, with no lag |
| Speed | MCP connect about 1.2s, then about 350–450ms per call. The connect cost matters, so cache the connection (phase 2) |
| Revocation | `POST https://mcp.notion.com/token` with `token` + `token_type_hint` + `client_id` returns 200, and the access token is refused (401) straight after. Disconnect uses this |
| Danger | The server also exposes `notion-update-page`, `notion-delete-pages`, `notion-move-pages` and about 60 other tools. **Our wrapper allow-lists the tools it may call** (the list, search, fetch and create tools above) |

Not tested: rate-limit responses, the workspace chooser for users in several workspaces, and Enterprise admin approval (§3).

### Phase 1: connect and disconnect

1. **Schema** (Prisma migration):
   ```prisma
   model NotionConnection {
     id           String   @id @default(cuid())
     userId       String   // → User, onDelete: Cascade
     workspaceId  String
     workspace    String   // workspace_name from the token response
     icon         String?
     accessToken  String   // AES-256-GCM, "iv.tag.ciphertext" base64url
     refreshToken String
     expiresAt    DateTime
     createdAt    DateTime @default(now())  // oldest = default workspace
     updatedAt    DateTime @updatedAt
     @@unique([userId, workspaceId])
   }
   ```
   RLS is enabled on the table, like every other table.
   Deleting a user removes their Notion tokens through the cascade.
2. **`src/lib/crypto.ts`**:
   - `seal(text)` and `open(text)` with AES-256-GCM.
   - The key comes from `NOTION_TOKEN_KEY` (32 bytes, base64); a missing key gives 503 "Notion isn't configured".
   - One test: round-trip, a tampered value is rejected, and a wrong key is rejected.
3. **Routes**:
   - `GET /oauth/notion-client.json` (public, static): `{ client_id: <its own URL>, client_name: "Prime Care Tracker", client_uri, logo_uri, redirect_uris: [<origin>/api/integrations/notion/callback], grant_types: ["authorization_code","refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }`.
   - `POST /api/integrations/notion` (`integrations:notion`):
     - creates `state` and a PKCE verifier and puts them in an **httpOnly, SameSite=Lax cookie** (10 minutes, holding the user ID);
     - returns `{ redirectUrl }`.
   - `GET /api/integrations/notion/callback`:
     - requires the logged-in session;
     - checks `state` against the cookie and that the cookie's user is the current user, then clears the cookie;
     - exchanges the code **on the server**, takes `workspace_name` from the token response, then upserts `NotionConnection`;
     - redirects to `/v2/settings?connected=notion`.

     This GET changes data. The checks on `state`, PKCE and the session are the cross-site protection, because `authorize()`'s same-origin check only covers non-GET requests.
   - `GET /api/integrations/notion` returns `[{ id, workspace, icon }]`, oldest first.
   - `DELETE /api/integrations/notion/[id]` revokes at Notion (best effort), then deletes that row (only the caller's own rows).
   - Reconnecting a workspace that's already connected upserts it: fresh tokens, same place in the list.
4. **Permission**: `"integrations:notion": "Connect their own Notion workspace"` in `src/lib/permissions.ts`.
5. **Settings**: a Notion card listing connected workspaces (icon, name, "Default" on the first when there are several, Disconnect) with a Connect Notion / "+ Add workspace" button.
   - If Notion refuses because the user is a guest or the client isn't approved, show its message. For the second case, add "Your Notion admin needs to approve Prime Care Tracker", plus the address to approve and a link to the admin note (§3).

Exit: connect with one Allow click, see the workspace name, disconnect. Tokens in the DB are unreadable without the key.

### Phase 2: read

1. **`src/lib/notion.ts`**:
   - `notionTool(userId, name, args)`:
     - loads the row and refreshes it if it's close to expiry (the N4 lock);
     - **refuses any tool not on the allow-list** (the four list tools, `notion-search`, `notion-fetch`, `notion-create-pages`);
     - uses an MCP client with `Authorization: Bearer <access>`, **cached per user per server instance** (connect costs about 1.2s) and rebuilt when the token changes;
     - maps errors:
       - 401 → refresh once, then 409 `NOTION_RECONNECT`
       - rate limit → 429
       - tool error → 502
       - unexpected shape → 502 via an `upstream()` helper, the same one Google uses (move it to a shared file)
     - **never logs arguments or results**.

   - `listPages(folder, cursor?)`, where `folder` is `recent | private | shared | favorites`, returns `{ id (taken from the URL), title, icon, url, kind }[]` plus a cursor.
   - `searchPages(q)` returns the same fields plus `lastEdited`. The query must be non-empty.
   - `getPage(id)` returns `{ title, url, icon, lastEdited, markdown }`, with markdown taken from `<content>` and custom tags stripped. Databases return data-source tags; v1 shows "Open in Notion" for those.
   - Mappers are zod schemas written against the phase 0 fixtures.
2. **Routes** (GET, `integrations:notion`), each taking `?ws=<connection id>` (default: the first workspace): `/api/notion?q=&cursor=` and `/api/notion/pages/[id]`. The ID is checked as a Notion UUID (32 hex characters, with or without dashes).
3. **UI**: a `/v2/notion` page with a sidebar entry and a `TopBar` title.
   - **Workspace dropdown** in the header (hidden with one workspace). The choice is remembered per browser and defaults to the first.
   - **Folder tabs like Gmail's**: Recent, Private, Shared, Favorites, plus a search box (search replaces the tab list while a query is typed).
   - A list showing Name (icon + title) and Type, plus Last edited in search results. "Load more" uses the cursor.
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
   - "New page" header, a title line, and an optional **"In: Private ▾"** parent picker. Default is private (draft mode); the picker searches pages.
   - A large markdown body with a Write / Preview toggle (Preview uses the phase 2 renderer).
   - "Create in Notion" button and a discard button.
   - On success: toast "Created in Notion" with an Open link, and the Private tab refetches (Notion shows the page immediately).

Exit: a user writes a page in the app and it appears in their Notion, in their private pages or under a chosen parent, with the formatting intact.

### Phase 4: hardening

- Never log tokens, page content or tool results.
- `NOTION_TOKEN_KEY` goes in `.env.example` (blank) and Vercel. Rotating the key means every user reconnects; that's acceptable at this size.
- Revoking in Notion (Settings, then Connections) shows up as `NOTION_RECONNECT` on the next call, and Reconnect works.
- Composio outages don't affect Notion and the other way round.
- Revoke on disconnect through the advertised revocation endpoint (`https://mcp.notion.com/token`).
- Add setup to the README, and update this status line.

### Phase 5: hand to the agent

The Cohere agent (planned next) calls the same `notionTool` with search, fetch and create. MCP tools are built for agents, so no extra wrappers are needed; create stays behind the same confirmation card as sending email.

## 3. Enterprise workspaces

- **Unrestricted Enterprise:** no extra work; members connect like anyone else.
- **"Approved MCP clients only":** the workspace admin adds our app once in Notion's admin MCP settings, identified by our production redirect `https://<our-domain>/api/integrations/notion/callback`, and members can then connect.
- **Our side** (about half a day):
  - a fixed HTTPS production domain, never a preview URL;
  - the metadata document (N2), so the name and address the admin sees never change;
  - the "needs admin approval" message (phase 1);
  - `docs/notion-admin-note.md`, a one-page note for IT: what we access (pages the user can see, and creating pages), that tokens are encrypted on our server and deleted on disconnect, and that we never store page content.
- **Guests** can't use Notion MCP at all; Settings says so.
- **Testing** the approval flow needs an Enterprise workspace (a trial, or a customer admin). Everything else is tested on a normal workspace.

## 4. Not planned

- Editing, appending to, moving or deleting existing pages (N9).
- Database rows as structured data, or syncing tasks to a Notion database.
- Comments, files, views.
- Linking Notion pages to tasks, which needs the same `TaskLink` table as Google.
- Composio for Notion (§0). Revisit only if Notion MCP blocks custom clients or the result formats prove unusable in phase 0.
