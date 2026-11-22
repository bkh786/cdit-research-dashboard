/* ==========================================================================
   Administration (master sheet): users, workspaces, roles, platform settings,
   audit log — plus the account / change-password dialog for every user.
   Only reachable when signed in through the master sheet as an administrator.
   ========================================================================== */
"use strict";

const ADM = { tab: "users", users: [], workspaces: [], roles: [], settings: {}, log: [], error: "" };
const ADMIN_TABS = [["users", "Users"], ["workspaces", "Workspaces"], ["roles", "Roles & pages"], ["settings", "Platform"], ["log", "Audit log"]];
const ALL_PAGES = ["overview", "signals", "opportunities", "contacts", "pipeline", "competitors", "add-brand", "setup", "settings", "admin"];
const adm = (action, payload) => api("/api/admin", { action, ...payload });

async function renderAdmin() {
  const C = $("#content");
  if (!(AUTH.mode === "master" && AUTH.user && AUTH.user.isAdmin)) {
    C.innerHTML = `<div class="page-head"><div><div class="eyebrow">Administration</div><h1>Administrators only</h1><p>${AUTH.mode === "master" ? "Your role does not include this page." : "Sign-in through the master sheet is not enabled on this deployment (set MASTER_BRIDGE_URL, MASTER_BRIDGE_SECRET and SESSION_SECRET)."}</p></div></div>`;
    return;
  }
  C.innerHTML = `<div class="page-head"><div><div class="eyebrow">Administration</div><h1>Users, workspaces &amp; access</h1><p>Everything here is stored in the <b>set-up-master</b> Google Sheet. Roles decide which pages each person sees.</p></div></div>
    <div class="seg" style="margin-bottom:16px">${ADMIN_TABS.map(([id, l]) => `<button data-act="adm-tab" data-v="${id}" class="${ADM.tab === id ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="admBody"><div class="muted">Loading…</div></div>`;
  await admLoad();
}

async function admLoad() {
  const body = $("#admBody"); if (!body) return;
  try {
    ADM.error = "";
    if (ADM.tab === "users") { const [u, r] = await Promise.all([adm("listUsers"), adm("listRoles")]); ADM.users = u.users; ADM.roles = r.roles; }
    if (ADM.tab === "workspaces") ADM.workspaces = (await adm("listWorkspaces")).workspaces;
    if (ADM.tab === "roles") ADM.roles = (await adm("listRoles")).roles;
    if (ADM.tab === "settings") ADM.settings = (await adm("getSettings")).settings;
    if (ADM.tab === "log") ADM.log = (await adm("auditLog", { limit: 150 })).log;
  } catch (e) { ADM.error = e.message; }
  if (ADM.error) { body.innerHTML = `<div class="note warn">${ic("warn", 18)}<div>${esc(ADM.error)}</div></div>`; return; }
  body.innerHTML = { users: admUsersHtml, workspaces: admWorkspacesHtml, roles: admRolesHtml, settings: admSettingsHtml, log: admLogHtml }[ADM.tab]();
}

function admUsersHtml() {
  return `<div class="row" style="margin-bottom:12px"><button class="btn" data-act="adm-user">${ic("plus", 14)}Add user</button></div>
  <div class="card table-wrap"><table class="t"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Workspace</th><th>Last login</th><th></th></tr></thead><tbody>
  ${ADM.users.map((u) => `<tr><td><b>${esc(u.name || "—")}</b><div class="muted">${esc(u.email)}</div></td>
    <td><span class="pill ${u.isAdmin ? "acc" : ""}">${esc(u.role)}</span></td>
    <td><span class="pill ${u.status === "active" ? "good" : "bad"}">${esc(u.status)}</span></td>
    <td class="muted">${esc(u.workspaceId || "—")}</td><td class="muted">${esc(String(u.lastLogin || "—").slice(0, 16).replace("T", " "))}</td>
    <td style="white-space:nowrap"><button class="btn sm ghost" data-act="adm-user" data-email="${attr(u.email)}">Edit</button> <button class="btn sm danger" data-act="adm-del-user" data-email="${attr(u.email)}">Delete</button></td></tr>`).join("")}
  </tbody></table></div>`;
}

const WS_FIELDS = [["Workspace Name", "Workspace name"], ["Owner Email", "Owner email", true], ["Company Name", "Company"], ["Data Sheet URL", "Data Google Sheet link"], ["Bridge URL", "Bridge script URL (/exec)"], ["Bridge Secret", "Bridge secret", false, true], ["Gemini API Key", "Gemini API key", false, true], ["Gemini Model", "Gemini model"], ["Web App URL", "Web-app URL"], ["Status", "Status"]];

function admWorkspacesHtml() {
  return `<div class="card table-wrap"><table class="t"><thead><tr><th>Workspace</th><th>Owner</th><th>Sheet</th><th>Bridge</th><th>Gemini</th><th>Web app</th><th></th></tr></thead><tbody>
  ${ADM.workspaces.map((w) => `<tr><td><b>${esc(w["Workspace Name"] || w["Workspace ID"])}</b><div class="muted">${esc(w["Workspace ID"])}</div></td><td>${esc(w["Owner Email"])}</td>
    <td>${w["Data Sheet URL"] ? `<a href="${attr(w["Data Sheet URL"])}" target="_blank" rel="noopener">Open</a>` : '<span class="muted">—</span>'}</td>
    <td>${w["Bridge URL"] ? '<span class="pill good">connected</span>' : '<span class="pill warn">not set</span>'}</td>
    <td>${w["Gemini API Key"] ? '<span class="pill good">key saved</span>' : '<span class="pill">server default</span>'}</td>
    <td>${w["Web App URL"] ? `<a href="${attr(w["Web App URL"])}" target="_blank" rel="noopener">Open</a>` : '<span class="muted">—</span>'}</td>
    <td style="white-space:nowrap"><button class="btn sm ghost" data-act="adm-ws" data-id="${attr(w["Workspace ID"])}">Edit</button> <button class="btn sm danger" data-act="adm-del-ws" data-id="${attr(w["Workspace ID"])}">Delete</button></td></tr>`).join("")}
  </tbody></table></div><p class="muted" style="margin-top:10px">Secrets are masked here; leave a masked field untouched to keep the stored value.</p>`;
}

function admRolesHtml() {
  return `<div class="row" style="margin-bottom:12px"><button class="btn" data-act="adm-role">${ic("plus", 14)}Add role</button></div>
  <div class="card table-wrap"><table class="t"><thead><tr><th>Role</th><th>Pages</th><th>Admin</th><th>Description</th><th></th></tr></thead><tbody>
  ${ADM.roles.map((r) => `<tr><td><b>${esc(r.role)}</b></td><td class="muted" style="max-width:380px">${esc(r.pages)}</td><td>${r.canAdminister === "yes" ? '<span class="pill acc">yes</span>' : "no"}</td><td class="muted">${esc(r.description)}</td>
    <td style="white-space:nowrap"><button class="btn sm ghost" data-act="adm-role" data-role="${attr(r.role)}">Edit</button> ${["admin", "user"].includes(r.role) ? "" : `<button class="btn sm danger" data-act="adm-del-role" data-role="${attr(r.role)}">Delete</button>`}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function admSettingsHtml() {
  const s = ADM.settings;
  return `<div class="card pad" style="max-width:560px"><div class="field"><label>App name</label><input class="input" id="stName" value="${attr(s["app.name"] || "")}"></div>
  <div class="field"><label>Public web-app URL</label><input class="input mono" id="stUrl" value="${attr(s["app.url"] || "")}"></div>
  <div class="field"><label>Session length (hours)</label><input class="input" id="stHours" value="${attr(s["session.hours"] || "12")}"><span class="hint">Informational — set SESSION_HOURS on the server to change it.</span></div>
  <button class="btn" data-act="adm-save-settings">Save</button></div>`;
}

function admLogHtml() {
  return `<div class="card table-wrap"><table class="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>
  ${ADM.log.map((l) => `<tr><td class="muted">${esc(String(l.time).slice(0, 19).replace("T", " "))}</td><td>${esc(l.actor)}</td><td>${esc(l.action)}</td><td>${esc(l.target)}</td><td class="muted">${esc(l.details)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">No entries.</td></tr>'}
  </tbody></table></div>`;
}

function genPassword() {
  const a = new Uint32Array(3); crypto.getRandomValues(a);
  return "Brand-" + [...a].map((n) => n.toString(36)).join("").slice(0, 10) + "!";
}

async function admBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, "err", 6000); } finally { btn.disabled = false; }
}

Object.assign(ACT, {
  "adm-tab": (t) => { ADM.tab = t.dataset.v; renderAdmin(); },

  "adm-user": (t) => {
    const u = ADM.users.find((x) => x.email === t.dataset.email) || null;
    const o = modal(`<h2>${u ? "Edit user" : "Add user"}</h2><p class="lead">${u ? esc(u.email) : "Creates the login and an empty workspace for the person."}</p>
      <div class="fgrid"><div class="field"><label>Email</label><input class="input" id="auEmail" value="${attr(u ? u.email : "")}" ${u ? "disabled" : ""}></div>
      <div class="field"><label>Name</label><input class="input" id="auName" value="${attr(u ? u.name : "")}"></div>
      <div class="field"><label>Role</label><select class="input" id="auRole">${ADM.roles.map((r) => `<option ${(u ? u.role : "user") === r.role ? "selected" : ""}>${esc(r.role)}</option>`).join("")}</select></div>
      <div class="field"><label>Status</label><select class="input" id="auStatus"><option ${!u || u.status === "active" ? "selected" : ""}>active</option><option ${u && u.status !== "active" ? "selected" : ""}>disabled</option></select></div></div>
      <div class="field"><label>${u ? "New password (leave blank to keep)" : "Password"}</label><div class="row"><input class="input mono" id="auPw" autocomplete="new-password" placeholder="min 8 characters"><button class="btn sm ghost" type="button" id="auGen">Generate</button></div></div>
      <label class="row" style="gap:8px"><input type="checkbox" id="auMust" ${u ? (u.mustChange ? "checked" : "") : "checked"}> Ask the user to change the password at next login</label>
      <div class="modal-actions"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn" id="auSave">Save</button></div>`);
    $("#auGen", o).onclick = () => { $("#auPw", o).value = genPassword(); };
    $("#auSave", o).onclick = (e) => admBusy(e.target, async () => {
      const user = { email: $("#auEmail", o).value.trim(), name: $("#auName", o).value.trim(), role: $("#auRole", o).value, status: $("#auStatus", o).value, mustChange: $("#auMust", o).checked };
      const pw = $("#auPw", o).value; if (pw) user.password = pw;
      await adm("upsertUser", { user });
      o.remove(); toast(pw && !u ? `User created. Share the password securely: ${pw}` : "User saved", "ok", pw && !u ? 12000 : 4200); admLoad();
    });
  },
  "adm-del-user": async (t) => {
    if (!confirm(`Delete ${t.dataset.email}? This removes their login. Their workspace is kept unless you confirm the next prompt.`)) return;
    const withWs = confirm("Also delete their workspace row (sheet link, bridge, Gemini key)?");
    try { await adm("deleteUser", { email: t.dataset.email, deleteWorkspace: withWs }); toast("User deleted"); admLoad(); } catch (e) { toast(e.message, "err", 6000); }
  },

  "adm-ws": (t) => {
    const w = ADM.workspaces.find((x) => x["Workspace ID"] === t.dataset.id); if (!w) return;
    const o = modal(`<h2>Edit workspace</h2><p class="lead">${esc(w["Workspace ID"])}</p>
      <div class="fgrid">${WS_FIELDS.map(([k, l, ro, sec]) => `<div class="field"><label>${l}</label><input class="input ${sec || /URL/.test(k) ? "mono" : ""}" data-k="${attr(k)}" value="${attr(w[k] || "")}" ${ro ? "disabled" : ""} ${sec ? 'autocomplete="off"' : ""}></div>`).join("")}</div>
      <div class="modal-actions"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn" id="awSave">Save</button></div>`, { wide: true });
    $("#awSave", o).onclick = (e) => admBusy(e.target, async () => {
      const workspace = { "Workspace ID": w["Workspace ID"] };
      $$("[data-k]", o).forEach((i) => { if (!i.disabled) workspace[i.dataset.k] = i.value.trim(); });
      await adm("upsertWorkspace", { workspace }); o.remove(); toast("Workspace saved"); admLoad();
    });
  },
  "adm-del-ws": async (t) => {
    if (!confirm(`Delete workspace ${t.dataset.id}? Its owner will have no sheet or Gemini key until reconfigured.`)) return;
    try { await adm("deleteWorkspace", { id: t.dataset.id }); toast("Workspace deleted"); admLoad(); } catch (e) { toast(e.message, "err", 6000); }
  },

  "adm-role": (t) => {
    const r = ADM.roles.find((x) => x.role === t.dataset.role) || null;
    const have = new Set(String(r ? r.pages : "").split(",").map((s) => s.trim()).filter(Boolean));
    const o = modal(`<h2>${r ? "Edit role" : "Add role"}</h2>
      <div class="field"><label>Role name</label><input class="input" id="arName" value="${attr(r ? r.role : "")}" ${r ? "disabled" : ""}></div>
      <div class="field"><label>Pages this role can open</label><div class="row" style="flex-wrap:wrap;gap:10px 16px">${ALL_PAGES.map((p) => `<label class="row" style="gap:6px"><input type="checkbox" data-p="${p}" ${have.has(p) ? "checked" : ""}> ${p}</label>`).join("")}</div></div>
      <div class="field"><label>Description</label><input class="input" id="arDesc" value="${attr(r ? r.description : "")}"></div>
      <label class="row" style="gap:8px"><input type="checkbox" id="arAdm" ${r && r.canAdminister === "yes" ? "checked" : ""} ${r && r.role === "admin" ? "disabled" : ""}> Can administer (users, workspaces, roles)</label>
      <div class="modal-actions"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn" id="arSave">Save</button></div>`);
    $("#arSave", o).onclick = (e) => admBusy(e.target, async () => {
      const pages = $$("[data-p]", o).filter((i) => i.checked).map((i) => i.dataset.p).join(",");
      await adm("upsertRole", { role: { role: $("#arName", o).value.trim(), pages, description: $("#arDesc", o).value.trim(), canAdminister: $("#arAdm", o).checked ? "yes" : "no" } });
      o.remove(); toast("Role saved"); admLoad();
    });
  },
  "adm-del-role": async (t) => {
    if (!confirm(`Delete role “${t.dataset.role}”?`)) return;
    try { await adm("deleteRole", { role: t.dataset.role }); toast("Role deleted"); admLoad(); } catch (e) { toast(e.message, "err", 6000); }
  },

  "adm-save-settings": (t) => admBusy(t, async () => {
    await adm("saveSettings", { pairs: { "app.name": $("#stName").value.trim(), "app.url": $("#stUrl").value.trim(), "session.hours": $("#stHours").value.trim() } });
    toast("Platform settings saved");
  }),

  /* ---- account dialog (every signed-in user) ---- */
  "change-pw": () => {
    const u = AUTH.user; if (!u) return;
    const o = modal(`<h2>Your account</h2><p class="lead">${esc(u.name || u.email)} · ${esc(u.email)} · <span class="pill acc">${esc(u.role)}</span></p>
      <div class="field"><label>Current password</label><input class="input" type="password" id="cpCur" autocomplete="current-password"></div>
      <div class="field"><label>New password (min 8 characters)</label><input class="input" type="password" id="cpNew" autocomplete="new-password"></div>
      <div class="modal-actions"><button class="btn ghost" data-act="close-modal">Close</button><button class="btn" id="cpSave">Change password</button></div>`);
    $("#cpSave", o).onclick = (e) => admBusy(e.target, async () => {
      await api("/api/auth", { action: "changePassword", current: $("#cpCur", o).value, next: $("#cpNew", o).value });
      o.remove(); toast("Password changed");
    });
  },
});
