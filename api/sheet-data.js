// Vercel serverless function: fetches the CDIT Lead Automation Google Sheet
// using a restricted API key (no service account, no org policy issues).
//
// Required environment variables (set in Vercel project settings):
//   GOOGLE_API_KEY        - a Google Cloud API key restricted to the Sheets API
//   GOOGLE_SHEET_ID        - the spreadsheet ID from its URL
//   DASHBOARD_PASSWORD    - a shared password gating access to this API/dashboard
//
// The Google Sheet must have general access set to "Anyone with the link - Viewer".
// The API key never reaches the browser - it stays server-side in this function.

const TABS = [
  "Brands Master",
  "News feed",
  "Opportunities",
  "Contacts",
  "Pipeline",
  "Email Drafts",
];

module.exports = async (req, res) => {
  const suppliedPassword = req.headers["x-dashboard-password"];
  if (!process.env.DASHBOARD_PASSWORD || suppliedPassword !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const apiKey = process.env.GOOGLE_API_KEY;
    // Sheet names containing spaces must be single-quoted in A1 notation,
    // e.g. 'Brands Master', otherwise the Sheets API fails to parse the range.
    const rangesQuery = TABS.map(t => `ranges=${encodeURIComponent(`'${t}'`)}`).join("&");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${rangesQuery}&valueRenderOption=UNFORMATTED_VALUE&key=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sheets API error ${response.status}: ${errText}`);
    }
    const data = await response.json();
    const valueRanges = data.valueRanges || [];

    const result = {};
    valueRanges.forEach((vr, i) => {
      const rows = vr.values || [];
      const headers = rows[0] || [];
      result[TABS[i]] = rows.slice(1).map(row =>
        Object.fromEntries(headers.map((h, idx) => [h, row[idx] ?? ""]))
      );
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ syncedAt: new Date().toISOString(), sheets: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load sheet data" });
  }
};
