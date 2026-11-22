// Write proxy: forwards dashboard writes to the workspace's Apps Script bridge,
// keeping the bridge secret out of any shared server logs / third parties.
//
// Actions: appendRows, addBrand, updateRow, upsertRow, deleteRows, createSheet,
//          setupSheets, ping, saveSettings

const { authorize, workspace, bridge, upsert, handle } = require("./_lib/common");

const ALLOWED = new Set([
  "appendRows", "addBrand", "updateRow", "upsertRow", "deleteRows", "createSheet",
  "setupSheets", "ping", "saveSettings",
]);

module.exports = handle(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!authorize(req, res)) return;
  const ws = workspace(req);

  const { action, ...rest } = req.body || {};
  if (!ALLOWED.has(action)) return res.status(400).json({ error: `Unsupported action: ${action}` });

  // Older bridges don't know "saveSettings": emulate it with upserts.
  if (action === "saveSettings") {
    try {
      const out = await bridge(ws, { action, ...rest });
      return res.status(200).json(out);
    } catch (err) {
      if (!/unknown action/i.test(err.message)) throw err;
      for (const [k, v] of Object.entries(rest.pairs || {})) {
        await upsert(ws, "Workspace Settings", "Key", k, { Value: v });
      }
      return res.status(200).json({ ok: true, saved: Object.keys(rest.pairs || {}).length, legacy: true });
    }
  }

  if (action === "upsertRow") {
    return res.status(200).json(await upsert(ws, rest.sheet, rest.matchColumn, rest.matchValue, rest.updates));
  }

  res.status(200).json(await bridge(ws, { action, ...rest }));
});
