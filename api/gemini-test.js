// Tiny connectivity check used by Setup → "Test Gemini".
const { authorize, workspace, gemini, handle } = require("./_lib/common");

module.exports = handle(async (req, res) => {
  if (!(await authorize(req, res))) return;
  const ws = await workspace(req);
  const out = await gemini(ws, 'Reply with exactly this JSON and nothing else: {"ok": true}', { search: false, temperature: 0, maxOutputTokens: 40 });
  res.status(200).json({ ok: true, model: out.model });
});
