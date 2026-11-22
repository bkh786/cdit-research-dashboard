# Brand Research & Insights — deployment & setup

## For the admin (once)
Host the folder as a static site (Vercel, no build step, **no environment variables**). Then follow `MASTER_SETUP.md` to connect the master sheet.

## For every user (5 minutes) — also shown inside the app under **Setup guide**
1. Create a blank Google Sheet.
2. In the app: Setup → **Copy bridge script** → in your sheet *Extensions → Apps Script*, paste, Save,
   *Deploy → New deployment → Web app* (Execute as **Me**, access **Anyone**), copy the `/exec` URL.
3. Paste the URL in the app → **Test connection** → **Set up my sheet** (creates all tabs + headers).
4. Paste your Gemini key (https://aistudio.google.com/apikey).
5. Enter the brands to track (optionally "Research now").
6. Settings: company, services, sender name and signature.

Your sheet stays private; the bridge only accepts requests carrying your secret. The secret, bridge URL and Gemini key
live in your private workspace row in the master sheet (or in this browser in personal mode). The browser talks to Google directly; no server stores them.

## Updating an existing bridge
Replace the Apps Script with the latest `apps-script/Code.gs` (keep your secret), then *Deploy → Manage deployments → Edit → New version*.

## Daily research automation
See `research/DAILY_RESEARCH_TASK.md`.

## Notes
- The shared password is a light gate, not per-user auth.
- AI research uses Google Search grounding; news links are kept only if search actually returned them. Contacts are never guessed —
  verify before outreach.
