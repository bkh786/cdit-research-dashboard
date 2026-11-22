// GET-based write endpoint for the automated daily research task, whose fetch
// tool can only issue plain GET requests. Forwards to the server-default bridge
// (APPS_SCRIPT_URL / APPS_SCRIPT_SECRET) — i.e. the owner's workspace.
//
//   ?password=…&action=appendRows&sheet=News+feed&rows=<JSON array>[&dedupeOn=<JSON array>]
//   ?password=…&action=addBrand&brand=<JSON>&pipeline=<JSON>
//   ?password=…&action=updateRow&sheet=Pipeline&matchColumn=Brand&matchValue=Haier&updates=<JSON>
//   ?password=…&action=createSheet&sheet=Competitor+Watch&headers=<JSON array>

const { authorize, workspace, bridge, handle } = require("./_lib/common");

module.exports = handle(async (req, res) => {
  if (!authorize(req, res)) return;
  const ws = workspace(req);
  const { action, sheet, rows, brand, pipeline, matchColumn, matchValue, updates, headers, dedupeOn } = req.query;
  const body = { action };
  if (sheet) body.sheet = sheet;
  if (rows) body.rows = JSON.parse(rows);
  if (brand) body.brand = JSON.parse(brand);
  if (pipeline) body.pipeline = JSON.parse(pipeline);
  if (matchColumn) body.matchColumn = matchColumn;
  if (matchValue) body.matchValue = matchValue;
  if (updates) body.updates = JSON.parse(updates);
  if (headers) body.headers = JSON.parse(headers);
  if (dedupeOn) body.dedupeOn = JSON.parse(dedupeOn);
  res.status(200).json(await bridge(ws, body));
});
