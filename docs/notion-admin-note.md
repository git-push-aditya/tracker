# Prime Care Tracker and Notion: note for workspace admins

Prime Care Tracker is our internal progress dashboard. Members can connect their own Notion workspace to read and create Notion pages from inside the tracker. It connects through **Notion's official MCP server** (`mcp.notion.com`), using Notion's own sign-in and consent screen.

## What to approve

If your workspace allows only approved MCP clients (Notion Enterprise, admin MCP settings), approve:

| | |
|---|---|
| App name | Prime Care Tracker |
| Redirect URL | `https://<our-domain>/api/integrations/notion/callback` |
| Client ID (metadata document) | `https://<our-domain>/oauth/notion-client.json` |

Nothing else needs configuring. Each member then connects individually under Settings → Notion. Guests can't connect, which is a Notion rule.

## What it can access

- **Only what the connecting member can already see.** Notion MCP acts with that member's own Notion permissions and never bypasses them.
- **What the tracker actually does:**
  - lists the member's recent, private, shared and favourite pages;
  - searches pages;
  - reads a page the member opens;
  - **creates** a new page, either private or under a page the member chooses.
- **What it never does:** edit, move, archive or delete existing pages, and it never touches comments, databases, users or settings. The tracker's code only allows the specific Notion tools listed above, even though Notion's server offers more.
- Every new page is created by the member pressing "Create in Notion". There's a cap of 30 new pages per member per hour.

## What it stores

- **Stored:** the member's Notion access and refresh tokens, plus the workspace name and icon, so the tracker can show which workspace is connected.
  - Tokens are encrypted at rest (AES-256-GCM) in our Postgres database and are only decrypted on our server.
  - Notion's own rules apply: access tokens last about 8 hours, and a connection must be renewed at least every 180 days.
- **Not stored:** page content, titles and search results are fetched live, shown to the member, and not saved. They are not logged either.

## Removing access

Any of these ends access immediately:
- the member clicks **Disconnect** in the tracker's Settings, which revokes the token at Notion and deletes it from our database;
- the member or an admin removes the connection in Notion's settings;
- the member's tracker account is deleted, which deletes their stored Notion tokens.

## Contact

Questions: the Prime Care Tracker admins (<contact>).
