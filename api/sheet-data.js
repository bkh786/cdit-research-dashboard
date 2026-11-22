// Reads the workspace's Google Sheet.
//
// Preferred path  : the user's Apps Script bridge (action "readAll") — the sheet stays private.
// Legacy fallback : GOOGLE_API_KEY + GOOGLE_SHEET_ID env vars (sheet shared "Anyone with the link").
//
// ?password= is still accepted (GET) so the daily research automation can read the data.

const { authorize, workspace, bridge, handle } = require("./_lib/common");

const TABS = [
  "Brands Master", "News feed", "Opportunities", "Contacts", "Pipeline",
  "Email Drafts", "Competitor Watch", "Email Settings", "Workspace Settings",
];

module.exports = handle(async (req, res) => {
  if (!authorize(req, res)) return;
  const ws = workspace(req);
  res.setHeader("Cache-Control", "no-store");

  const base = {
    syncedAt: new Date().toISOString(),
    geminiConnected: !!ws.geminiKey,
    geminiModel: ws.geminiModel || "gemini-2.5-flash",
    usingOwnSheet: ws.custom,
    ownWorkspace: ws.own,
  };

  // 1) Bridge (read + write, private sheet)
  if (ws.bridgeUrl) {
    try {
      const data = await bridge(ws, { action: "readAll" });
      if (data && data.sheets) {
        const sheets = {};
        TABS.forEach((t) => (sheets[t] = data.sheets[t] || []));
        res.status(200).json({ ...base, connection: "bridge", writable: true, spreadsheet: data.spreadsheet || "", sheets, headers: data.headers || {} });
        return;
      }
      // Legacy bridge without readAll → fall through to the API-key path if possible
      if (!ws.googleApiKey || !ws.sheetId || ws.custom) {
        const e = new Error("Your bridge is an older version without read support. Re-paste the latest bridge script (Setup → Connect) and redeploy.");
        e.status = 400;
        throw e;
      }
    } catch (err) {
      const legacyUnknown = /unknown action/i.test(err.message);
      if (!legacyUnknown || ws.custom || !ws.googleApiKey || !ws.sheetId) throw err;
    }
  }

  // 2) Legacy Google API key reader (owner's original deployment)
  if (ws.own || !ws.googleApiKey || !ws.sheetId) {
    res.status(200).json({ ...base, connection: "none", writable: false, sheets: Object.fromEntries(TABS.map((t) => [t, []])), headers: {} });
    return;
  }

  let available = [...TABS];
  try {
    const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ws.sheetId}?fields=sheets.properties.title&key=${ws.googleApiKey}`);
    if (meta.ok) {
      const titles = ((await meta.json()).sheets || []).map((s) => (s.properties && s.properties.title) || "");
      available = TABS.map((t) => titles.find((x) => x.trim().toLowerCase() === t.toLowerCase())).filter(Boolean);
    }
  } catch (_) {}
  if (!available.length) available = [...TABS];

  const ranges = available.map((t) => `ranges=${encodeURIComponent(`'${t}'`)}`).join("&");
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ws.sheetId}/values:batchGet?${ranges}&valueRenderOption=FORMATTED_VALUE&key=${ws.googleApiKey}`);
  if (!r.ok) throw new Error(`Sheets API error ${r.status}: ${await r.text()}`);
  const data = await r.json();

  const sheets = Object.fromEntries(TABS.map((t) => [t, []]));
  const headers = {};
  (data.valueRanges || []).forEach((vr, i) => {
    const name = TABS.find((t) => t.toLowerCase() === (available[i] || "").toLowerCase()) || available[i];
    const rows = vr.values || [];
    const h = rows[0] || [];
    headers[name] = h;
    sheets[name] = rows.slice(1).map((row) => Object.fromEntries(h.map((col, idx) => [col, row[idx] ?? ""])));
  });

  res.status(200).json({ ...base, connection: "apikey", writable: !!ws.bridgeUrl, sheets, headers });
});
