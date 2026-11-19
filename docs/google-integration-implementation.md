# Google integration via Composio — implementation plan

Status: phases 0–2 built on branch `connectingGoogle` (`@composio/core` pinned at 0.27.0), plus the Gmail part of phase 3: send and reply (plain text, 30 per user per hour, never retried). Email HTML renders in a sandboxed iframe (no scripts, remote images blocked until asked). Mail has folder tabs; Docs and Sheets show owner and a "Shared with me" filter. All checked against a real connected account; sending not yet tested live.

Goal: each logged-in user connects **their own** Google account, then can view and act on Gmail, Calendar, Docs and
Sheets from inside the tracker. Composio holds the OAuth tokens and runs the Google API calls; no LLM is involved.

## 1. Decisions

| # | Question | Default | Why |
|---|---|---|---|
| D1 | Whose Google OAuth app? | **Composio-managed** for phases 1–5; our own app is phase 6 | Users are on different domains, so an "Internal" Workspace app is out. Gmail read+write and Drive listing need **restricted** scopes; our own app would need Google verification plus a yearly CASA security assessment before outside users can sign in. Composio's app is already verified. Cost: consent screen says Composio, and quota is shared |
| D2 | Gmail access | Read + write: list, read, send, reply, drafts, labels. No permanent delete | Requested. Scope `gmail.modify` covers it. Confirm Composio's managed scope set in phase 0 |
| D3 | Listing a user's docs and sheets | **No `googledrive` toolkit.** `GOOGLEDOCS_SEARCH_DOCUMENTS` and `GOOGLESHEETS_SEARCH_SPREADSHEETS` list files | Found in the live catalog (phase 0). Saves a consent screen and the restricted full-Drive scope |
| D4 | Token storage | **None in our DB.** Composio is the source of truth. Composio `userId` = our `User.id` | `User.id` is a stable cuid (Composio says avoid emails). No new table until a feature needs one |
| D5 | Who can use it | New permission `integrations:google`. A user only ever sees and acts on their own account | `userId` always comes from the server session, never from the request |
| D6 | Accounts per user | One Google account per toolkit | Composio supports several; YAGNI |
| D7 | Freshness | Fetch when the page opens (React Query `staleTime` ~60s, refetch on focus). No webhooks until phase 5 | The app has no push channel to the browser, so webhooks alone wouldn't make the UI live |
| D8 | SDK surface | `@composio/core`, **sessions** (`composio.create(userId)`, `session.authorize`, `session.execute`), exact version pinned | Their docs call `tools.execute()` legacy, and it needs per-toolkit version pins |
| D9 | Demo mode (no `DATABASE_URL`) | Feature off. `authorize()` already 503s; UI hides the section | Matches every other write feature |

## 2. Phases

### Phase 0: setup and spike (no app code)

1. Create a Composio account and project, then get an API key. Add `COMPOSIO_API_KEY` to `.env`, `.env.example` (blank) and Vercel.
2. In the Composio dashboard, check that managed auth exists for `gmail`, `googlecalendar`, `googledocs` and `googlesheets`, and **write down the scopes each one requests**. If `gmail` lacks `gmail.modify` (or `mail.google.com`), D1 needs revisiting.
3. Write a throwaway script in the scratchpad (not committed). It connects one test Google account and runs every tool in the table below, so we can confirm the exact slugs, argument names and response shapes.
4. Check the current free-tier tool-call limit at composio.dev/pricing (sources disagree: 10K, 20K or 100K a month).

Exit: this table is filled in with confirmed slugs.

| Need | Toolkit | Tool slug (confirmed in catalog) |
|---|---|---|
| List / search mail | gmail | `GMAIL_FETCH_EMAILS` |
| Read thread | gmail | `GMAIL_FETCH_MESSAGE_BY_THREAD_ID` |
| Send / reply | gmail | `GMAIL_SEND_EMAIL`, `GMAIL_REPLY_TO_THREAD` |
| Draft | gmail | `GMAIL_CREATE_EMAIL_DRAFT`, `GMAIL_SEND_DRAFT` |
| Labels | gmail | `GMAIL_LIST_LABELS`, `GMAIL_ADD_LABEL_TO_EMAIL` |
| List events | googlecalendar | `GOOGLECALENDAR_EVENTS_LIST` |
| Create / update / delete event | googlecalendar | `GOOGLECALENDAR_CREATE_EVENT`, `GOOGLECALENDAR_PATCH_EVENT`, `GOOGLECALENDAR_DELETE_EVENT` |
| List docs | googledocs | `GOOGLEDOCS_SEARCH_DOCUMENTS` |
| Read doc | googledocs | `GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT` |
| Create / edit doc | googledocs | `GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN`, `GOOGLEDOCS_INSERT_TEXT_ACTION` |
| List sheets | googlesheets | `GOOGLESHEETS_SEARCH_SPREADSHEETS` |
| Read range | googlesheets | `GOOGLESHEETS_VALUES_GET` |
| Write / append rows | googlesheets | `GOOGLESHEETS_VALUES_UPDATE`, `GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND` |

### Phase 1: connect and disconnect

1. **Dependency**: `npm i @composio/core@<exact>`.
2. **Client**: `src/lib/composio.ts`
   - Lazy singleton like `prisma()`; throws `HttpError(503, "Google integration not configured")` when the key is missing.
   - `userAccounts(userId, toolkits)` lists that user's connected accounts.
   - Toolkit list, labels, zod enum and status mapping live in `src/lib/google-toolkits.ts`, which is client-safe so Settings doesn't bundle the SDK.
3. **Permission**: add `"integrations:google"` to `src/lib/permissions.ts`; `prisma/seed.ts` syncs it. Admin gets it through `ALL_PERMISSION_KEYS`; grant it to other roles in Settings.
4. **Routes** (all through `handle()` and `requireSession(req, "integrations:google")`):
   - `GET /api/integrations/google` returns `{ toolkit, status: "connected" | "expired" | "none" }[]`, built from `session.toolkits()`.
   - `POST /api/integrations/google/[toolkit]` returns `{ redirectUrl }`. It refuses (409) if already connected, deletes any stale expired or half-finished accounts so each user keeps at most one per toolkit, then calls `session.authorize(toolkit, { callbackUrl })`, with `callbackUrl` built **on the server** as `<origin>/v2/settings?connected=<toolkit>`.
   - `DELETE /api/integrations/google/[toolkit]` revokes the Google grant (best effort) and deletes this user's accounts for that toolkit.
5. **Callback**: Settings treats `?connected=` as a hint only. It refetches the GET route, and shows "Connected" only if the server says `connected`.
6. **UI**: a "Connected accounts" card in `src/components/v2/Settings.tsx`, with one row per toolkit and a Connect / Disconnect / Reconnect (expired) button. No "Connect all" yet; add it if four separate clicks bother people.
   - UX cost: each toolkit is its own Google consent screen (four screens). One combined consent needs our own OAuth app with a single auth config (phase 6).
7. **Test**: `src/lib/google-toolkits.test.ts` covers the status mapping and the toolkit enum.

Exit: a user connects Gmail, sees it as connected, disconnects it, and sees it as gone. A user without the permission gets a 403.

### Phase 2: read (view)

1. **Wrappers**: `src/lib/google.ts`, with one function per need from the phase 0 table (`listMail`, `getThread`, `listEvents`, `listFiles(kind)`, `getDoc`, `getRange`).
   - Each calls `session.execute(slug, args)` and **parses the result with zod** into a small shape. Composio and Google output is untrusted input.
   - Keep payloads small with `max_results`, `include_payload=false` and page tokens.
   - Error mapping lives in `runTool` (`src/lib/google.ts`):
     - not connected, expired or revoked (Composio `ToolRouterV2_NoActiveConnection`) → 409 `GOOGLE_NOT_CONNECTED`
     - Composio 429 → 429
     - tool ran but failed → 502 with the Composio log ID
     - response shape we don't expect → 502 (never a 400, which would blame our user)
2. **Routes** (GET, `integrations:google`):
   - `/api/google/mail?q=&page=`
   - `/api/google/mail/[threadId]`
   - `/api/google/calendar?from=&to=`
   - `/api/google/files?kind=doc|sheet&q=`
   - `/api/google/docs/[id]`
   - `/api/google/sheets/[id]?range=`
3. **UI**:
   - A `/v2/google` page with tabs: Mail, Calendar, Docs, Sheets.
   - Hooks live in `src/hooks/v2/useGoogle.ts`.
   - An empty state links to Settings when a toolkit isn't connected; `GOOGLE_RECONNECT` shows a Reconnect button.
   - **Email HTML is never injected into our DOM.** v1 shows Composio's plain-text `messageText` only. If HTML rendering is wanted later, use `<iframe sandbox srcdoc>` (no `allow-scripts`).
   - Docs: plain text view plus an "Open in Google" link. Sheets: show the first range as a table.
4. **Test**: zod mappers against one saved sample response per tool (fixtures from the phase 0 spike, with personal data scrubbed).

Exit: a connected user browses their inbox, opens a thread, sees this week's events, and lists and opens a doc and a sheet.

### Phase 3: write (push)

1. **Routes** (`integrations:google`; non-GET, so `authorize()` already enforces same-origin; zod body on every route):
   - `POST /api/google/mail/send` takes `{ to[], cc[], bcc[], subject, body, threadId? }`. With `threadId` it replies.
   - `POST /api/google/mail/drafts`
   - `POST /api/google/calendar/events`, `PATCH` and `DELETE /api/google/calendar/events/[id]`
   - `POST /api/google/docs` creates a doc; `PATCH /api/google/docs/[id]` appends or replaces text.
   - `POST /api/google/sheets/[id]/append`, `PUT /api/google/sheets/[id]?range=`
2. **No retries on sends.** A Gmail send that times out may still have gone through. Return "Couldn't confirm. Check Sent before retrying" instead of resending. `handle()` already skips retries for non-GET.
3. **UI**: compose and reply dialog with an explicit Send button, plus event, doc and sheet-append dialogs, all reusing `src/components/v2/Dialogs.tsx` patterns. Use optimistic updates only for calendar edits; mail refetches after send.
4. **Abuse guard**: a per-user cap on sends (e.g. 50/hour), using the same counting idea as `LoginAttempt`.

Exit: a user sends and replies to mail, creates and edits an event, creates a doc, and appends a sheet row. Each change shows up in Google.

### Phase 4: hardening

- **Logging**: never log message bodies, doc content or Composio responses. `toResponse` logs only unknown errors; make sure those don't include payloads.
- **Composio outage**: with a missing key or unreachable API, the Google page shows an error card and the rest of the app is unaffected.
- **Revoked access**: revoking in Google account settings shows up as `expired` on the next call, and the Reconnect flow works.
- **Disconnect on user deletion**: when an admin deletes a user (`/api/users`), delete their Composio connected accounts too.
- README: env var and setup steps. Update this doc's status line.

### Phase 5 (optional): live updates and expiry alerts

Only if a feature needs the server to react to Google events (an unread badge, auto-linking mail to tasks).

- One `POST /api/webhooks/composio` route. It skips `authorize()` and `assertSameOrigin`, because Composio calls it rather than a browser, and verifies the signature (`composio.triggers.verifyWebhook`) instead.
- Per-user triggers for new Gmail messages and Calendar events (near-instant); Drive and Sheets poll every ~2 minutes.
- Handle `composio.connected_account.expired` to flag the user before a call fails.
- The browser still only learns about changes through React Query refetch or polling.

### Phase 6 (optional): our own Google OAuth app

Needed for our own branding on the consent screen, our own quota, or one consent screen instead of four.

1. Google Cloud project with an External consent screen. Requirements: a verified domain, a public privacy policy and terms pages, and a demo video.
2. Scopes needed:
   - sensitive (`calendar`, `spreadsheets`, `documents`): standard verification
   - restricted (`gmail.modify`, `drive.readonly`): verification plus a **CASA assessment through a third-party lab, renewed yearly**
   - Lead time: weeks to months. Start early if branding matters.
3. Redirect URI: `https://backend.composio.dev/api/v3/toolkits/auth/callback`. Optionally forward through our own domain, but Composio's domain still appears.
4. Create Composio auth configs with our credentials and pass `authConfigs: { gmail: "ac_…", … }` to `composio.create`. **Existing users must reconnect.**

## 3. Not planned

- Linking Google items to tasks (an email thread, doc or event on a Task), which needs a `TaskLink` table. Add after phase 3 if wanted.
- AI features over mail and docs.
- Shared or team mailboxes.
- Building on direct Google APIs, Nango or Pipedream instead of Composio. Revisit only if Composio's managed scopes or pricing fail phase 0; they face the same Google verification rules as phase 6.
