# Master sheet sign-in (users, roles, workspaces)

The **set-up-master** Google Sheet (Drive → `brand-research` folder) holds every login, role, and each
user's workspace (data-sheet link, bridge URL, Gemini key, web-app URL). When these three server
environment variables are set, the dashboard switches from the single shared password to
email + password sign-in:

| Variable | Value |
|---|---|
| `MASTER_BRIDGE_URL` | `/exec` URL of the master Apps Script web app |
| `MASTER_BRIDGE_SECRET` | the secret you put on line 1 of `apps-script/MasterCode.gs` |
| `SESSION_SECRET` | any long random string (signs login sessions) |

Optional: `SESSION_HOURS` (default 12). Keep `DASHBOARD_PASSWORD` set — the daily automation
(`/api/automation-write?password=…`) still uses it and writes to `APPS_SCRIPT_URL`.

## One-time setup
1. Open the set-up-master sheet → Extensions → Apps Script.
2. Paste `apps-script/MasterCode.gs`, replace `__SECRET__` on line 1 with a long random string.
3. Deploy → New deployment → Web app → Execute as **Me**, access **Anyone** → copy the `/exec` URL.
4. Add the three variables in Vercel → redeploy.
5. Sign in as the administrator, open **Administration** to manage users, workspaces, roles.

Passwords are stored as salted SHA-256 hashes. Gemini keys and bridge secrets are stored in plain text
in the Workspaces tab, so keep the sheet's sharing restricted to administrators.
