/* ==========================================================================
   Views: shell, router, Overview, Signals, Opportunities, Contacts,
   Pipeline, Competitors, shared modals
   ========================================================================== */
"use strict";

const ACT = {};
let view = "overview", viewArg = null;
const OV = { q: "", tier: "", stage: "", service: "", sort: "heat", mode: "grid", kpi: null };
const SG = { brand: "", cat: "", range: "90", q: "" };
const OP = { service: "", min: "1", q: "" };
const PL = { showClosed: false, owner: "" };
const NAV = [
  ["overview", "Overview", "home"], ["signals", "Signals", "radar"], ["opportunities", "Opportunities", "bolt"],
  ["contacts", "Contacts", "users"], ["pipeline", "Pipeline", "kanban"], ["competitors", "Competitor Watch", "eye"],
  ["add-brand", "Add brand", "plus"],
  ["setup", "Setup guide", "rocket"], ["autoresearch", "Auto-research", "clock"], ["settings", "Settings", "gear"], ["admin", "Administration", "users"],
];

/* ------------------------------- boot / auth ------------------------------- */
function boot() {
  applyTheme();
  $("#navToggle").innerHTML = ic("list", 18);
  $("#searchIcon").innerHTML = ic("search", 16);
  $("#refreshBtn").innerHTML = ic("refresh", 16);
  $("#themeBtn").innerHTML = ic("sun", 16);
  $("#lockBtn").innerHTML = ic("lock", 16);
  $("#userBtn").innerHTML = ic("gear", 16);
  $('[data-act="add-brand"]').innerHTML = `${ic("plus", 15)}<span>Add brand</span>`;
  $("#unlockBtn").addEventListener("click", unlock);
  $("#pwInput").addEventListener("keydown", (e) => e.key === "Enter" && unlock());
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", routeFromHash);
  initSearch();
  if (cfg.sidebarCollapsed) $("#app").classList.add("collapsed");
  $("#navToggle").addEventListener("click", () => {
    const app = $("#app");
    if (innerWidth <= 760) return app.classList.toggle("nav-open");
    app.classList.toggle("collapsed");
    cfg.sidebarCollapsed = app.classList.contains("collapsed"); saveCfg();
  });
  $("#emInput").addEventListener("keydown", (e) => e.key === "Enter" && $("#pwInput").focus());
  // ?master=<web-app url> lets an administrator point this browser at the platform once
  try { const m = new URLSearchParams(location.search).get("master"); if (m && BRIDGE_RE.test(m)) { localStorage.setItem("bri.masterUrl", m); history.replaceState(null, "", location.pathname + location.hash); } } catch (_) {}
  AUTH.mode = masterUrl() ? "master" : "local";
  if (AUTH.mode === "master") {
    $("#emInput").focus();
    if (tokStore.get()) startMaster().catch(() => { tokStore.clear(); $("#gate").classList.remove("hidden"); });
  } else {
    // personal mode: no platform configured — everything stays in this browser + your own sheet
    $("#lockBtn").classList.add("hidden");
    start().catch((e) => toast(e.message, "err"));
  }
}

async function startMaster() {
  await hydrateFromMaster();
  await afterLogin();
}
async function afterLogin() {
  try { if (localStorage.getItem("bri.lastUser") !== AUTH.user.email) { resetIdentity(); localStorage.setItem("bri.lastUser", AUTH.user.email); } } catch (_) {}
  if (AUTH.user.mustChange) setTimeout(() => ACT["change-pw"] && ACT["change-pw"](), 600);
  await start();
}

async function unlock() {
  const pw = $("#pwInput").value, email = $("#emInput").value.trim();
  if (!email) { $("#pwError").textContent = "Enter your email."; return; }
  if (!pw) { $("#pwError").textContent = "Enter your password."; return; }
  $("#pwError").textContent = ""; $("#unlockBtn").disabled = true; $("#unlockBtn").textContent = "Signing in…";
  try {
    const r = await masterCall("login", { email, password: pw });
    tokStore.set(r.token); $("#pwInput").value = "";
    applyWorkspace(r.user, r.workspace);
    await afterLogin();
  } catch (e) { tokStore.clear(); $("#pwError").textContent = e.message; }
  finally { $("#unlockBtn").disabled = false; $("#unlockBtn").textContent = "Sign in"; }
}

async function start() {
  setStatus("load", "Syncing…");
  try { await loadData(); }
  catch (e) {
    if (e.code === 401) { tokStore.clear(); setStatus("bad", "Locked"); throw e; }
    // Signed in but the sheet isn't reachable: still show the app so the user can fix it in Setup.
    S.loaded = true; S.D = S.D || { brands: [], news: [], opps: [], contacts: [], pipeline: [], comps: [], byName: {} };
    S.raw = {}; S.meta = { connection: "error", error: e.message, geminiConnected: !!cfg.geminiKey };
    setStatus("bad", "Sheet not reachable");
    showApp();
    location.hash = "#/setup";
    routeFromHash();
    toast(e.message, "err", 8000);
    return;
  }
  showApp();
  if (!location.hash || location.hash === "#") location.hash = S.meta.connection === "none" ? "#/setup" : "#/overview";
  routeFromHash();
  if (!cfg.onboarded) { cfg.onboarded = true; saveCfg(); }
}

function showApp() {
  $("#gate").classList.add("hidden"); $("#app").classList.remove("hidden"); paintChrome();
  const u = AUTH.mode === "master" && AUTH.user;
  const ub = $("#userBtn"); if (ub) { ub.classList.toggle("hidden", !u); if (u) ub.title = `${u.name || u.email} · ${u.role} — change password`; }
}

function setStatus(kind, text) {
  const el = $("#sheetStatus"); if (!el) return;
  el.className = `status ${kind}`; el.querySelector("span").textContent = text;
}

function paintChrome() {
  const D = S.D || { brands: [], news: [], opps: [], contacts: [] };
  const counts = { overview: D.brands.length, signals: D.news.length, opportunities: D.opps.length, contacts: D.contacts.length, competitors: D.comps ? D.comps.length : 0 };
  const needsSetup = !S.meta || S.meta.connection === "none" || S.meta.connection === "error" || !D.brands.length;
  $$(".nav[data-view]").forEach((b, i) => {
    const [id, label, icon] = NAV.find((n) => n[0] === b.dataset.view);
    b.classList.toggle("hidden", !canView(id));
    b.innerHTML = `${ic(icon, 17)}<span>${label}</span>${counts[id] !== undefined ? `<em class="count">${counts[id]}</em>` : id === "setup" && needsSetup ? '<em class="dot-alert"></em>' : ""}`;
    b.classList.toggle("active", id === view || (view === "brand" && id === "overview"));
  });
  if (S.meta && S.meta.syncedAt) {
    const t = new Date(S.meta.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setStatus("ok", `Live · ${t}${S.meta.spreadsheet ? " · " + S.meta.spreadsheet : ""}`);
  }
  const ai = $("#aiStatus");
  if (ai) {
    const on = S.meta && S.meta.geminiConnected;
    ai.className = `status hide-sm ${on ? "ok" : ""}`;
    ai.querySelector("span").textContent = on ? "Gemini ready" : "Add Gemini key";
  }
  $("#themeBtn").innerHTML = ic(cfg.theme === "dark" ? "moon" : "sun", 16);
  $$('[data-act="theme"]').forEach((b) => b.classList.toggle("on", b.dataset.v === cfg.theme));
  $$('[data-act="accent"]').forEach((b) => b.classList.toggle("on", b.dataset.v === cfg.accent));
}

function applyTheme() {
  document.documentElement.dataset.theme = cfg.theme;
  document.documentElement.dataset.accent = cfg.accent;
}

/* --------------------------------- router --------------------------------- */
function go(v, arg) {
  const h = v === "brand" ? `#/brand/${encodeURIComponent(arg)}` : `#/${v}`;
  if (location.hash === h) routeFromHash(); else location.hash = h;
}
function routeFromHash() {
  if (!S.loaded) return;
  let h = (location.hash || "").replace(/^#\/?/, "");
  if (h.startsWith("brand=")) h = "brand/" + h.slice(6); // old share links
  const [v, ...rest] = h.split("/");
  const arg = decodeURIComponent(rest.join("/") || "");
  const known = NAV.map((n) => n[0]).concat(["brand"]);
  view = known.includes(v) && canView(v) ? v : "overview";
  viewArg = arg;
  if (view === "brand" && !brandByName(arg)) { view = "overview"; viewArg = null; }
  document.documentElement.scrollTop = 0;
  $("#app").classList.remove("nav-open");
  render();
}
function render() {
  paintChrome();
  const C = $("#content");
  const fn = { autoresearch: renderAuto, overview: renderOverview, signals: renderSignals, opportunities: renderOpps, contacts: renderContacts, pipeline: renderPipeline, competitors: renderCompetitors, setup: renderSetup, settings: renderSettings, admin: renderAdmin, brand: () => renderBrand(viewArg) }[view];
  C.style.animation = "none"; void C.offsetHeight; C.style.animation = "";
  fn();
}

/* ------------------------------- event wiring ------------------------------- */
function onClick(e) {
  const t = e.target.closest("[data-act]");
  if (!t) {
    $$(".menu.open").forEach((m) => m.classList.remove("open"));
    if (!e.target.closest(".search")) $("#searchPop").classList.remove("open");
    return;
  }
  const a = t.dataset.act;
  if (a === "toggle-menu") { t.parentElement.classList.toggle("open"); return; }
  if (ACT[a]) { if (t.tagName === "A") e.preventDefault(); ACT[a](t, e); }
}
function onKey(e) {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); $("#globalSearch").focus(); }
  if (e.key === "Escape") { $$(".overlay").pop()?.remove(); $("#searchPop").classList.remove("open"); }
}
Object.assign(ACT, {
  go: (t) => go(t.dataset.view),
  brand: (t) => go("brand", t.dataset.brand),
  refresh: async (t) => { t.classList.add("spin"); try { await loadData(); render(); toast("Data refreshed"); } catch (e) { toast(e.message, "err"); } t.classList.remove("spin"); },
  lock: () => { tokStore.clear(); try { sessionStorage.clear(); } catch (_) {} location.hash = ""; location.reload(); },
  theme: (t) => { cfg.theme = t.dataset.v; saveCfg(); applyTheme(); paintChrome(); },
  accent: (t) => { cfg.accent = t.dataset.v; saveCfg(); applyTheme(); paintChrome(); },
  "add-brand": () => openAddBrand(),
  "close-modal": (t) => t.closest(".overlay").remove(),
  link: (t) => window.open(t.dataset.url, "_blank", "noopener"),
});

/* ------------------------------ shared UI bits ------------------------------ */
function logoHtml(b, cls = "") {
  const name = typeof b === "string" ? b : b.name;
  const dom = typeof b === "string" ? (brandByName(b) || {}).domain : b.domain;
  return `<span class="logo-img ${cls}"><span>${esc((name || "?").trim().charAt(0).toUpperCase())}</span>${dom ? `<img src="https://www.google.com/s2/favicons?domain=${attr(dom)}&sz=64" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
}
const tierPill = (t) => `<span class="pill ${lc(t)}">${esc(t || "—")}</span>`;
const svcPills = (tags) => (tags || []).map((s) => `<span class="pill ${s.toLowerCase()}">${s === "VM" ? "Visual Merchandising" : "Promoters / SFO"}</span>`).join("");
const stagePill = (s) => `<span class="pill ${ACTIVE_STAGES.includes(s) ? "good" : s === "Won" ? "good" : s === "Lost" || s === "Dormant" ? "" : "info"}">${esc(s)}</span>`;
const stars = (n) => { n = Math.round(num(n)); return `<span class="stars" title="${n}/5">${"★".repeat(n)}<span class="off">${"★".repeat(5 - n)}</span></span>`; };
const heatRing = (h, cls = "") => `<div class="heat ${h >= 70 ? "h-hi" : h >= 45 ? "h-mid" : "h-lo"} ${cls}" style="--p:${h}" title="Heat score ${h}/100 = fit + freshness + confidence + reachability"><b>${h}</b></div>`;
const brandLinkHtml = (n) => `<a class="link" href="#/brand/${encodeURIComponent(n)}">${esc(n)}</a>`;
const emptyState = (icon, title, sub, btn = "") => `<div class="empty">${ic(icon, 34)}<b>${esc(title)}</b><div>${sub}</div>${btn ? `<div style="margin-top:14px">${btn}</div>` : ""}</div>`;
function needSheet() { return S.meta && (S.meta.connection === "none" || S.meta.connection === "error"); }
function setupBanner() {
  if (!needSheet()) return "";
  return `<div class="note warn" style="margin-bottom:18px">${ic("warn", 18)}<div><b>No Google Sheet connected yet.</b> Open the <a href="#/setup">Setup guide</a> — it takes about 5 minutes and sets up all the tabs for you in one click.</div></div>`;
}

function modal(html, { wide } = {}) {
  const o = document.createElement("div");
  o.className = "overlay";
  o.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  o.addEventListener("mousedown", (e) => { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  const f = o.querySelector("input,textarea,select"); if (f) setTimeout(() => f.focus(), 30);
  return o;
}

/** Sequential job runner with a progress dialog. */
async function runQueue(title, items, worker) {
  let cancelled = false, done = 0, okN = 0;
  const o = modal(`<h2>${esc(title)}</h2><p class="lead" id="rqSub">Starting…</p><div class="progress"><i id="rqBar" style="width:0%"></i></div><div class="checklist" id="rqList" style="margin-top:14px;max-height:280px;overflow:auto"></div><div class="modal-actions"><button class="btn ghost" id="rqCancel">Stop</button><button class="btn hidden" id="rqClose" data-act="close-modal">Done</button></div>`);
  $("#rqCancel", o).addEventListener("click", () => { cancelled = true; $("#rqCancel", o).disabled = true; });
  const list = $("#rqList", o);
  for (const it of items) {
    if (cancelled) break;
    const row = document.createElement("div");
    row.className = "chk warn"; row.innerHTML = `${ic("refresh", 15).replace('class="ic"', 'class="ic spin"')}<span>${esc(it)}</span><span>working…</span>`;
    list.appendChild(row); row.scrollIntoView({ block: "nearest" });
    $("#rqSub", o).textContent = `${done + 1} of ${items.length} — ${it}`;
    try {
      const msg = await worker(it);
      row.className = "chk ok"; row.innerHTML = `${ic("check", 15)}<span>${esc(it)}</span><span>${esc(msg || "done")}</span>`; okN++;
    } catch (e) {
      row.className = "chk"; row.style.color = "var(--bad)"; row.innerHTML = `${ic("warn", 15)}<span>${esc(it)}</span><span>${esc(e.message).slice(0, 80)}</span>`;
    }
    done++;
    $("#rqBar", o).style.width = `${Math.round((done / items.length) * 100)}%`;
  }
  $("#rqSub", o).textContent = `${okN} of ${items.length} completed${cancelled ? " (stopped)" : ""}.`;
  $("#rqCancel", o).classList.add("hidden"); $("#rqClose", o).classList.remove("hidden");
  return { ok: okN, total: items.length };
}

/* ------------------------------ global search ------------------------------ */
function initSearch() {
  const inp = $("#globalSearch"), pop = $("#searchPop");
  let sel = 0, hits = [];
  const paint = () => {
    pop.innerHTML = hits.length ? hits.map((h, i) => `<div class="sp-item ${i === sel ? "sel" : ""}" data-i="${i}">${h.html}<small>${esc(h.kind)}</small></div>`).join("") : `<div class="sp-item muted">No matches</div>`;
    pop.classList.add("open");
  };
  const open = (h) => { pop.classList.remove("open"); inp.value = ""; inp.blur(); h.fn(); };
  inp.addEventListener("input", () => {
    const q = lc(inp.value);
    if (!q || !S.D) return pop.classList.remove("open");
    hits = [];
    S.D.brands.filter((b) => lc(b.name).includes(q) || lc(b.segment).includes(q)).slice(0, 5).forEach((b) => hits.push({ kind: "Brand", html: `${logoHtml(b, "")}<b>${esc(b.name)}</b>`, fn: () => go("brand", b.name) }));
    S.D.news.filter((n) => lc(n.Headline).includes(q)).slice(0, 4).forEach((n) => hits.push({ kind: "Signal", html: `<span>${esc((n.Headline || "").slice(0, 70))}</span>`, fn: () => go("brand", n.Brand) }));
    S.D.contacts.filter((c) => lc(c["Decision Maker Name"]).includes(q)).slice(0, 3).forEach((c) => hits.push({ kind: "Person", html: `<span>${esc(c["Decision Maker Name"])} · ${esc(c.Brand)}</span>`, fn: () => go("brand", c.Brand) }));
    sel = 0; paint();
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, hits.length - 1); paint(); e.preventDefault(); }
    if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
    if (e.key === "Enter" && hits[sel]) open(hits[sel]);
  });
  pop.addEventListener("click", (e) => { const it = e.target.closest(".sp-item[data-i]"); if (it) open(hits[+it.dataset.i]); });
}

/* =============================== OVERVIEW =============================== */
function renderOverview() {
  const D = S.D, C = $("#content");
  const hour = new Date().getHours();
  const hi = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const who = firstName(cfg.sender.senderName);
  const brands = D.brands;
  const hot = brands.filter((b) => b.heat >= 70);
  const fresh = D.news.filter((n) => { const d = daysAgo(n.Date); return d !== null && d <= 7; });
  const reach = brands.filter((b) => b.readyContacts.length);
  const active = brands.filter((b) => ACTIVE_STAGES.includes(b.stage));

  let rows = brands.filter((b) =>
    (!OV.q || lc(b.name + b.segment + b.sector).includes(lc(OV.q))) && (!OV.tier || b.tier === OV.tier) && (!OV.stage || b.stage === OV.stage) &&
    (!OV.service || b.services.includes(OV.service)) &&
    (!OV.kpi || (OV.kpi === "hot" && b.heat >= 70) || (OV.kpi === "reach" && b.readyContacts.length) || (OV.kpi === "active" && ACTIVE_STAGES.includes(b.stage)) || (OV.kpi === "noreach" && !b.readyContacts.length)));
  const sorters = { heat: (a, b) => b.heat - a.heat, name: (a, b) => a.name.localeCompare(b.name), recent: (a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)), tier: (a, b) => ["High", "Medium", "Low"].indexOf(a.tier) - ["High", "Medium", "Low"].indexOf(b.tier) };
  rows.sort(sorters[OV.sort]);

  const top = brands.slice().sort((a, b) => b.heat - a.heat).filter((b) => b.top).slice(0, 6);
  const stageCounts = STAGES.map((s) => [s, brands.filter((b) => b.stage === s).length]);
  const maxStage = Math.max(1, ...stageCounts.map((x) => x[1]));
  const latest = D.news.slice().sort((a, b) => String(b.Date).localeCompare(String(a.Date))).slice(0, 6);

  const kpi = (id, label, icon, val, sub) => `<div class="card kpi ${OV.kpi === id ? "on" : ""}" data-act="ov-kpi" data-k="${id}"><div class="k-label">${ic(icon, 14)}${label}</div><div class="k-val">${val}</div><div class="k-sub">${sub}</div></div>`;

  C.innerHTML = `
    ${setupBanner()}
    <div class="page-head">
      <div><div class="eyebrow">${hi}${who ? ", " + esc(who) : ""}</div><h1>Where the retail-execution opportunities are</h1>
      <p>${brands.length ? `${hot.length} brand${hot.length === 1 ? "" : "s"} running hot, ${fresh.length} new signal${fresh.length === 1 ? "" : "s"} this week. Start with the top of the list — each brand shows why now, who to call and a ready-to-send draft.` : "Add the brands you want to track and the dashboard will research them for you."}</p></div>
      <div class="actions"><button class="btn ghost" data-act="go" data-view="setup">${ic("rocket", 15)}Setup guide</button><button class="btn" data-act="add-brand">${ic("plus", 15)}Add brand</button></div>
    </div>

    <div class="grid g5" style="margin-bottom:20px">
      ${kpi("all", "Brands tracked", "grid", brands.length, `${brands.filter((b) => b.tier === "High").length} high priority`)}
      ${kpi("hot", "Running hot", "flame", hot.length, "heat score 70+")}
      <div class="card kpi" data-act="go" data-view="signals"><div class="k-label">${ic("radar", 14)}Signals this week</div><div class="k-val">${fresh.length}</div><div class="k-sub">${D.news.length} in total</div></div>
      ${kpi("reach", "Reachable", "users", reach.length, `${brands.length - reach.length} need a contact`)}
      ${kpi("active", "In conversation", "mail", active.length, "connected → negotiation")}
    </div>

    ${top.length ? `
    <div class="split" style="margin-bottom:22px">
      <div class="card"><div class="card-head"><h3>${ic("flame", 17)}Hot right now</h3><span class="tip">Ranked by heat = fit + freshness + confidence + reachability</span></div>
        <div>${top.map((b, i) => `
          <div class="signal" data-act="brand" data-brand="${attr(b.name)}">
            ${heatRing(b.heat)}
            <div class="grow"><div class="row" style="gap:8px"><h4>${esc(b.name)}</h4>${svcPills(b.services)}</div>
              <p><b style="color:var(--ink)">${esc(b.top["Opportunity Type"] || "")}</b> — ${esc((b.top["Business Impact"] || b.top["Opportunity for Channelplay"] || "").slice(0, 170))}</p>
              ${b.top["Suggested Next Action"] ? `<p style="color:var(--accent)">→ ${esc(b.top["Suggested Next Action"].slice(0, 140))}</p>` : ""}</div>
            <div class="when">${b.latestNews ? relDate(b.latestNews) : ""}</div>
          </div>`).join("")}</div></div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${ic("kanban", 17)}Pipeline</h3><a href="#/pipeline" style="font-size:12.5px">Open board</a></div><div class="card-body funnel">
          ${stageCounts.filter(([s, n]) => n || ["Prospect", "Researching", "Connected", "Meeting Scheduled"].includes(s)).map(([s, n]) => `<div class="fun-row" data-act="ov-stage" data-s="${attr(s)}"><span>${esc(s)}</span><div class="fun-bar"><i style="width:${(n / maxStage) * 100}%"></i></div><b>${n}</b></div>`).join("")}
        </div></div>
        <div class="card"><div class="card-head"><h3>${ic("radar", 17)}Latest signals</h3><a href="#/signals" style="font-size:12.5px">All</a></div>
          ${latest.map((n) => `<div class="signal" data-act="brand" data-brand="${attr(n.Brand)}" style="padding:11px 20px"><div class="grow"><h4>${esc(n.Headline)}</h4><p>${esc(n.Brand)} · ${esc(n.Source || n.Category || "")}</p></div><span class="when">${relDate(n.Date)}</span></div>`).join("") || emptyState("radar", "No signals yet", "Research a brand to populate this feed.")}
        </div>
      </div>
    </div>` : ""}

    <div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="font-size:18px">Brand portfolio <span class="muted" style="font-weight:500">· ${rows.length}</span></h2>
      <div class="row"><button class="chip-btn ${OV.mode === "grid" ? "on" : ""}" data-act="ov-mode" data-m="grid">${ic("grid", 13)} Cards</button><button class="chip-btn ${OV.mode === "table" ? "on" : ""}" data-act="ov-mode" data-m="table">${ic("list", 13)} Table</button></div></div>
    <div class="filters">
      <div class="search" style="max-width:260px;flex:none"><span>${ic("search", 15)}</span><input id="ovQ" class="" placeholder="Filter brands…" value="${attr(OV.q)}" style="padding-left:34px"></div>
      <select class="select" data-ov="tier"><option value="">All priorities</option>${["High", "Medium", "Low"].map((t) => `<option ${OV.tier === t ? "selected" : ""}>${t}</option>`).join("")}</select>
      <select class="select" data-ov="stage"><option value="">All stages</option>${STAGES.map((t) => `<option ${OV.stage === t ? "selected" : ""}>${t}</option>`).join("")}</select>
      <select class="select" data-ov="service"><option value="">All services</option><option value="VM" ${OV.service === "VM" ? "selected" : ""}>Visual Merchandising</option><option value="SFO" ${OV.service === "SFO" ? "selected" : ""}>Promoters / SFO</option></select>
      <select class="select" data-ov="sort"><option value="heat" ${OV.sort === "heat" ? "selected" : ""}>Sort: Heat</option><option value="recent" ${OV.sort === "recent" ? "selected" : ""}>Sort: Recent activity</option><option value="name" ${OV.sort === "name" ? "selected" : ""}>Sort: Name</option><option value="tier" ${OV.sort === "tier" ? "selected" : ""}>Sort: Priority</option></select>
      ${OV.kpi || OV.tier || OV.stage || OV.service || OV.q ? `<button class="btn sm ghost" data-act="ov-clear">${ic("x", 12)} Clear filters</button>` : ""}
    </div>
    ${!rows.length ? `<div class="card">${emptyState("search", brands.length ? "No brands match these filters" : "No brands yet", brands.length ? "Try clearing a filter." : "Add your first brands to start researching.", brands.length ? "" : `<button class="btn" data-act="add-brand">${ic("plus", 15)} Add brands</button>`)}</div>` :
      OV.mode === "grid" ? `<div class="brand-grid">${rows.map(brandCard).join("")}</div>` : `
      <div class="card table-wrap"><table class="t"><thead><tr><th>Brand</th><th>Heat</th><th>Priority</th><th>Stage</th><th>Top opportunity</th><th>Services</th><th>Contact</th><th>Last signal</th></tr></thead><tbody>
      ${rows.map((b) => `<tr><td><div class="row" style="flex-wrap:nowrap">${logoHtml(b)}<div>${brandLinkHtml(b.name)}<div class="muted" style="font-size:12px">${esc(b.segment)}</div></div></div></td><td>${heatRing(b.heat, "sm")}</td><td>${tierPill(b.tier)}</td><td>${stagePill(b.stage)}</td><td style="max-width:300px">${b.top ? `<b>${esc(b.top["Opportunity Type"])}</b><div class="sub">${esc((b.top["Business Impact"] || "").slice(0, 100))}</div>` : '<span class="muted">Not researched</span>'}</td><td><div class="chips">${svcPills(b.services)}</div></td><td>${b.readyContacts[0] ? esc(b.readyContacts[0]["Decision Maker Name"]) : '<span class="muted">—</span>'}</td><td>${b.latestNews ? relDate(b.latestNews) : "—"}</td></tr>`).join("")}
      </tbody></table></div>`}`;

  const q = $("#ovQ"); if (q) q.addEventListener("input", (e) => { OV.q = e.target.value; clearTimeout(q._t); q._t = setTimeout(() => { renderOverview(); const n = $("#ovQ"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 180); });
  $$("[data-ov]").forEach((s) => s.addEventListener("change", () => { OV[s.dataset.ov] = s.value; renderOverview(); }));
}
function brandCard(b) {
  const c = b.readyContacts[0];
  return `<article class="card bcard" data-act="brand" data-brand="${attr(b.name)}" tabindex="0">
    <div class="row" style="flex-wrap:nowrap;gap:12px">${logoHtml(b)}<div class="grow"><h3>${esc(b.name)}</h3><div class="meta">${esc(b.segment || b.sector || "—")}</div></div>${heatRing(b.heat)}</div>
    <div class="chips">${tierPill(b.tier)}${stagePill(b.stage)}${svcPills(b.services)}</div>
    <p class="why">${b.top ? `<b style="color:var(--ink)">${esc(b.top["Opportunity Type"])}:</b> ${esc(b.top["Business Impact"] || b.top["Opportunity for Channelplay"] || "")}` : esc(b.notes || "Tracked — research pending.")}</p>
    <div class="foot"><span>${b.latestNews ? `${ic("radar", 12)} ${relDate(b.latestNews)}` : "No signals yet"}</span><span>${c ? `${ic("users", 12)} ${esc(c["Decision Maker Name"])}` : "No contact yet"}</span></div></article>`;
}
Object.assign(ACT, {
  "ov-kpi": (t) => { OV.kpi = t.dataset.k === "all" || OV.kpi === t.dataset.k ? null : t.dataset.k; renderOverview(); },
  "ov-stage": (t) => { OV.stage = OV.stage === t.dataset.s ? "" : t.dataset.s; renderOverview(); $(".filters").scrollIntoView({ behavior: "smooth", block: "center" }); },
  "ov-mode": (t) => { OV.mode = t.dataset.m; renderOverview(); },
  "ov-clear": () => { Object.assign(OV, { q: "", tier: "", stage: "", service: "", kpi: null }); renderOverview(); },
});

/* ================================ SIGNALS ================================ */
function renderSignals() {
  const D = S.D, C = $("#content");
  let rows = D.news.filter((n) => (!SG.brand || n.Brand === SG.brand) && (!SG.cat || n.Category === SG.cat) &&
    (SG.range === "all" || (daysAgo(n.Date) ?? 0) <= +SG.range) && (!SG.q || lc(n.Headline + n["AI Summary"] + n.Brand).includes(lc(SG.q))));
  rows = rows.slice().sort((a, b) => String(b.Date).localeCompare(String(a.Date)));
  const cats = uniq(D.news.map((n) => n.Category)).sort();
  C.innerHTML = `${setupBanner()}
    <div class="page-head"><div><div class="eyebrow">Signals</div><h1>What brands are doing in the market</h1><p>Store openings, launches, leadership moves and campaigns — every item is a reason to reach out.</p></div></div>
    <div class="filters">
      <div class="search" style="max-width:260px;flex:none"><span>${ic("search", 15)}</span><input id="sgQ" placeholder="Search signals…" value="${attr(SG.q)}" style="padding-left:34px"></div>
      <select class="select" data-sg="brand"><option value="">All brands</option>${D.brands.map((b) => `<option ${SG.brand === b.name ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
      <select class="select" data-sg="cat"><option value="">All types</option>${cats.map((c) => `<option ${SG.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select class="select" data-sg="range">${[["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"]].map(([v, l]) => `<option value="${v}" ${SG.range === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <span class="muted">${rows.length} signal${rows.length === 1 ? "" : "s"}</span>
    </div>
    <div class="stack">${rows.length ? rows.slice(0, 120).map((n) => `
      <article class="card card-pad"><div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:14px">${logoHtml(n.Brand)}
        <div class="grow"><div class="row" style="gap:8px;margin-bottom:4px"><a class="link" href="#/brand/${encodeURIComponent(n.Brand)}">${esc(n.Brand)}</a><span class="pill acc">${esc(n.Category || "Signal")}</span><span class="muted" style="font-size:12px">${relDate(n.Date)} · ${esc(n.Source || "")}</span></div>
          <h3 style="font-size:15.5px;margin-bottom:5px">${n.URL ? `<a href="${attr(n.URL)}" target="_blank" rel="noopener" style="color:inherit">${esc(n.Headline)} ${ic("ext", 12)}</a>` : esc(n.Headline)}</h3>
          <p class="sub">${esc(n["AI Summary"] || n.Summary || "")}</p>
          ${n["Why It Matters"] ? `<div class="why-now"><b>Why it matters:</b> ${esc(n["Why It Matters"])}</div>` : ""}</div></div></article>`).join("") : `<div class="card">${emptyState("radar", "No signals match", "Adjust the filters, or research a brand to find fresh news.")}</div>`}</div>`;
  const q = $("#sgQ"); q.addEventListener("input", (e) => { SG.q = e.target.value; clearTimeout(q._t); q._t = setTimeout(() => { renderSignals(); const n = $("#sgQ"); n.focus(); n.setSelectionRange(99, 99); }, 200); });
  $$("[data-sg]").forEach((s) => s.addEventListener("change", () => { SG[s.dataset.sg] = s.value; renderSignals(); }));
}

/* ============================== OPPORTUNITIES ============================== */
function renderOpps() {
  const D = S.D, C = $("#content");
  let rows = D.opps.filter((o) => num(o["Priority Score (1-5)"]) >= +OP.min && (!OP.service || serviceTags(o["Recommended Service"] + " " + o["Opportunity Type"]).includes(OP.service)) &&
    (!OP.q || lc(o.Brand + o["Opportunity Type"] + o["Business Impact"]).includes(lc(OP.q))));
  rows = rows.slice().sort((a, b) => num(b["Priority Score (1-5)"]) - num(a["Priority Score (1-5)"]) || num(b["Confidence Score (1-5)"]) - num(a["Confidence Score (1-5)"]));
  C.innerHTML = `${setupBanner()}
    <div class="page-head"><div><div class="eyebrow">Opportunities</div><h1>Where we can win</h1><p>Each opportunity links a real market signal to a specific service — Visual Merchandising or Promoter / Sales-Force programmes.</p></div></div>
    <div class="filters">
      <div class="search" style="max-width:260px;flex:none"><span>${ic("search", 15)}</span><input id="opQ" placeholder="Search opportunities…" value="${attr(OP.q)}" style="padding-left:34px"></div>
      <select class="select" data-op="service"><option value="">All services</option><option value="VM" ${OP.service === "VM" ? "selected" : ""}>Visual Merchandising</option><option value="SFO" ${OP.service === "SFO" ? "selected" : ""}>Promoters / SFO</option></select>
      <select class="select" data-op="min">${[1, 3, 4, 5].map((n) => `<option value="${n}" ${OP.min == n ? "selected" : ""}>${n === 1 ? "Any score" : "Score " + n + "+"}</option>`).join("")}</select>
      <span class="muted">${rows.length} opportunit${rows.length === 1 ? "y" : "ies"}</span></div>
    <div class="card table-wrap">${rows.length ? `<table class="t"><thead><tr><th>Brand</th><th>Opportunity</th><th>How we help</th><th>Score</th><th>Next action</th></tr></thead><tbody>
      ${rows.map((o) => { const tags = serviceTags(o["Recommended Service"] + " " + o["Opportunity Type"]); return `<tr style="cursor:pointer" data-act="brand" data-brand="${attr(o.Brand)}">
        <td><div class="row" style="flex-wrap:nowrap">${logoHtml(o.Brand)}<b>${esc(o.Brand)}</b></div></td>
        <td style="min-width:220px"><b>${esc(o["Opportunity Type"])}</b><div class="sub" style="margin-top:3px">${esc((o["Business Impact"] || "").slice(0, 150))}</div></td>
        <td style="min-width:260px">${esc((o["Opportunity for Channelplay"] || "").slice(0, 190))}<div class="chips" style="margin-top:6px">${svcPills(tags)}</div></td>
        <td style="white-space:nowrap">${stars(o["Priority Score (1-5)"])}<div class="muted" style="font-size:11.5px">confidence ${esc(o["Confidence Score (1-5)"] || "—")}/5</div></td>
        <td style="min-width:200px;color:var(--accent)">${esc((o["Suggested Next Action"] || "").slice(0, 150))}</td></tr>`; }).join("")}</tbody></table>` : emptyState("bolt", "No opportunities yet", "Opportunities appear after a brand is researched.")}</div>`;
  const q = $("#opQ"); q.addEventListener("input", (e) => { OP.q = e.target.value; clearTimeout(q._t); q._t = setTimeout(() => { renderOpps(); const n = $("#opQ"); n.focus(); n.setSelectionRange(99, 99); }, 200); });
  $$("[data-op]").forEach((s) => s.addEventListener("change", () => { OP[s.dataset.op] = s.value; renderOpps(); }));
}

/* ================================ CONTACTS ================================ */
function renderContacts() {
  const D = S.D, C = $("#content");
  const rows = [];
  D.brands.forEach((b) => { if (b.contacts.length) b.contacts.forEach((c) => rows.push({ b, c })); else rows.push({ b, c: null }); });
  rows.sort((x, y) => (y.c && !isPlaceholder(y.c["Decision Maker Name"]) ? 1 : 0) - (x.c && !isPlaceholder(x.c["Decision Maker Name"]) ? 1 : 0) || x.b.name.localeCompare(y.b.name));
  const missing = D.brands.filter((b) => !b.readyContacts.length);
  C.innerHTML = `${setupBanner()}
    <div class="page-head"><div><div class="eyebrow">Contacts</div><h1>Who to talk to</h1><p>Decision-makers found through live search. Only publicly published details are saved — nothing is guessed. Always verify before sending.</p></div>
      <div class="actions">${genericRows(D).length ? `<button class="btn ghost" data-act="clean-contacts">${ic("shield", 15)}Remove ${genericRows(D).length} generic detail${genericRows(D).length === 1 ? "" : "s"}</button>` : ""}<button class="btn" data-act="find-all-contacts" ${missing.length ? "" : "disabled"}>${ic("sparkle", 15)}Find ${missing.length} missing contact${missing.length === 1 ? "" : "s"} with AI</button></div></div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Brand</th><th>Decision-maker</th><th>Department</th><th>Reach</th><th>Notes</th><th></th></tr></thead><tbody>
    ${rows.map(({ b, c }) => { const has = c && !isPlaceholder(c["Decision Maker Name"]); return `<tr>
      <td><div class="row" style="flex-wrap:nowrap">${logoHtml(b)}${brandLinkHtml(b.name)}</div></td>
      <td>${has ? `<b>${esc(c["Decision Maker Name"])}</b><div class="sub">${esc(c.Designation)}</div>` : '<span class="muted">Not found yet</span>'}</td>
      <td>${has && c.Department ? `<span class="pill">${esc(c.Department)}</span>` : "—"}</td>
      <td>${has ? contactLinks(c) : ""}</td>
      <td style="max-width:320px;font-size:12px;color:var(--ink-2)">${has ? esc((c["Research Status"] || "").slice(0, 170)) : ""}</td>
      <td>${has ? "" : `<button class="btn sm soft" data-act="research-contact" data-brand="${attr(b.name)}">${ic("sparkle", 13)}Find</button>`}</td></tr>`; }).join("") || `<tr><td colspan="6">${emptyState("users", "No brands yet", "Add brands first.")}</td></tr>`}
    </tbody></table></div>`;
}
/** Direct e-mail / phone that are safe to show: generic, customer-care and free-mail details are never presented as a person's contact. */
function directEmail(c) { const e = firstEmailIn(c["Official Email (public only)"]); return e && !isGenericEmail(e) ? e : ""; }
function directPhone(c) { const p = c["Official Contact Number (public only)"]; return p && !isPlaceholder(p) && !isGenericPhone(p) ? String(p).trim() : ""; }
function genericRows(D) { return D.contacts.filter((c) => scrubGeneric(c)); }
function contactLinks(c) {
  const em = directEmail(c), ph = directPhone(c), li = c["LinkedIn Profile"];
  return `<div class="stack" style="gap:3px;font-size:12.5px">
    ${em ? `<a href="mailto:${attr(em)}">${ic("mail", 12)} ${esc(em)}</a>` : ""}
    ${ph ? `<span>${ic("phone", 12)} ${esc(ph.slice(0, 40))}</span>` : ""}
    ${li && /^https?:/i.test(li) ? `<a href="${attr(li)}" target="_blank" rel="noopener">${ic("link", 12)} ${/\/in\//.test(li) ? "LinkedIn profile" : "LinkedIn search"}</a>` : ""}</div>`;
}
ACT["clean-contacts"] = async (t) => {
  const rows = genericRows(S.D);
  if (!rows.length) return;
  if (!confirm(`Clear ${rows.length} customer-care / generic e-mail or phone entr${rows.length === 1 ? "y" : "ies"} from your Contacts sheet?\nOnly those cells are blanked; names and everything else stay.`)) return;
  t.disabled = true;
  let n = 0;
  try {
    for (const c of rows) {
      const fix = scrubGeneric(c);
      await write("updateRow", { sheet: "Contacts", matchColumn: "Decision Maker Name", matchValue: c["Decision Maker Name"], updates: { ...fix, "Research Status": `${c["Research Status"] || ""} Generic contact details removed ${today()}.`.trim() } });
      n++;
    }
    await loadData(); toast(`Removed generic details from ${n} contact${n === 1 ? "" : "s"}`); render();
  } catch (e) { toast(e.message, "err"); t.disabled = false; }
};
ACT["find-all-contacts"] = async () => {
  const names = S.D.brands.filter((b) => !b.readyContacts.length).map((b) => b.name);
  await runQueue("Finding decision-makers", names, async (n) => { const r = await researchContact(n, { silent: true }); return r.found ? r.contacts[0]["Decision Maker Name"] : "none found"; });
  await loadData(); render();
};

/* ================================ PIPELINE ================================ */
function renderPipeline() {
  const D = S.D, C = $("#content");
  const stages = STAGES.filter((s) => PL.showClosed || !["Lost", "Dormant"].includes(s));
  const owners = uniq(D.brands.map((b) => b.owner));
  C.innerHTML = `${setupBanner()}
    <div class="page-head"><div><div class="eyebrow">Pipeline</div><h1>Outreach board</h1><p>Drag a brand between stages — changes are saved to your sheet instantly.</p></div>
      <div class="actions">${owners.length > 1 ? `<select class="select" id="plOwner" style="width:auto;border-radius:999px"><option value="">All owners</option>${owners.map((o) => `<option ${PL.owner === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : ""}
      <button class="chip-btn ${PL.showClosed ? "on" : ""}" data-act="pl-closed">Show lost / dormant</button></div></div>
    <div class="board">${stages.map((s) => {
      const items = D.brands.filter((b) => b.stage === s && (!PL.owner || b.owner === PL.owner)).sort((a, b) => b.heat - a.heat);
      return `<div class="col" data-stage="${attr(s)}"><h4><span>${esc(s)}</span><span>${items.length}</span></h4>${items.map((b) => `
        <div class="kcard" draggable="true" data-brand="${attr(b.name)}" data-act="brand">${logoHtml(b)}<div class="grow"><b>${esc(b.name)}</b><small>${b.top ? esc(b.top["Opportunity Type"].slice(0, 28)) : esc(b.segment.slice(0, 28))}</small></div>${heatRing(b.heat, "sm")}</div>`).join("")}</div>`; }).join("")}</div>`;
  const ow = $("#plOwner"); if (ow) ow.addEventListener("change", () => { PL.owner = ow.value; renderPipeline(); });
  let dragging = null;
  $$(".kcard").forEach((k) => {
    k.addEventListener("dragstart", (e) => { dragging = k.dataset.brand; k.classList.add("drag"); e.dataTransfer.setData("text/plain", dragging); e.dataTransfer.effectAllowed = "move"; });
    k.addEventListener("dragend", () => k.classList.remove("drag"));
  });
  $$(".col").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault(); col.classList.remove("over");
      const name = e.dataTransfer.getData("text/plain") || dragging; const b = brandByName(name);
      if (!b || b.stage === col.dataset.stage) return;
      try { await updateStage(name, col.dataset.stage); } catch (_) {}
      renderPipeline();
    });
  });
}
ACT["pl-closed"] = () => { PL.showClosed = !PL.showClosed; renderPipeline(); };

/* ============================== COMPETITORS ============================== */
function renderCompetitors() {
  const D = S.D, C = $("#content");
  const rows = D.comps.slice().sort((a, b) => String(b.Date).localeCompare(String(a.Date)));
  const tracked = (n) => !!brandByName(n);
  C.innerHTML = `${setupBanner()}
    <div class="page-head"><div><div class="eyebrow">Competitor watch</div><h1>Moves that put your accounts under pressure</h1><p>When a rival expands, your tracked brands need to respond. Use these as conversation openers — or track the competitor as a new account.</p></div></div>
    <div class="stack">${rows.length ? rows.map((r, i) => `
      <article class="card card-pad"><div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:14px">${logoHtml(r.Competitor)}
        <div class="grow"><div class="row" style="gap:8px;margin-bottom:5px"><b>${esc(r.Competitor)}</b><span class="pill acc">${esc(r.Category || "Market move")}</span><span class="muted" style="font-size:12px">${relDate(r.Date)} · ${esc(r.Source || "")}</span></div>
          <h3 style="font-size:15.5px;margin-bottom:5px">${r.URL ? `<a href="${attr(r.URL)}" target="_blank" rel="noopener" style="color:inherit">${esc(r.Headline)} ${ic("ext", 12)}</a>` : esc(r.Headline)}</h3>
          <p class="sub">${esc(r.Summary)}</p>
          ${r["Related Tracked Brand"] ? `<div class="chips" style="margin-top:10px"><span class="muted" style="font-size:12px">Pressure on:</span>${String(r["Related Tracked Brand"]).split(",").map((x) => x.trim()).filter(Boolean).map((x) => brandByName(x) ? `<a class="pill info" href="#/brand/${encodeURIComponent(x)}">${esc(x)}</a>` : `<span class="pill">${esc(x)}</span>`).join("")}</div>` : ""}
          ${r["Full Analysis"] && r["Full Analysis"] !== r.Summary ? `<details class="fold" style="margin-top:12px"><summary>Full analysis &amp; pitch angle</summary><div>${esc(r["Full Analysis"])}</div></details>` : ""}</div>
        <div>${tracked(r.Competitor) ? `<span class="pill good">${ic("check", 12)} Tracked</span>` : `<button class="btn sm soft" data-act="track-comp" data-i="${i}">${ic("plus", 13)}Track brand</button>`}</div></div></article>`).join("") : `<div class="card">${emptyState("eye", "No competitor signals yet", "Competitor moves are added by your research automation. Rows go in the “Competitor Watch” tab.")}</div>`}</div>`;
  window.__comps = rows;
}
ACT["track-comp"] = async (t) => {
  const r = window.__comps[+t.dataset.i];
  t.disabled = true; t.innerHTML = `${ic("refresh", 13)} Researching…`;
  try {
    await researchBrand(r.Competitor, { context: { headline: r.Headline, summary: r.Summary, category: r.Category } });
    await loadData(); toast(`${r.Competitor} added and researched`); render();
  } catch (e) { toast(e.message, "err"); render(); }
};

/* ============================ ADD BRAND / RESEARCH ============================ */
function researchBrand(name, extra = {}) {
  return researchBrandAI(name, { profile: { ...cfg.profile, ownerName: cfg.profile.ownerName || cfg.sender.senderName }, ...extra });
}
function openAddBrand() {
  if (needSheet()) { toast("Connect your Google Sheet first (Setup guide).", "err"); return go("setup"); }
  const ai = S.meta.geminiConnected;
  const o = modal(`<h2>Add brands</h2><p class="lead">Type one brand, or several separated by commas or new lines.</p>
    <div class="field"><label>Brand name(s)</label><textarea class="textarea" id="abNames" placeholder="e.g. Samsung, Sony, Dyson" style="min-height:70px"></textarea></div>
    <div class="fgrid"><div class="field"><label>Sector <span class="muted">(optional)</span></label><input class="input" id="abSector" placeholder="Consumer Electronics"></div>
    <div class="field"><label>Priority</label><select class="select" id="abTier"><option>High</option><option selected>Medium</option><option>Low</option></select></div></div>
    <label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="abAi" ${ai ? "checked" : "disabled"}> <span><b>Research with AI now</b> <span class="muted">— finds recent signals &amp; opportunities (about 20 sec per brand)</span></span></label>
    ${ai ? "" : `<div class="tip" style="margin-top:6px">Add a Gemini key in <a href="#/setup" data-act="close-modal">Setup</a> to enable AI research.</div>`}
    <div class="err" id="abErr"></div>
    <div class="modal-actions"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn" id="abGo">Add brands</button></div>`);
  $("#abGo", o).addEventListener("click", async () => {
    const names = uniq($("#abNames", o).value.split(/[\n,;]+/).map((s) => s.trim()));
    if (!names.length) { $("#abErr", o).textContent = "Enter at least one brand name."; return; }
    const dupes = names.filter((n) => brandByName(n));
    const fresh = names.filter((n) => !brandByName(n));
    if (!fresh.length) { $("#abErr", o).textContent = `Already tracked: ${dupes.join(", ")}`; return; }
    const opts = { research: $("#abAi", o).checked, sector: $("#abSector", o).value.trim(), tier: $("#abTier", o).value };
    o.remove();
    await bulkAddBrands(fresh, opts);
    if (fresh.length === 1) go("brand", fresh[0]); else render();
  });
}
async function bulkAddBrands(names, { research, sector, tier } = {}) {
  const res = await runQueue(research ? "Adding & researching brands" : "Adding brands", names, async (n) => {
    const info = { sector: sector || "", tier };
    if (research) {
      const r = await researchBrand(n, { brandInfo: info });
      return `${r.written ? r.written.news : 0} signals · ${r.written ? r.written.opportunities : 0} opps${r.warning ? " ⚠" : ""}`;
    }
    await write("addBrand", {
      brand: { Brand: n, Sector: sector || cfg.profile.sectors.split("|")[0] || "", Segment: "", "Priority Tier": tier || "Medium", Website: "", "HQ / India Office": "", "Status Notes": "Added manually — not yet researched.", "Date Added": today() },
      pipeline: { Brand: n, Stage: "Prospect", Owner: cfg.sender.senderName || "", "Last Update": today(), "Next Follow-up Date": "", Notes: "" },
    });
    return "added";
  });
  try { await loadData(); } catch (_) {}
  return res;
}
