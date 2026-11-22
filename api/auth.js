// Login / session / self-service endpoint (master mode).
// POST { action: "status" }                         -> { mode: "master" | "legacy" }
// POST { action: "login", email, password }         -> { token, user }
// POST { action: "me" }                             -> { user, workspace (secrets masked) }
// POST { action: "saveMyWorkspace", fields }        -> { ok }
// POST { action: "changePassword", current, next }  -> { ok }

const { masterMode, master, signToken, authorize, clearWsCache, handle } = require("./_lib/common");

const MASK = "••••";
const mask = (v) => (v ? MASK + String(v).slice(-4) : "");

module.exports = handle(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { action, ...b } = req.body || {};

  if (action === "status") return res.status(200).json({ mode: masterMode() ? "master" : "legacy" });
  if (!masterMode()) return res.status(400).json({ error: "Master sheet is not configured on this server." });

  if (action === "login") {
    const { user } = await master({ action: "login", email: b.email, password: b.password });
    const hours = Number(process.env.SESSION_HOURS || 12);
    return res.status(200).json({ token: signToken(user, hours), user });
  }

  if (!(await authorize(req, res))) return;

  if (action === "me") {
    const { workspace: w } = await master({ action: "getWorkspace", email: req.user.email });
    const ws = w || {};
    return res.status(200).json({
      user: req.user,
      workspace: {
        id: ws["Workspace ID"] || "",
        name: ws["Workspace Name"] || "",
        dataSheetUrl: ws["Data Sheet URL"] || "",
        bridgeUrl: ws["Bridge URL"] || "",
        bridgeSecret: mask(ws["Bridge Secret"]),
        geminiKey: mask(ws["Gemini API Key"]),
        geminiModel: ws["Gemini Model"] || "",
        webAppUrl: ws["Web App URL"] || "",
        companyName: ws["Company Name"] || "",
      },
    });
  }

  if (action === "saveMyWorkspace") {
    const f = b.fields || {};
    const map = { name: "Workspace Name", dataSheetUrl: "Data Sheet URL", bridgeUrl: "Bridge URL", bridgeSecret: "Bridge Secret", geminiKey: "Gemini API Key", geminiModel: "Gemini Model", webAppUrl: "Web App URL", companyName: "Company Name" };
    const fields = {};
    for (const [k, col] of Object.entries(map)) if (f[k] !== undefined) fields[col] = String(f[k]).trim();
    if (fields["Bridge URL"] && !/^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.\-_]+\/|macros\/)s\/[A-Za-z0-9_\-]+\/exec$/.test(fields["Bridge URL"])) {
      return res.status(400).json({ error: "Bridge URL must look like https://script.google.com/macros/s/…/exec" });
    }
    await master({ action: "saveMyWorkspace", email: req.user.email, fields });
    clearWsCache(req.user.email);
    return res.status(200).json({ ok: true });
  }

  if (action === "changePassword") {
    await master({ action: "changePassword", email: req.user.email, current: b.current, next: b.next });
    return res.status(200).json({ ok: true });
  }

  res.status(400).json({ error: "Unknown action" });
});
