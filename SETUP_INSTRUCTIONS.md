# CDIT Sales Intelligence Dashboard — Google Sheets + Vercel Setup (API key version)

Architecture: a static dashboard (`index.html`) calls one serverless function
(`api/sheet-data.js`) hosted on Vercel. That function holds a restricted
Google API key as an environment variable and reads your Google Sheet.
The key never reaches the browser. No service account, no org policy,
no admin approval needed anywhere in this flow.

## Step 1 — Create the Google Sheet

1. In your Google Drive, create a new Google Sheet named `CDIT Lead Automation`.
2. Create 6 tabs with these exact names (case-sensitive):
   `Brands Master`, `News feed`, `Opportunities`, `Contacts`, `Pipeline`, `Email Drafts`.
3. Import the data: File → Import → Upload → pick each CSV from the
   `csv_export/` folder → Import location: **Replace current sheet** →
   repeat for all 6 CSVs into their matching tab.
4. Copy the **Spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
5. Click **Share** (top right) → **General access** → change from
   "Restricted" to **"Anyone with the link"** → set the role to **Viewer**.
   This is what lets the API key read it — nobody can find this Sheet
   without the link, and the link/ID is never sent to the browser.

## Step 2 — Create a restricted Google API key

1. Go to https://console.cloud.google.com → select or create a project
   (any name, e.g. `cdit-dashboard`) — this part is unaffected by the
   service-account org policy you hit.
2. **APIs & Services → Library** → search "Google Sheets API" → **Enable**.
3. **APIs & Services → Credentials** → **Create Credentials → API key**.
   A key appears immediately — copy it.
4. Click **Restrict key** (important — don't skip this):
   - Under **API restrictions**, select "Restrict key" and check only
     **Google Sheets API**.
   - Leave "Application restrictions" as None — this key is called from
     Vercel's servers, not a browser, so HTTP referrer restrictions don't
     apply here.
   - Save.

This key can now do exactly one thing: read Sheets data. It can't touch
any other Google API or resource on your account.

## Step 3 — (No sharing step needed)

Because the Sheet's general access is "Anyone with the link – Viewer,"
any request carrying a valid link/ID can read it — including the API key
call from your Vercel function. There's no separate account to share with.

## Step 4 — Deploy to Vercel and set the environment variables

If you don't have a Vercel account, sign up free at vercel.com.

Easiest path, no GitHub needed: install Node.js if you don't have it, then
in a terminal run `npm install -g vercel`, `cd` into the unzipped
`vercel-dashboard` folder, and run `vercel`. It opens a browser to log in,
asks a few setup questions (accept defaults), and gives you a preview URL.

Alternative: push the folder to a private GitHub repo, then in Vercel click
**Add New → Project**, import that repo, deploy with default settings.

Once the project exists, go to **Settings → Environment Variables** and add
these three:

`GOOGLE_API_KEY` → the API key from Step 2.

`GOOGLE_SHEET_ID` → the spreadsheet ID from Step 1.

`DASHBOARD_PASSWORD` → any password you choose — this gates the whole dashboard.

Redeploy so the function picks up the new variables: `vercel --prod` from
the CLI, or **Deployments → Redeploy** in the web UI.

## Step 5 — Open it

Visit your Vercel URL, enter the `DASHBOARD_PASSWORD`, and the dashboard
should load live data. Hit **Refresh** any time — every request re-reads
the sheet, so edits show up immediately, whether you made them or I did.

## Troubleshooting

- **401 from the dashboard**: wrong password, or `DASHBOARD_PASSWORD` wasn't
  set before the last deploy.
- **500 / "Sheets API error 403"**: the Sheet's general access isn't set to
  "Anyone with the link," or the API key isn't restricted-but-enabled for
  Sheets API, or the Sheets API isn't enabled on the project.
- **500 / "Sheets API error 400"**: a tab name in the Sheet doesn't exactly
  match one of the 6 expected names.

## Security notes

- The Sheet is technically link-accessible, not private — treat the link
  itself as a secret. Don't paste it anywhere public.
- The dashboard's password gate is a shared secret, not per-user auth —
  fine for you alone, not for handing to a team without upgrading it.
- If this ever needs real multi-user access control or an audit trail,
  that's worth doing properly (e.g. Google Sign-In restricted to specific
  emails) before anything more sensitive goes into the sheet.

## Keeping it updated going forward

Whenever I run new research, I'll write directly into this Google Sheet
(once you share edit access with my session the same way). No redeploy
needed for data changes — only if the dashboard's code itself changes.
