# Platform setup (no server variables)

The web app is static. The browser talks directly to Google Apps Script (master sheet + each user's data sheet) and to Gemini. **Nothing needs to be configured in Vercel.**

## One-time, by the administrator
1. Open the **set-up-master** Google Sheet → Extensions → Apps Script. Replace the code with `apps-script/MasterCode.gs`.
2. Deploy → New deployment → Web app → Execute as **Me**, access **Anyone** → copy the `/exec` URL.
   (Updating later: Deploy → Manage deployments → ✏️ → New version. The URL stays the same.)
3. Put the URL in `config.js` (`masterUrl`) and push, **or** open the site once with `?master=<exec-url>`.
4. Sign in with the admin email and password. The sheet stores a salted hash, never the plain password.

Session tokens are signed by the script itself with an auto-generated key — no secret to set.

## Per user
Administration → Users → Add user. Each person then opens Setup, creates their own sheet, pastes the bridge script (`apps-script/Code.gs`, v2.1.0+) and adds a Gemini key. Everything is saved to their row in the master sheet and follows them to any device.

## Auto-research
Each user generates their own scheduled-research files on the **Auto-research** page (Claude skill, Gemini Apps Script runner, or ChatGPT task prompt).
