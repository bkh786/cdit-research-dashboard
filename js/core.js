/* ==========================================================================
   Brand Research & Insights — core: config, API, data model, helpers
   ========================================================================== */
"use strict";

const STAGES = ["Prospect", "Researching", "Connected", "Meeting Scheduled", "Proposal Shared", "Negotiation", "Won", "Lost", "Dormant"];
const ACTIVE_STAGES = ["Connected", "Meeting Scheduled", "Proposal Shared", "Negotiation"];
const SIGNAL_TYPES = ["Retail Expansion", "New Store / Experience Zone", "Product Launch", "Leadership Change", "Festive / Seasonal Campaign", "Distribution / Channel Partnership", "Manufacturing / Capex", "Funding / Financials", "Marketing Campaign", "Hiring / Workforce", "Other"];
const TAB_NAMES = ["Brands Master", "News feed", "Opportunities", "Contacts", "Pipeline", "Email Drafts", "Competitor Watch", "Email Settings", "Workspace Settings"];

/** Same alias table as apps-script/Code.gs, so older sheets keep working. */
const ALIASES = {
  "Decision Maker Name": ["Decision Maker", "Name", "Contact Name", "Contact"],
  "Designation": ["Title/Role", "Title", "Role", "Job Title"],
  "LinkedIn Profile": ["LinkedIn/Source URL", "LinkedIn", "LinkedIn URL"],
  "Official Email (public only)": ["Official Email", "Email", "Public Email"],
  "Official Contact Number (public only)": ["Public Desk Contact", "Phone", "Contact Number", "Official Phone"],
  "Office Location": ["City/Hub", "Location", "City"],
  "Research Status": ["Verification Status / Notes", "Verification Status", "Notes"],
  "Company Website": ["Website", "Domain"],
};

const DEFAULT_PROFILE = {
  companyName: "Channelplay Limited",
  companyWebsite: "https://www.channelplay.in",
  services: ["Visual Merchandising (VM)", "Sales Force Outsourcing (SFO) / Promoter Management"],
  pitch: "Retail execution partner: trained, tech-enabled promoters and pan-India visual merchandising with live visibility.",
  proofPoints: "90%+ promoter fill rate; ~5% promoter attrition; pan-India visual merchandising & POSM rollout; 1Channel platform for selfie check-in, attendance, counter sales and stock visibility; retail & mystery audits.",
  sectors: "Consumer Electronics|Consumer Durables|IT Hardware",
  geography: "India",
  buyerRoles: "",
  tagline: "Retail Execution|Field Force Outsourcing|Visual Merchandising|Tech Audits",
  ownerName: "",
};
const DEFAULT_SENDER = { senderName: "", senderDesignation: "", senderEmail: "", defaultCc: "", phoneNumber: "" };

/* ------------------------------- config -------------------------------- */
const CFG_KEY = "bri.config.v2";
let cfg = loadCfg();

function loadCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); } catch (_) {}
  // one-time migration of the old v1 sender settings
  if (!c.sender) {
    try {
      const old = JSON.parse(localStorage.getItem("ce_dashboard_email_settings") || "null");
      if (old) c.sender = { senderName: old.senderName || "", senderDesignation: old.senderDesignation || "", senderEmail: old.senderEmail || "", defaultCc: old.defaultCc || "", phoneNumber: old.phoneNumber || "" };
    } catch (_) {}
  }
  return {
    mode: c.mode || "default", // "default" = server's sheet · "own" = user's own bridge
    bridgeUrl: c.bridgeUrl || "", bridgeSecret: c.bridgeSecret || "",
    geminiKey: c.geminiKey || "", geminiModel: c.geminiModel || "",
    theme: c.theme || localStorage.getItem("cdit_theme") || "light",
    accent: c.accent || localStorage.getItem("cdit_accent") || "indigo",
    sidebarCollapsed: !!c.sidebarCollapsed,
    onboarded: !!c.onboarded,
    profile: { ...DEFAULT_PROFILE, ...(c.profile || {}) },
    sender: { ...DEFAULT_SENDER, ...(c.sender || {}) },
  };
}
/** Called when switching workspace so one person's sender/profile never leaks into another's. */
function resetIdentity() { cfg.profile = { ...DEFAULT_PROFILE }; cfg.sender = { ...DEFAULT_SENDER }; saveCfg(); }
function saveCfg() {
  try {
    // In master mode secrets live only in the master sheet — never in this browser.
    const c = AUTH.mode === "master" ? { ...cfg, bridgeSecret: "", geminiKey: "" } : cfg;
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch (_) {}
  scheduleWorkspaceSync();
}

/* ---------------------- master-sheet login & workspace ---------------------- */
const AUTH = { mode: "legacy", user: null, workspace: null };
const tokStore = { get: () => sessionStorage.getItem("bri_tok") || "", set: (v) => sessionStorage.setItem("bri_tok", v), clear: () => sessionStorage.removeItem("bri_tok") };
let _syncT = null;
function scheduleWorkspaceSync() {
  if (AUTH.mode !== "master" || !AUTH.user) return;
  clearTimeout(_syncT);
  _syncT = setTimeout(async () => {
    const f = { bridgeUrl: cfg.bridgeUrl, geminiModel: cfg.geminiModel };
    if (cfg.bridgeSecret) f.bridgeSecret = cfg.bridgeSecret;
    if (cfg.geminiKey) f.geminiKey = cfg.geminiKey;
    try { await api("/api/auth", { action: "saveMyWorkspace", fields: f }); } catch (e) { toast("Couldn't save to master sheet: " + e.message, "err"); }
  }, 400);
}
/** Pull the signed-in user's workspace (from the master sheet) into the local config. */
async function hydrateFromMaster() {
  const me = await api("/api/auth", { action: "me" });
  AUTH.user = me.user; AUTH.workspace = me.workspace;
  const w = me.workspace || {};
  cfg.mode = "own"; cfg.onboarded = true;
  cfg.bridgeUrl = w.bridgeUrl || ""; cfg.geminiModel = w.geminiModel || "";
  cfg.bridgeSecret = ""; cfg.geminiKey = "";
  if (w.companyName && (!cfg.profile.companyName || cfg.profile.companyName === DEFAULT_PROFILE.companyName)) cfg.profile.companyName = w.companyName;
  saveCfgLocalOnly();
}
function saveCfgLocalOnly() { try { localStorage.setItem(CFG_KEY, JSON.stringify({ ...cfg, bridgeSecret: "", geminiKey: "" })); } catch (_) {} }
function canView(id) { return AUTH.mode !== "master" || !AUTH.user || (AUTH.user.pages || []).includes(id) || id === "brand"; }

/* ------------------------------ helpers -------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const attr = (s) => esc(s).replace(/`/g, "&#96;");
const lc = (s) => String(s ?? "").trim().toLowerCase();
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const uniq = (a) => [...new Set(a.filter(Boolean))];
const today = () => new Date().toISOString().slice(0, 10);
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const split = (s) => String(s || "").split("|").map((x) => x.trim()).filter(Boolean);

function parseDate(s) {
  if (!s) return null;
  let t = String(s).trim();
  if (/^\d{4}-\d{2}$/.test(t)) t += "-01";
  const d = new Date(t);
  return isNaN(d) ? null : d;
}
function daysAgo(s) { const d = parseDate(s); return d ? Math.floor((Date.now() - d.getTime()) / 864e5) : null; }
function relDate(s) {
  const n = daysAgo(s);
  if (n === null) return s || "—";
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n < 14) return `${n}d ago`;
  if (n < 60) return `${Math.round(n / 7)}w ago`;
  return parseDate(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function niceDate(s) { const d = parseDate(s); return d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : (s || "—"); }

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  kanban: '<rect x="3" y="3" width="5" height="16" rx="1"/><rect x="10" y="3" width="5" height="10" rx="1"/><rect x="17" y="3" width="4" height="13" rx="1"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="M12 15l-3-3a22 22 0 0 1 2-4 12.9 12.9 0 0 1 11-6c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0"/><path d="M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  sparkle: '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  chev: '<path d="M9 18l6-6-6-6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  ext: '<path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.4 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V22h16"/>',
};
const ic = (name, size = 16) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

/* -------------------------------- toast -------------------------------- */
function toast(msg, kind = "ok", ms = 4200) {
  let wrap = $("#toasts");
  if (!wrap) { wrap = document.createElement("div"); wrap.id = "toasts"; document.body.appendChild(wrap); }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = `${ic(kind === "err" ? "warn" : kind === "info" ? "sparkle" : "check", 16)}<span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------------------------------- API --------------------------------- */
const pwStore = { get: () => sessionStorage.getItem("cdit_pw") || "", set: (v) => sessionStorage.setItem("cdit_pw", v), clear: () => sessionStorage.removeItem("cdit_pw") };

function apiHeaders() {
  if (AUTH.mode === "master") return { "Content-Type": "application/json", Authorization: "Bearer " + tokStore.get() };
  const h = { "Content-Type": "application/json", "x-dashboard-password": pwStore.get() };
  if (cfg.mode === "own") { h["x-workspace"] = "own"; if (cfg.bridgeUrl) { h["x-bridge-url"] = cfg.bridgeUrl; h["x-bridge-secret"] = cfg.bridgeSecret; } }
  if (cfg.geminiKey) h["x-gemini-key"] = cfg.geminiKey;
  if (cfg.geminiModel) h["x-gemini-model"] = cfg.geminiModel;
  return h;
}
async function api(path, body, { method } = {}) {
  const resp = await fetch(path, { method: method || (body ? "POST" : "GET"), headers: apiHeaders(), body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await resp.json(); } catch (_) {}
  if (resp.status === 401 && AUTH.mode === "master" && path !== "/api/auth") { const e = new Error("Session expired — please sign in again."); e.code = 401; throw e; }
  if (resp.status === 401 && /unauthorized/i.test(data.error || "") && !/secret/i.test(data.error || "")) { const e = new Error("Session expired — please unlock again."); e.code = 401; throw e; }
  if (!resp.ok || data.error) { const e = new Error(data.error || `Request failed (${resp.status})`); e.code = resp.status; throw e; }
  return data;
}
const write = (action, payload) => api("/api/sheet-write", { action, ...payload });

/* ------------------------------ data model ------------------------------ */
const S = { raw: {}, headers: {}, meta: {}, D: null, loaded: false };

function normRows(rows) {
  return (rows || []).map((r) => {
    const o = { ...r };
    for (const canon in ALIASES) {
      if (o[canon] === undefined || o[canon] === "") {
        for (const alt of ALIASES[canon]) if (r[alt] !== undefined && r[alt] !== "") { o[canon] = r[alt]; break; }
      }
      if (o[canon] === undefined) o[canon] = "";
    }
    return o;
  });
}

function serviceTags(text) {
  const t = lc(text);
  const tags = [];
  if (/visual|merchandis|\bvm\b|posm|display|audit/.test(t)) tags.push("VM");
  if (/promoter|staff|sfo|sales force|salesforce|field force|payroll|demonstrat|experiential|manpower/.test(t)) tags.push("SFO");
  return tags;
}
const domainOf = (w) => String(w || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].trim();
const isPlaceholder = (v) => !v || /^(not (yet|public|publicly|found)|pending|unverified|tbd|n\/a|none|—|-)/i.test(String(v).trim());

function buildModel() {
  const R = S.raw;
  const brands = normRows(R["Brands Master"]).filter((b) => b.Brand);
  const news = normRows(R["News feed"]).filter((n) => n.Brand || n.Headline);
  const opps = normRows(R["Opportunities"]).filter((o) => o.Brand);
  const contacts = normRows(R["Contacts"]).filter((c) => c.Brand);
  const pipeline = normRows(R["Pipeline"]).filter((p) => p.Brand);
  const comps = normRows(R["Competitor Watch"]).filter((c) => c.Competitor);

  const by = (arr) => arr.reduce((m, x) => ((m[lc(x.Brand)] ||= []).push(x), m), {});
  const newsBy = by(news), oppBy = by(opps), conBy = by(contacts);
  const plBy = {};
  pipeline.forEach((p) => (plBy[lc(p.Brand)] = p)); // last row wins (sheet may hold duplicates)

  const list = [];
  const seen = new Set();
  brands.forEach((b) => {
    const k = lc(b.Brand);
    if (seen.has(k)) return;
    seen.add(k);
    const bn = (newsBy[k] || []).slice().sort((a, c) => String(c.Date).localeCompare(String(a.Date)));
    const bo = (oppBy[k] || []).slice().sort((a, c) => num(c["Priority Score (1-5)"]) - num(a["Priority Score (1-5)"]));
    const bc = conBy[k] || [];
    const pl = plBy[k] || {};
    const top = bo[0] || null;
    // buyers first: marketing / trade / sales / retail roles outrank board-level contacts
    const roleScore = (c) => (/market|trade|brand|retail|sales|commercial|channel/i.test(`${c.Designation} ${c.Department}`) ? 1 : 0);
    const readyContacts = bc.filter((c) => !isPlaceholder(c["Decision Maker Name"])).sort((x, y) => roleScore(y) - roleScore(x));
    const latestNews = bn[0] ? bn[0].Date : "";
    const fresh = daysAgo(latestNews);
    const fit = top ? num(top["Priority Score (1-5)"]) / 5 : 0.2;
    const conf = top ? num(top["Confidence Score (1-5)"], 3) / 5 : 0.4;
    const freshness = fresh === null ? 0 : fresh <= 14 ? 1 : fresh <= 45 ? 0.66 : fresh <= 90 ? 0.33 : 0.1;
    const reach = readyContacts.length ? 1 : 0;
    const heat = Math.round(fit * 50 + freshness * 28 + conf * 10 + reach * 12);
    list.push({
      name: b.Brand, sector: b.Sector || "", segment: b.Segment || "", tier: b["Priority Tier"] || "Medium",
      website: b.Website || "", domain: domainOf(b.Website), hq: b["HQ / India Office"] || "", notes: b["Status Notes"] || "", added: b["Date Added"] || "",
      stage: pl.Stage || "Prospect", owner: pl.Owner || "", followUp: pl["Next Follow-up Date"] || "", pipeNotes: pl.Notes || "", lastUpdate: pl["Last Update"] || "",
      news: bn, opps: bo, contacts: bc, readyContacts, top, heat, latestNews,
      services: uniq(bo.flatMap((o) => serviceTags(o["Recommended Service"] || o["Opportunity Type"]))),
      lastActivity: [latestNews, pl["Last Update"], b["Date Added"]].filter(Boolean).sort().pop() || "",
    });
  });
  S.D = { brands: list, news, opps, contacts, pipeline, comps, byName: Object.fromEntries(list.map((b) => [lc(b.name), b])) };
}
const brandByName = (n) => (S.D && S.D.byName[lc(n)]) || null;

/* ---- settings stored in the sheet's "Workspace Settings" tab (key / value) ---- */
const SETTING_KEYS = {
  "company.name": ["profile", "companyName"], "company.website": ["profile", "companyWebsite"],
  "company.pitch": ["profile", "pitch"], "company.proof": ["profile", "proofPoints"],
  "company.services": ["profile", "services", "list"], "company.tagline": ["profile", "tagline"],
  "target.sectors": ["profile", "sectors"], "target.geography": ["profile", "geography"],
  "buyer.roles": ["profile", "buyerRoles"], "owner.name": ["profile", "ownerName"],
  "sender.name": ["sender", "senderName"], "sender.designation": ["sender", "senderDesignation"],
  "sender.email": ["sender", "senderEmail"], "sender.cc": ["sender", "defaultCc"], "sender.phone": ["sender", "phoneNumber"],
};
function settingsToPairs() {
  const p = {};
  for (const [k, [grp, field, kind]] of Object.entries(SETTING_KEYS)) {
    const v = cfg[grp][field];
    p[k] = kind === "list" ? (v || []).join("|") : v || "";
  }
  return p;
}
function applySheetSettings() {
  const rows = S.raw["Workspace Settings"] || [];
  let touched = false;
  rows.forEach((r) => {
    const m = SETTING_KEYS[String(r.Key || "").trim()];
    const v = String(r.Value ?? "").trim();
    if (!m || !v) return;
    const [grp, field, kind] = m;
    cfg[grp][field] = kind === "list" ? split(v) : v;
    touched = true;
  });
  // legacy "Email Settings" tab → sender defaults when nothing else is set
  const legacy = (S.raw["Email Settings"] || [])[0];
  if (legacy) {
    const s = cfg.sender;
    s.senderName ||= legacy["Sender Name"] || ""; s.senderDesignation ||= legacy["Sender Designation"] || "";
    s.senderEmail ||= legacy["Sender Email"] || ""; s.defaultCc ||= legacy["Default CC"] || ""; s.phoneNumber ||= legacy["Phone Number"] || "";
    if (!touched && legacy["Company Name"]) cfg.profile.companyName = legacy["Company Name"];
    if (!touched && legacy["Company Website"]) cfg.profile.companyWebsite = legacy["Company Website"];
  }
  saveCfg();
}

async function loadData({ quiet } = {}) {
  const data = await api("/api/sheet-data");
  S.raw = data.sheets || {};
  S.headers = data.headers || {};
  S.meta = { syncedAt: data.syncedAt, connection: data.connection, writable: data.writable, spreadsheet: data.spreadsheet || "", geminiConnected: data.geminiConnected, geminiModel: data.geminiModel, usingOwnSheet: data.usingOwnSheet };
  applySheetSettings();
  buildModel();
  S.loaded = true;
  return data;
}

/* ----------------------------- shared actions ---------------------------- */
async function updateStage(brandName, stage) {
  const b = brandByName(brandName);
  const prev = b ? b.stage : "";
  if (b) b.stage = stage;
  try {
    await write("upsertRow", { sheet: "Pipeline", matchColumn: "Brand", matchValue: brandName, updates: { Stage: stage, "Last Update": today() } });
    const row = (S.raw["Pipeline"] || []).find((p) => lc(p.Brand) === lc(brandName));
    if (row) { row.Stage = stage; row["Last Update"] = today(); } else (S.raw["Pipeline"] ||= []).push({ Brand: brandName, Stage: stage, "Last Update": today() });
    if (b) b.lastUpdate = today();
    toast(`${brandName} → ${stage}`);
  } catch (e) { if (b) b.stage = prev; toast(e.message, "err"); throw e; }
}

async function saveProfileToSheet() {
  saveCfg();
  if (!S.meta.writable) return { local: true };
  return write("saveSettings", { pairs: settingsToPairs() });
}

function randomSecret() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 28);
}

/* ----- clipboard helpers (rich HTML + plain) ----- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.cssText = "position:fixed;left:-9999px";
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
  ta.remove(); return ok;
}
async function copyRich(html, plain) {
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b">${html}</body></html>`;
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([wrapped], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
      return true;
    } catch (_) {}
  }
  try {
    const l = (e) => { e.preventDefault(); e.clipboardData.setData("text/html", wrapped); e.clipboardData.setData("text/plain", plain); };
    document.addEventListener("copy", l);
    const ok = document.execCommand("copy");
    document.removeEventListener("copy", l);
    if (ok) return true;
  } catch (_) {}
  return copyText(plain);
}
