# Brand Research & Insights — deployment & setup

## For the admin (once): deploy on Vercel
1. Push this repo to GitHub and import it in Vercel (no build step).
2. Set environment variables:
   - `DASHBOARD_PASSWORD` (required) — the access password.
   - Optional defaults so people can skip their own keys: `GEMINI_API_KEY`, `GEMINI_MODEL`.
   - Optional shared "team workspace": `APPS_SCRIPT_URL` + `APPS_SCRIPT_SECRET` (a bridge for the shared sheet).
     The old `GOOGLE_API_KEY` + `GOOGLE_SHEET_ID` read-only mode still works but is no longer needed.
3. Redeploy.

## For every user (5 minutes) — also shown inside the app under **Setup guide**
1. Create a blank Google Sheet.
2. In the app: Setup → **Copy bridge script** → in your sheet *Extensions → Apps Script*, paste, Save,
   *Deploy → New deployment → Web app* (Execute as **Me**, access **Anyone**), copy the `/exec` URL.
3. Paste the URL in the app → **Test connection** → **Set up my sheet** (creates all tabs + headers).
4. Paste your Gemini key (https://aistudio.google.com/apikey).
5. Enter the brands to track (optionally "Research now").
6. Settings: company, services, sender name and signature.

Your sheet stays private; the bridge only accepts requests carrying your secret. The secret, bridge URL and Gemini key
are stored in your browser (localStorage) and sent over HTTPS to this app's API, which forwards them — they are not stored server-side.

## Updating an existing bridge
Replace the Apps Script with the latest `apps-script/Code.gs` (keep your secret), then *Deploy → Manage deployments → Edit → New version*.

## Daily research automation
See `research/DAILY_RESEARCH_TASK.md`.

## Notes
- The shared password is a light gate, not per-user auth.
- AI research uses Google Search grounding; news links are kept only if search actually returned them. Contacts are never guessed —
  verify before outreach.
