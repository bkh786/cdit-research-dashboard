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
    const { action, sheet, settings } = req.body || {};
    const previousSenderName = req.body?.previousSenderName || settings?.previousSenderName;
    const previousCompanyName = req.body?.previousCompanyName || settings?.previousCompanyName;
    const previousSenderEmail = req.body?.previousSenderEmail || settings?.previousSenderEmail;

    // Special handler to accommodate the 'Email Settings' tab with the exact 7 sheet columns
    if (sheet === "Email Settings" || action === "saveEmailSettings") {
      const src = settings || req.body.row || (Array.isArray(req.body.rows) ? req.body.rows[0] : null) || req.body;
      const normalizedRow = {
        "Sender Name": String(src["Sender Name"] ?? src.senderName ?? "Bikash Roy").trim(),
        "Sender Designation": String(src["Sender Designation"] ?? src.senderDesignation ?? "Business Manager - Consumer Electronics").trim(),
        "Company Name": String(src["Company Name"] ?? src.companyName ?? src.senderCompany ?? "Channelplay Limited").trim(),
        "Sender Email": String(src["Sender Email"] ?? src.senderEmail ?? "bikash.roy1@channelplay.in").trim(),
        "Default CC": String(src["Default CC"] ?? src.defaultCc ?? "bikash.roy1@channelplay.in").trim(),
        "Phone Number": String(src["Phone Number"] ?? src.phoneNumber ?? src.senderPhone ?? "+91 8509950431").trim(),
        "Company Website": String(src["Company Website"] ?? src.companyWebsite ?? "https://www.channelplay.in").trim(),
      };

      const clientHasExistingRow = req.body?.hasExistingRow === true;

      // 1. Try updateRow ONLY if client confirmed an existing data row exists in the sheet
      if (clientHasExistingRow) {
        const matchCandidates = [
          { col: "Sender Name", val: previousSenderName || normalizedRow["Sender Name"] },
          { col: "Company Name", val: previousCompanyName || normalizedRow["Company Name"] },
          { col: "Sender Email", val: previousSenderEmail || normalizedRow["Sender Email"] },
          { col: "Company Website", val: normalizedRow["Company Website"] }
        ].filter(c => !!c.val);

        for (const candidate of matchCandidates) {
          try {
            const updateResp = await fetch(process.env.APPS_SCRIPT_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                secret: process.env.APPS_SCRIPT_SECRET,
                action: "updateRow",
                sheet: "Email Settings",
                matchColumn: candidate.col,
                matchValue: candidate.val,
                updates: normalizedRow
              }),
              redirect: "follow",
            });
            const updateData = await updateResp.json();
            // ONLY treat as updated if updateData explicitly confirms rows were updated!
            if (updateData && !updateData.error && (updateData.updated === true || updateData.updated > 0 || updateData.rowsUpdated > 0)) {
              res.status(200).json({ ok: true, action: "updateRow", updated: true, row: normalizedRow, data: updateData });
              return;
            }
          } catch (_) {
            // continue to next candidate
          }
        }
      }

      // 2. If row was empty (like in Screenshot 1 where clientHasExistingRow is false) or updateRow matched 0 rows, append the record!
      const appendResp = await fetch(process.env.APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.APPS_SCRIPT_SECRET,
          action: "appendRows",
          sheet: "Email Settings",
          rows: [normalizedRow]
        }),
        redirect: "follow",
      });
      const appendData = await appendResp.json();
      if (appendData.error) {
        res.status(400).json(appendData);
        return;
      }
      res.status(200).json({ ok: true, action: "appendRows", row: normalizedRow, data: appendData });
      return;
    }

    // Default passthrough for all other sheets/actions
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
