// Administrator API: users, workspaces, roles, platform settings, audit log.
// Every call requires a valid session whose user is an administrator in the master sheet.

const { master, requireAdmin, clearWsCache, handle } = require("./_lib/common");

const PASS = new Set([
  "listUsers", "upsertUser", "deleteUser",
  "listWorkspaces", "upsertWorkspace", "deleteWorkspace",
  "listRoles", "upsertRole", "deleteRole",
  "getSettings", "saveSettings", "auditLog", "ping",
]);

module.exports = handle(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAdmin(req, res))) return;
  const { action, ...rest } = req.body || {};
  if (!PASS.has(action)) return res.status(400).json({ error: `Unsupported action: ${action}` });
  const bu = action === "upsertWorkspace" && req.body.workspace && req.body.workspace["Bridge URL"];
  if (bu && !/^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.\-_]+\/|macros\/)s\/[A-Za-z0-9_\-]+\/exec$/.test(String(bu).trim())) {
    return res.status(400).json({ error: "Bridge URL must look like https://script.google.com/macros/s/…/exec" });
  }
  const out = await master({ action, ...rest, actor: req.user.email });
  if (/Workspace|User/.test(action) && !/^list/.test(action)) clearWsCache();
  res.status(200).json(out);
});
