/**
 * Brand Research & Insights — Google Sheets bridge (Apps Script Web App)
 * ---------------------------------------------------------------------
 * Paste this whole file into the Apps Script editor of YOUR Google Sheet
 * (Extensions → Apps Script), then Deploy → New deployment → Web app →
 * Execute as: Me · Who has access: Anyone → copy the /exec URL into the
 * dashboard (Setup → Connect).
 *
 * The dashboard fills in SECRET for you when you press "Copy bridge script".
 * Your sheet stays PRIVATE — nobody can read or write it without the secret.
 */
const SECRET = '__SECRET__';
const VERSION = '2.1.0';

/** Canonical tabs + headers. Edit here if you want extra columns. */
const SCHEMA = {
  'Brands Master':      ['Brand', 'Sector', 'Segment', 'Priority Tier', 'Website', 'HQ / India Office', 'Status Notes', 'Date Added'],
  'News feed':          ['Brand', 'Date', 'Headline', 'Category', 'AI Summary', 'Source', 'URL', 'Why It Matters'],
  'Opportunities':      ['Brand', 'Opportunity Type', 'Business Impact', 'Opportunity for Channelplay', 'Confidence Score (1-5)', 'Priority Score (1-5)', 'Recommended Service', 'Recommended Contact Department', 'Suggested Next Action', 'Linked News Ref'],
  'Contacts':           ['Brand', 'Decision Maker Name', 'Designation', 'Department', 'LinkedIn Profile', 'Official Email (public only)', 'Official Contact Number (public only)', 'Company Website', 'Office Location', 'Research Status'],
  'Pipeline':           ['Brand', 'Stage', 'Owner', 'Last Update', 'Next Follow-up Date', 'Notes'],
  'Email Drafts':       ['Brand', 'Linked Opportunity', 'Subject', 'Draft Body', 'Created At'],
  'Competitor Watch':   ['Competitor', 'Related Tracked Brand', 'Date', 'Category', 'Headline', 'Summary', 'Full Analysis', 'Source', 'URL'],
  'Email Settings':     ['Sender Name', 'Sender Designation', 'Company Name', 'Sender Email', 'Default CC', 'Phone Number', 'Company Website'],
  'Workspace Settings': ['Key', 'Value']
};

/** Alternative header spellings accepted when reading / writing existing sheets. */
const ALIASES = {
  'Decision Maker Name': ['Decision Maker', 'Name', 'Contact Name', 'Contact'],
  'Designation': ['Title/Role', 'Title', 'Role', 'Job Title'],
  'LinkedIn Profile': ['LinkedIn/Source URL', 'LinkedIn', 'LinkedIn URL'],
  'Official Email (public only)': ['Official Email', 'Email', 'Public Email'],
  'Official Contact Number (public only)': ['Public Desk Contact', 'Phone', 'Contact Number', 'Official Phone'],
  'Office Location': ['City/Hub', 'Location', 'City'],
  'Research Status': ['Verification Status / Notes', 'Verification Status', 'Notes'],
  'Company Website': ['Website', 'Domain']
};

const SEED_SETTINGS = [
  ['company.name', 'Channelplay Limited'],
  ['company.website', 'https://www.channelplay.in'],
  ['company.services', 'Visual Merchandising (VM)|Sales Force Outsourcing (SFO) / Promoter Management'],
  ['company.pitch', 'Retail execution partner: trained, tech-enabled promoters and pan-India visual merchandising with live visibility.'],
  ['target.sectors', 'Consumer Electronics|Consumer Durables|IT Hardware'],
  ['target.geography', 'India']
];

/* ----------------------------- entry points ----------------------------- */

function doGet() {
  return json_({ ok: true, service: 'Brand Research & Insights bridge', version: VERSION });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!SECRET || SECRET === '__' + 'SECRET__' || body.secret !== SECRET) return json_({ error: 'Unauthorized: secret mismatch' });
    // Network helpers do not touch the sheet, so they run outside the lock.
    if (body.action === 'resolveUrls') return json_(resolveUrls_(body.urls));
    if (body.action === 'checkPages')  return json_(checkPages_(body.urls, body.needles));
    if (body.action === 'fetchText')   return json_(fetchText_(body.urls, body.max));
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return json_(route_(body));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function route_(b) {
  switch (b.action) {
    case 'ping':         return ping_();
    case 'setupSheets':  return setupSheets_();
    case 'readAll':      return readAll_(b.sheets);
    case 'appendRows':   return appendRows_(b.sheet, b.rows, b.dedupeOn);
    case 'addBrand':     return addBrand_(b.brand, b.pipeline);
    case 'updateRow':    return updateRow_(b.sheet, b.matchColumn, b.matchValue, b.updates);
    case 'upsertRow':    return upsertRow_(b.sheet, b.matchColumn, b.matchValue, b.updates);
    case 'deleteRows':   return deleteRows_(b.sheet, b.matchColumn, b.matchValue);
    case 'createSheet':  return createSheet_(b.sheet, b.headers);
    case 'saveSettings': return saveSettings_(b.pairs);
    default: return { error: 'Unknown action: ' + b.action };
  }
}

/* -------------------------------- actions -------------------------------- */

function ping_() {
  const ss = SpreadsheetApp.getActive();
  const have = ss.getSheets().map(function (s) { return s.getName(); });
  const status = {};
  Object.keys(SCHEMA).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) { status[name] = { exists: false }; return; }
    const headers = headers_(sh);
    const missing = SCHEMA[name].filter(function (h) { return findHeader_(headers, h) < 0; });
    status[name] = { exists: true, rows: Math.max(0, sh.getLastRow() - 1), missingColumns: missing };
  });
  return { ok: true, version: VERSION, spreadsheet: ss.getName(), spreadsheetUrl: ss.getUrl(), tabs: have, status: status };
}

function setupSheets_() {
  const ss = SpreadsheetApp.getActive();
  const created = [], repaired = [], ok = [];
  Object.keys(SCHEMA).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      writeHeaders_(sh, SCHEMA[name]);
      created.push(name);
    } else if (sh.getLastRow() === 0 || headers_(sh).filter(String).length === 0) {
      writeHeaders_(sh, SCHEMA[name]);
      repaired.push(name);
    } else {
      ok.push(name);
    }
  });
  // Seed workspace settings once
  const ws = ss.getSheetByName('Workspace Settings');
  if (ws.getLastRow() <= 1) ws.getRange(2, 1, SEED_SETTINGS.length, 2).setValues(SEED_SETTINGS);
  // Remove the default empty "Sheet1" if we've just created everything else
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  return { ok: true, created: created, repaired: repaired, alreadyOk: ok };
}

function readAll_(wanted) {
  const ss = SpreadsheetApp.getActive();
  const names = (wanted && wanted.length) ? wanted : Object.keys(SCHEMA);
  const sheets = {}, headers = {};
  names.forEach(function (name) {
    const sh = findSheet_(ss, name);
    if (!sh) return;
    const values = sh.getDataRange().getDisplayValues();
    const h = (values[0] || []).map(String);
    headers[name] = h;
    sheets[name] = values.slice(1)
      .filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); })
      .map(function (r) {
        const o = {};
        h.forEach(function (col, i) { if (col) o[col] = r[i] === undefined ? '' : r[i]; });
        return o;
      });
  });
  return { ok: true, syncedAt: new Date().toISOString(), sheets: sheets, headers: headers, spreadsheet: ss.getName() };
}

function appendRows_(sheetName, rows, dedupeOn) {
  if (!sheetName || !rows || !rows.length) return { error: 'sheet and rows are required' };
  const sh = ensureSheet_(sheetName);
  let existing = [];
  if (dedupeOn && dedupeOn.length) existing = readObjects_(sh);
  let added = 0, skipped = 0;
  rows.forEach(function (row) {
    if (dedupeOn && dedupeOn.length) {
      const dup = existing.some(function (ex) {
        return dedupeOn.every(function (k) { return norm_(valueOf_(ex, k)) === norm_(row[k]); });
      });
      if (dup) { skipped++; return; }
    }
    appendObject_(sh, row);
    added++;
  });
  return { ok: true, added: added, skipped: skipped };
}

function addBrand_(brand, pipeline) {
  if (!brand || !brand['Brand']) return { error: 'brand.Brand is required' };
  const ss = SpreadsheetApp.getActive();
  const bm = ensureSheet_('Brands Master');
  const exists = readObjects_(bm).some(function (r) { return norm_(r['Brand']) === norm_(brand['Brand']); });
  let brandAdded = false, pipelineAdded = false;
  if (!exists) { appendObject_(bm, brand); brandAdded = true; }
  if (pipeline && pipeline['Brand']) {
    const pl = ensureSheet_('Pipeline');
    const inPl = readObjects_(pl).some(function (r) { return norm_(r['Brand']) === norm_(pipeline['Brand']); });
    if (!inPl) { appendObject_(pl, pipeline); pipelineAdded = true; }
  }
  return { ok: true, brandAdded: brandAdded, pipelineAdded: pipelineAdded, alreadyTracked: exists };
}

function updateRow_(sheetName, matchColumn, matchValue, updates) {
  const sh = findSheet_(SpreadsheetApp.getActive(), sheetName);
  if (!sh) return { error: 'Sheet not found: ' + sheetName };
  const headers = headers_(sh);
  const mc = findHeader_(headers, matchColumn);
  if (mc < 0) return { error: 'Match column not found: ' + matchColumn };
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, updated: 0 };
  const col = sh.getRange(2, mc + 1, last - 1, 1).getDisplayValues();
  let updated = 0;
  for (let i = 0; i < col.length; i++) {
    if (norm_(col[i][0]) !== norm_(matchValue)) continue;
    Object.keys(updates || {}).forEach(function (k) {
      let c = findHeader_(headers, k);
      if (c < 0) { c = addColumn_(sh, headers, k); }
      sh.getRange(i + 2, c + 1).setValue(updates[k]);
    });
    updated++;
  }
  return { ok: true, updated: updated };
}

function upsertRow_(sheetName, matchColumn, matchValue, updates) {
  const r = updateRow_(sheetName, matchColumn, matchValue, updates);
  if (r.error || r.updated > 0) return r;
  const row = {}; row[matchColumn] = matchValue;
  Object.keys(updates || {}).forEach(function (k) { row[k] = updates[k]; });
  appendObject_(ensureSheet_(sheetName), row);
  return { ok: true, updated: 0, inserted: 1 };
}

function deleteRows_(sheetName, matchColumn, matchValue) {
  const sh = findSheet_(SpreadsheetApp.getActive(), sheetName);
  if (!sh) return { error: 'Sheet not found: ' + sheetName };
  const mc = findHeader_(headers_(sh), matchColumn);
  if (mc < 0) return { error: 'Match column not found: ' + matchColumn };
  const last = sh.getLastRow();
  let deleted = 0;
  for (let r = last; r >= 2; r--) {
    if (norm_(sh.getRange(r, mc + 1).getDisplayValue()) === norm_(matchValue)) { sh.deleteRow(r); deleted++; }
  }
  return { ok: true, deleted: deleted };
}

function createSheet_(sheetName, headers) {
  const ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(sheetName)) return { ok: true, created: false };
  const sh = ss.insertSheet(sheetName);
  writeHeaders_(sh, headers && headers.length ? headers : (SCHEMA[sheetName] || ['Brand']));
  return { ok: true, created: true };
}

function saveSettings_(pairs) {
  if (!pairs) return { error: 'pairs required' };
  const sh = ensureSheet_('Workspace Settings');
  let n = 0;
  Object.keys(pairs).forEach(function (k) {
    upsertRow_('Workspace Settings', 'Key', k, { 'Value': pairs[k] });
    n++;
  });
  return { ok: true, saved: n };
}

/* --------------------------- web helpers (verification) --------------------------- */

const UA = 'Mozilla/5.0 (compatible; BrandResearchBot/1.0)';
function okUrl_(u) { return /^https?:\/\/[^\s]+$/i.test(String(u || '')); }
function fetchAllSafe_(urls, opts) {
  const list = (urls || []).filter(okUrl_).slice(0, 10);
  const reqs = list.map(function (u) { const o = { url: u, muteHttpExceptions: true, headers: { 'User-Agent': UA } }; Object.keys(opts || {}).forEach(function (k) { o[k] = opts[k]; }); return o; });
  let resps;
  try { resps = UrlFetchApp.fetchAll(reqs); }
  catch (e) { resps = reqs.map(function (r) { try { return UrlFetchApp.fetch(r.url, r); } catch (x) { return null; } }); }
  return list.map(function (u, i) { return { url: u, resp: resps[i] }; });
}
function textOf_(resp) {
  let t = ''; try { t = resp.getContentText(); } catch (e) {}
  t = t.slice(0, 900000);
  return t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&#64;|&commat;/g, '@').replace(/\s+/g, ' ');
}
/** Grounding links are redirect URLs — return where they really point. */
function resolveUrls_(urls) {
  const r = fetchAllSafe_(urls, { followRedirects: false });
  return { ok: true, urls: r.map(function (x) { let loc = ''; try { loc = x.resp.getHeaders()['Location'] || x.resp.getHeaders()['location'] || ''; } catch (e) {} return { url: x.url, resolved: loc || x.url }; }) };
}
function hasNeedle_(hay, n) {
  n = String(n || '').trim(); if (!n) return false;
  if (/^[+\d][\d\s\-().+]{6,}$/.test(n)) {
    const d = n.replace(/\D/g, '').slice(-10);
    return new RegExp(d.split('').join('[\\s\\-().]*')).test(hay);
  }
  return hay.toLowerCase().indexOf(n.toLowerCase()) >= 0;
}
/** For each URL: HTTP status and which needles (e-mail, phone, name…) literally appear on the page. */
function checkPages_(urls, needles) {
  const ns = (needles || []).slice(0, 6);
  const r = fetchAllSafe_(urls, { followRedirects: true });
  return { ok: true, results: r.map(function (x) {
    if (!x.resp) return { url: x.url, status: 0, found: ns.map(function () { return false; }) };
    const t = textOf_(x.resp);
    return { url: x.url, status: x.resp.getResponseCode(), found: ns.map(function (n) { return hasNeedle_(t, n); }) };
  }) };
}
function fetchText_(urls, max) {
  const r = fetchAllSafe_(urls, { followRedirects: true });
  return { ok: true, pages: r.filter(function (x) { return x.resp && x.resp.getResponseCode() < 400; }).map(function (x) { return { url: x.url, text: textOf_(x.resp).slice(0, max || 3000) }; }) };
}

/* -------------------------------- helpers -------------------------------- */

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function norm_(s) { return String(s === undefined || s === null ? '' : s).trim().toLowerCase(); }

function findSheet_(ss, name) {
  const exact = ss.getSheetByName(name);
  if (exact) return exact;
  const all = ss.getSheets();
  for (let i = 0; i < all.length; i++) if (norm_(all[i].getName()) === norm_(name)) return all[i];
  return null;
}

function ensureSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  let sh = findSheet_(ss, name);
  if (!sh) {
    sh = ss.insertSheet(name);
    writeHeaders_(sh, SCHEMA[name] || ['Brand']);
  } else if (sh.getLastRow() === 0) {
    writeHeaders_(sh, SCHEMA[name] || ['Brand']);
  }
  return sh;
}

function writeHeaders_(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidths(1, headers.length, 170);
}

function headers_(sh) {
  const lc = sh.getLastColumn();
  if (lc < 1) return [];
  return sh.getRange(1, 1, 1, lc).getDisplayValues()[0].map(String);
}

/** Index of header matching `key` (exact → case-insensitive → alias). -1 if none. */
function findHeader_(headers, key) {
  const k = norm_(key);
  for (let i = 0; i < headers.length; i++) if (norm_(headers[i]) === k) return i;
  const alts = ALIASES[key] || [];
  for (let a = 0; a < alts.length; a++) {
    for (let i = 0; i < headers.length; i++) if (norm_(headers[i]) === norm_(alts[a])) return i;
  }
  // reverse: `key` is itself an alias of a canonical header present in the sheet
  for (const canon in ALIASES) {
    if (ALIASES[canon].some(function (x) { return norm_(x) === k; })) {
      for (let i = 0; i < headers.length; i++) if (norm_(headers[i]) === norm_(canon)) return i;
    }
  }
  return -1;
}

function addColumn_(sh, headers, name) {
  const idx = headers.length;
  sh.getRange(1, idx + 1).setValue(name).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
  headers.push(name);
  return idx;
}

function valueOf_(rowObj, key) {
  if (rowObj[key] !== undefined) return rowObj[key];
  const alts = ALIASES[key] || [];
  for (let i = 0; i < alts.length; i++) if (rowObj[alts[i]] !== undefined) return rowObj[alts[i]];
  return '';
}

function readObjects_(sh) {
  const values = sh.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const h = values[0].map(String);
  return values.slice(1).map(function (r) {
    const o = {};
    h.forEach(function (c, i) { if (c) o[c] = r[i]; });
    return o;
  });
}

function appendObject_(sh, obj) {
  const headers = headers_(sh);
  const out = new Array(headers.length).fill('');
  Object.keys(obj).forEach(function (k) {
    let idx = findHeader_(headers, k);
    if (idx < 0) {
      idx = addColumn_(sh, headers, k);
      out.push('');
    }
    out[idx] = obj[k];
  });
  sh.appendRow(out);
}
