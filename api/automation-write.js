// GET-based write endpoint for the automated daily research task, whose
// fetch tool can only issue plain GET requests (no custom headers, no POST
// bodies). The human dashboard does NOT use this — it still uses the
// POST-based /api/sheet-write. This forwards to the same Apps Script
// bridge, server-side, where a normal POST works fine.
//
// Query params:
//   ?password=...&action=appendRows&sheet=News+feed&rows=<url-encoded JSON array>
//   ?password=...&action=addBrand&brand=<url-encoded JSON>&pipeline=<url-encoded JSON>
//
// Reuses the same env vars as sheet-data.js / sheet-write.js:
//   DASHBOARD_PASSWORD, APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

module.exports = async (req, res) => {
  const suppliedPassword = req.query.password;
  if (!process.env.DASHBOARD_PASSWORD || suppliedPassword !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { action, sheet, rows, brand, pipeline } = req.query;
    const body = { secret: process.env.APPS_SCRIPT_SECRET, action };
    if (sheet) body.sheet = sheet;
    if (rows) body.rows = JSON.parse(rows);
    if (brand) body.brand = JSON.parse(brand);
    if (pipeline) body.pipeline = JSON.parse(pipeline);

    const response = await fetch(process.env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "follow",
    });
    const data = await response.json();
    if (data.error) {
      res.status(400).json(data);
      return;
    }
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Write failed" });
  }
};
