const SECRET = '__SECRET__';
/**
 * Brand Research – MASTER bridge (bound to the "set-up-master" Google Sheet).
 *
 * Owns users, roles, per-user workspaces and platform settings. The web app's
 * server (never the browser) calls this with the shared secret.
 * Deploy: Extensions → Apps Script → paste → Deploy → New deployment → Web app
 *   Execute as: Me · Who has access: Anyone → copy the /exec URL.
 */
const TABS = {
  Users: ['Email','Name','Role','Password Hash','Salt','Status','Created At','Last Login','Workspace ID','Must Change Password','Notes'],
  Workspaces: ['Workspace ID','Owner Email','Workspace Name','Data Sheet URL','Bridge URL','Bridge Secret','Gemini API Key','Gemini Model','Web App URL','Company Name','Status','Updated At'],
  Roles: ['Role','Allowed Pages','Can Administer','Description'],
  'Platform Settings': ['Key','Value','Description'],
  'Audit Log': ['Timestamp','Actor','Action','Target','Details'],
};
const SECRET_COLS = ['Bridge Secret', 'Gemini API Key'];
const MASK = '••••';

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents || '{}');
    if (!SECRET || SECRET === '__' + 'SECRET__' || b.secret !== SECRET) return out({ error: 'Unauthorized' });
    ensureTabs();
    const fn = ACTIONS[b.action];
    if (!fn) return out({ error: 'Unknown action: ' + b.action });
    return out(fn(b));
  } catch (err) { return out({ error: String(err && err.message || err) }); }
}
function doGet() { return out({ ok: true, service: 'brand-research-master' }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- sheet helpers ---------- */
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function ensureTabs() {
  Object.keys(TABS).forEach(function (n) {
    let sh = ss().getSheetByName(n);
    if (!sh) sh = ss().insertSheet(n);
    if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, TABS[n].length).setValues([TABS[n]]).setFontWeight('bold'); sh.setFrozenRows(1); }
  });
}
function table(name) {
  const sh = ss().getSheetByName(name), v = sh.getDataRange().getValues();
  const head = v[0].map(String);
  const rows = v.slice(1).map(function (r, i) { const o = { _row: i + 2 }; head.forEach(function (h, j) { o[h] = r[j] === undefined ? '' : r[j]; }); return o; })
    .filter(function (o) { return head.some(function (h) { return o[h] !== ''; }); });
  return { sh: sh, head: head, rows: rows };
}
function today() { return Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'); }
function now() { return new Date().toISOString(); }
function norm(s) { return String(s || '').trim().toLowerCase(); }
function writeRow(t, rowNum, obj) {
  const vals = t.head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  if (rowNum) t.sh.getRange(rowNum, 1, 1, vals.length).setValues([vals]); else t.sh.appendRow(vals);
}
function log(actor, action, target, details) { try { ss().getSheetByName('Audit Log').appendRow([now(), actor || '', action, target || '', details || '']); } catch (e) {} }

/* ---------- passwords ---------- */
function hex(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function hashPw(salt, pw) { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8)); }
function newSalt() { return Utilities.getUuid().replace(/-/g, ''); }
function safeEq(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

function roleInfo(role) {
  const r = table('Roles').rows.filter(function (x) { return norm(x.Role) === norm(role); })[0];
  return r ? { role: r.Role, pages: String(r['Allowed Pages']).split(',').map(function (s) { return s.trim(); }).filter(Boolean), admin: norm(r['Can Administer']) === 'yes' } : { role: role, pages: [], admin: false };
}
function publicUser(u) {
  const ri = roleInfo(u.Role);
  return { email: u.Email, name: u.Name, role: u.Role, status: u.Status, pages: ri.pages, isAdmin: ri.admin, workspaceId: u['Workspace ID'], mustChange: norm(u['Must Change Password']) === 'yes', lastLogin: u['Last Login'], created: u['Created At'], notes: u.Notes };
}
function findUser(email) { return table('Users').rows.filter(function (u) { return norm(u.Email) === norm(email); })[0]; }
function maskWs(w) {
  const o = {}; Object.keys(w).forEach(function (k) { if (k === '_row') return; o[k] = w[k]; });
  SECRET_COLS.forEach(function (c) { const v = String(w[c] || ''); o[c] = v ? MASK + v.slice(-4) : ''; });
  return o;
}

/* ---------- actions ---------- */
const ACTIONS = {
  ping: function () { ensureTabs(); return { ok: true, sheet: ss().getName(), url: ss().getUrl(), users: table('Users').rows.length }; },

  login: function (b) {
    const email = norm(b.email), cache = CacheService.getScriptCache(), key = 'fail:' + email;
    if (Number(cache.get(key) || 0) >= 5) return { error: 'Too many attempts. Try again in 10 minutes.' };
    const u = findUser(email);
    const ok = u && u['Password Hash'] && safeEq(hashPw(String(u.Salt), String(b.password || '')), u['Password Hash']);
    if (!ok) { cache.put(key, String(Number(cache.get(key) || 0) + 1), 600); log(email, 'login-failed', email, ''); return { error: 'Incorrect email or password.' }; }
    if (norm(u.Status) !== 'active') return { error: 'This account is disabled. Contact your administrator.' };
    cache.remove(key);
    const t = table('Users'); u['Last Login'] = now(); writeRow(t, u._row, u);
    log(email, 'login', email, '');
    return { user: publicUser(u) };
  },

  getUser: function (b) { const u = findUser(b.email); if (!u || norm(u.Status) !== 'active') return { error: 'Unauthorized' }; return { user: publicUser(u) }; },

  getWorkspace: function (b) {
    const u = findUser(b.email); if (!u) return { error: 'Unknown user' };
    const w = table('Workspaces').rows.filter(function (x) { return norm(x['Workspace ID']) === norm(u['Workspace ID']) || norm(x['Owner Email']) === norm(u.Email); })[0];
    if (!w) return { workspace: null };
    const o = {}; Object.keys(w).forEach(function (k) { if (k !== '_row') o[k] = w[k]; });
    return { workspace: o };
  },

  saveMyWorkspace: function (b) {
    const u = findUser(b.email); if (!u) return { error: 'Unknown user' };
    const allowed = ['Workspace Name','Data Sheet URL','Bridge URL','Bridge Secret','Gemini API Key','Gemini Model','Web App URL','Company Name'];
    const t = table('Workspaces');
    let w = t.rows.filter(function (x) { return norm(x['Owner Email']) === norm(u.Email); })[0];
    if (!w) { w = { 'Workspace ID': u['Workspace ID'] || ('ws-' + newSalt().slice(0, 8)), 'Owner Email': u.Email, Status: 'active' }; }
    allowed.forEach(function (k) { if (b.fields && b.fields[k] !== undefined && String(b.fields[k]).indexOf(MASK) !== 0) w[k] = b.fields[k]; });
    w['Updated At'] = today(); writeRow(t, w._row, w);
    if (!u['Workspace ID']) { const ut = table('Users'); u['Workspace ID'] = w['Workspace ID']; writeRow(ut, u._row, u); }
    log(u.Email, 'save-workspace', w['Workspace ID'], Object.keys(b.fields || {}).join(','));
    return { ok: true };
  },

  changePassword: function (b) {
    const u = findUser(b.email); if (!u) return { error: 'Unknown user' };
    if (!safeEq(hashPw(String(u.Salt), String(b.current || '')), u['Password Hash'])) return { error: 'Current password is incorrect.' };
    if (String(b.next || '').length < 8) return { error: 'New password must be at least 8 characters.' };
    const t = table('Users'); u.Salt = newSalt(); u['Password Hash'] = hashPw(u.Salt, b.next); u['Must Change Password'] = 'no'; writeRow(t, u._row, u);
    log(u.Email, 'change-password', u.Email, ''); return { ok: true };
  },

  /* ----- admin ----- */
  listUsers: function () { return { users: table('Users').rows.map(publicUser) }; },

  upsertUser: function (b) {
    const f = b.user || {}, email = norm(f.email); if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { error: 'A valid email is required.' };
    if (!roleInfo(f.role).pages.length && norm(f.role) !== 'admin') return { error: 'Unknown role: ' + f.role };
    const t = table('Users'); let u = findUser(email); const isNew = !u;
    if (isNew) { if (String(f.password || '').length < 8) return { error: 'A password of at least 8 characters is required for a new user.' }; u = { Email: email, 'Created At': today(), Status: 'active', 'Workspace ID': 'ws-' + newSalt().slice(0, 8) }; }
    if (f.name !== undefined) u.Name = f.name; if (f.role) u.Role = f.role; if (f.status) u.Status = f.status; if (f.notes !== undefined) u.Notes = f.notes;
    if (f.mustChange !== undefined) u['Must Change Password'] = f.mustChange ? 'yes' : 'no';
    if (f.password) { if (String(f.password).length < 8) return { error: 'Password must be at least 8 characters.' }; u.Salt = newSalt(); u['Password Hash'] = hashPw(u.Salt, f.password); }
    // never leave the platform without an active administrator
    const admins = t.rows.filter(function (x) { return norm(x.Email) !== email && norm(x.Status) === 'active' && roleInfo(x.Role).admin; });
    if (!admins.length && !(norm(u.Status) === 'active' && roleInfo(u.Role).admin)) return { error: 'At least one active administrator must remain.' };
    writeRow(t, u._row, u);
    if (isNew) { const wt = table('Workspaces'); writeRow(wt, 0, { 'Workspace ID': u['Workspace ID'], 'Owner Email': email, 'Workspace Name': (f.name || email) + ' workspace', 'Gemini Model': 'gemini-2.5-flash', Status: 'active', 'Updated At': today() }); }
    log(b.actor, isNew ? 'create-user' : 'update-user', email, f.role || ''); return { ok: true, created: isNew };
  },

  deleteUser: function (b) {
    const email = norm(b.email), u = findUser(email); if (!u) return { error: 'User not found.' };
    if (norm(b.actor) === email) return { error: 'You cannot delete your own account.' };
    const t = table('Users');
    const admins = t.rows.filter(function (x) { return norm(x.Email) !== email && norm(x.Status) === 'active' && roleInfo(x.Role).admin; });
    if (!admins.length) return { error: 'At least one active administrator must remain.' };
    t.sh.deleteRow(u._row);
    if (b.deleteWorkspace) { const wt = table('Workspaces'); wt.rows.filter(function (w) { return norm(w['Owner Email']) === email; }).reverse().forEach(function (w) { wt.sh.deleteRow(w._row); }); }
    log(b.actor, 'delete-user', email, b.deleteWorkspace ? 'with workspace' : ''); return { ok: true };
  },

  listWorkspaces: function () { return { workspaces: table('Workspaces').rows.map(maskWs) }; },

  upsertWorkspace: function (b) {
    const f = b.workspace || {}, id = String(f['Workspace ID'] || ''); if (!id) return { error: 'Workspace ID is required.' };
    const t = table('Workspaces'); let w = t.rows.filter(function (x) { return norm(x['Workspace ID']) === norm(id); })[0] || { 'Workspace ID': id, Status: 'active' };
    t.head.forEach(function (h) { if (h === 'Workspace ID' || f[h] === undefined) return; if (SECRET_COLS.indexOf(h) >= 0 && String(f[h]).indexOf(MASK) === 0) return; w[h] = f[h]; });
    w['Updated At'] = today(); writeRow(t, w._row, w); log(b.actor, 'update-workspace', id, ''); return { ok: true };
  },

  deleteWorkspace: function (b) {
    const t = table('Workspaces'), w = t.rows.filter(function (x) { return norm(x['Workspace ID']) === norm(b.id); })[0]; if (!w) return { error: 'Workspace not found.' };
    t.sh.deleteRow(w._row); log(b.actor, 'delete-workspace', b.id, ''); return { ok: true };
  },

  listRoles: function () { return { roles: table('Roles').rows.map(function (r) { return { role: r.Role, pages: r['Allowed Pages'], canAdminister: r['Can Administer'], description: r.Description }; }) }; },

  upsertRole: function (b) {
    const f = b.role || {}, name = norm(f.role); if (!name) return { error: 'Role name is required.' };
    const t = table('Roles'); let r = t.rows.filter(function (x) { return norm(x.Role) === name; })[0] || { Role: name };
    if (name === 'admin') { f.canAdminister = 'yes'; }
    if (f.pages !== undefined) r['Allowed Pages'] = f.pages; if (f.canAdminister !== undefined) r['Can Administer'] = f.canAdminister; if (f.description !== undefined) r.Description = f.description;
    writeRow(t, r._row, r); log(b.actor, 'update-role', name, ''); return { ok: true };
  },

  deleteRole: function (b) {
    const name = norm(b.role); if (name === 'admin' || name === 'user') return { error: 'Built-in roles cannot be deleted.' };
    if (table('Users').rows.some(function (u) { return norm(u.Role) === name; })) return { error: 'Role is still assigned to users.' };
    const t = table('Roles'), r = t.rows.filter(function (x) { return norm(x.Role) === name; })[0]; if (!r) return { error: 'Role not found.' };
    t.sh.deleteRow(r._row); log(b.actor, 'delete-role', name, ''); return { ok: true };
  },

  getSettings: function () { const o = {}; table('Platform Settings').rows.forEach(function (r) { o[r.Key] = r.Value; }); return { settings: o }; },
  saveSettings: function (b) {
    const t = table('Platform Settings');
    Object.keys(b.pairs || {}).forEach(function (k) { const r = t.rows.filter(function (x) { return x.Key === k; })[0] || { Key: k }; r.Value = b.pairs[k]; writeRow(t, r._row, r); });
    log(b.actor, 'save-settings', '', Object.keys(b.pairs || {}).join(',')); return { ok: true };
  },
  auditLog: function (b) { const rows = table('Audit Log').rows; return { log: rows.slice(-(b.limit || 100)).reverse().map(function (r) { return { time: r.Timestamp, actor: r.Actor, action: r.Action, target: r.Target, details: r.Details }; }) }; },
};
