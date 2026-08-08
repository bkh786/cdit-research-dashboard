// Vercel serverless function: proxies write requests to the Google Apps
// Script Web App bridge, so the Apps Script secret never reaches the browser.
//
// Required environment variables (in addition to the read-side ones):
//   APPS_SCRIPT_URL     - the /exec URL from your Apps Script deployment
//   APPS_SCRIPT_SECRET  - must match the WRITE_SECRET script property in Code.gs
//   DASHBOARD_PASSWORD  - same password gate as the read side
//
// Supported actions (forwarded as-is to Apps Script): appendRows, addBrand,
// updateRow, createSheet.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const suppliedPassword = req.headers["x-dashboard-password"];
  if (!process.env.DASHBOARD_PASSWORD || suppliedPassword !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const body = { ...req.body, secret: process.env.APPS_SCRIPT_SECRET };
    const response = await fetch(process.env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "follow", // Apps Script /exec URLs 302-redirect once before returning JSON
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
