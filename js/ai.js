/* ==========================================================================
   AI engine (runs in the browser, using the signed-in user's own Gemini key)
   • Gemini model discovery + automatic fallback (no model is ever hard-pinned)
   • Brand research, decision-maker research (with page-level verification),
     outreach e-mail drafting
   ========================================================================== */
"use strict";

const GEM_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Only used if the live model list cannot be fetched. */
const GEM_LAST_RESORT = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
const GEM = { dead: new Set(), cool: {}, fails: {}, good: "" };
/** The model that last worked for this key is remembered on this device, so runs start on it instead of re-probing. */
const gmKey = () => "bri.gm.ok." + String(cfg.geminiKey || "").slice(-8);
function gmLoad() {
  try {
    const c = JSON.parse(localStorage.getItem(gmKey()) || "null");
    if (c && Date.now() - c.t < 7 * 864e5) { if (!GEM.good) GEM.good = c.good || ""; (c.dead || []).forEach((m) => GEM.dead.add(m)); }
  } catch (_) {}
}
function gmSave() { try { localStorage.setItem(gmKey(), JSON.stringify({ t: Date.now(), good: GEM.good, dead: [...GEM.dead] })); } catch (_) {} }

/* ------------------------------- model discovery ------------------------------- */
function rankModels(names) {
  const usable = [...new Set(names)].filter((n) => /^gemini-/.test(n) && !/(embedding|aqa|imagen|veo|tts|image|live|audio|robotics|computer-use|learnlm|vision|-exp|customtools|thinking)/i.test(n));
  const key = (n) => {
    const fam = /flash-lite/.test(n) ? 0 : /flash/.test(n) ? 1 : /pro/.test(n) ? 2 : 3; // lightest / fastest first
    const v = parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
    return [fam, /preview/.test(n) ? 1 : 0, /-\d{3}$|-\d{2}-\d{2}$|-\d{4}$/.test(n) ? 1 : 0, /-latest$/.test(n) ? 1 : 0, -v];
  };
  return usable.sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return a.localeCompare(b); }).slice(0, 12);
}

function geminiKeyError(status, msg) {
  const e = new Error(/not been used|disabled|enable/i.test(msg || "")
    ? "The Generative Language API is not enabled for this key's Google project. Create the key in Google AI Studio (aistudio.google.com/apikey) and try again."
    : `Google rejected this Gemini API key (${status}). Copy it again from Google AI Studio → Get API key.`);
  e.keyProblem = true; return e;
}

/** Lists the models THIS key can actually call, best first. Cached per session. */
async function gemModels(key, force) {
  const ck = "bri.gm." + key.slice(-8);
  if (!force) { try { const c = JSON.parse(sessionStorage.getItem(ck) || "null"); if (c && Date.now() - c.t < 6 * 3600e3 && c.names.length) return c.names; } catch (_) {} }
  let names = [];
  try {
    let tok = "";
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${GEM_BASE}/models?pageSize=100${tok ? "&pageToken=" + encodeURIComponent(tok) : ""}`, { headers: { "x-goog-api-key": key } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 400 || r.status === 401 || r.status === 403) throw geminiKeyError(r.status, (d.error && d.error.message) || "");
        break;
      }
      names.push(...(d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => String(m.name).replace(/^models\//, "")));
      tok = d.nextPageToken; if (!tok) break;
    }
  } catch (e) { if (e.keyProblem) throw e; }
  names = rankModels(names);
  if (!names.length) names = [...GEM_LAST_RESORT];
  try { sessionStorage.setItem(ck, JSON.stringify({ t: Date.now(), names })); } catch (_) {}
  return names;
}

async function candidateModels(key) {
  const listed = await gemModels(key);
  gmLoad();
  const order = [GEM.good && listed.includes(GEM.good) ? GEM.good : "", ...listed].filter(Boolean);
  return [...new Set(order)];
}

/* ------------------------------------ calls ------------------------------------ */
function classify(status, msg) {
  if (/api key|api_key/i.test(msg) && (status === 400 || status === 401 || status === 403)) return "key";
  if (status === 404 || /no longer available|not found|is not supported for|deprecated|not available to new/i.test(msg)) return "gone";
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return "quota";
  if (status === 400 && /tool|search|grounding|google_search/i.test(msg)) return "nosearch";
  if (status >= 500 || /overloaded|unavailable|try again/i.test(msg)) return "busy";
  return "other";
}

async function callGeminiOnce(model, prompt, { search, json, temperature, maxOutputTokens, timeoutMs = 60000 }) {
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: temperature ?? 0.3, maxOutputTokens: maxOutputTokens || 4096 } };
  if (search) body.tools = [{ google_search: {} }];
  if (json && !search) body.generationConfig.responseMimeType = "application/json"; // JSON mode can't be combined with search grounding
  let resp;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), Math.max(3000, timeoutMs));
  try {
    resp = await fetch(`${GEM_BASE}/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.geminiKey }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (err) { clearTimeout(timer); const e = new Error(err && err.name === "AbortError" ? "timed out" : "Couldn't reach Gemini (network)."); e.kind = err && err.name === "AbortError" ? "timeout" : "busy"; throw e; }
  clearTimeout(timer);
  if (!resp.ok) {
    let msg = ""; try { msg = (await resp.json()).error.message; } catch (_) {}
    const e = new Error(msg || `HTTP ${resp.status}`); e.status = resp.status; e.kind = classify(resp.status, msg || ""); throw e;
  }
  const data = await resp.json();
  const cand = data.candidates && data.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || "").join("");
  const chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  return { text, finishReason: cand && cand.finishReason, sources: chunks.map((c) => ({ uri: (c.web && c.web.uri) || "", title: (c.web && c.web.title) || "" })).filter((s) => s.uri) };
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.search(/[\[{]/); if (start < 0) return null;
  const close = cleaned[start] === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(close); if (end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) { return null; }
}

/**
 * Runs a prompt on the best available model and falls back automatically:
 * model retired / unsupported → next model · quota → next model · search unsupported → plain.
 * Returns { data, sources, grounded, model, tried }.
 */
async function gemini(prompt, opts = {}) {
  if (!cfg.geminiKey) { const e = new Error("No Gemini API key. Add yours in Setup → Gemini."); e.code = "nokey"; throw e; }
  const { search = false, allowUngrounded = true, expect = "json", deadline = 0 } = opts;
  const models = await candidateModels(cfg.geminiKey);
  const tried = [];
  const left = () => (deadline ? deadline - Date.now() : 1e9);
  outer: for (const model of models) {
    if (GEM.dead.has(model) || (GEM.cool[model] || 0) > Date.now()) continue;
    for (const useSearch of search ? (allowUngrounded ? [true, false] : [true]) : [false]) {
      if (left() < 4000) break outer;
      try {
        const r = await callGeminiOnce(model, prompt, { ...opts, search: useSearch, json: expect === "json", timeoutMs: Math.min(opts.callTimeout || 60000, left()) });
        let data = r.text;
        if (expect !== "text") { data = extractJson(r.text); if (!data) { const e = new Error(`returned no usable JSON (${r.finishReason || "unknown"})`); e.kind = "badjson"; throw e; } }
        if (GEM.good !== model) { GEM.good = model; gmSave(); }
        GEM.fails[model] = 0;
        return { data, sources: r.sources, grounded: useSearch, model, tried };
      } catch (err) {
        tried.push({ model, why: err.kind === "gone" ? "retired / unavailable" : err.kind === "quota" ? "quota reached" : err.kind === "nosearch" ? "search not supported" : err.kind === "busy" ? "busy" : err.kind === "timeout" ? "too slow" : err.kind === "badjson" ? "bad output" : String(err.message).slice(0, 90), kind: err.kind });
        if (err.kind === "key") throw geminiKeyError(err.status, err.message);
        if (err.kind === "gone") { GEM.dead.add(model); if (GEM.good === model) GEM.good = ""; gmSave(); continue outer; }
        if (err.kind === "quota") { GEM.cool[model] = Date.now() + 60000; if (useSearch && allowUngrounded) continue; continue outer; }
        // a model that keeps failing is parked for 10 min so it is not retried on every run
        if ((GEM.fails[model] = (GEM.fails[model] || 0) + 1) >= 2) { GEM.cool[model] = Date.now() + 600000; GEM.fails[model] = 0; }
        if (err.kind === "busy") await new Promise((r) => setTimeout(r, 500));
        if (err.kind === "timeout" || err.kind === "badjson" || err.kind === "nosearch") continue outer;
      }
    }
  }
  if (deadline && left() < 4000) { const e = new Error("Gemini took too long to answer (time limit reached)."); e.code = "timeout"; e.tried = tried; throw e; }
  const allQuota = tried.length && tried.every((t) => t.kind === "quota");
  const e = new Error(allQuota
    ? "Gemini quota is used up on every available model. Wait a minute and retry, or enable billing for this key in Google AI Studio."
    : `No Gemini model could complete the request. Tried: ${[...new Set(tried.map((t) => `${t.model} (${t.why})`))].slice(0, 5).join(", ") || "none available"}.`);
  e.code = "gemini"; throw e;
}

/** Setup → "Save & test": discovers models, makes a tiny call, reports what was auto-selected. */
async function testGemini() {
  const names = await gemModels(cfg.geminiKey, true);
  GEM.dead.clear(); GEM.cool = {}; GEM.fails = {}; GEM.good = ""; gmSave();
  const r = await gemini('Reply with exactly this JSON and nothing else: {"ok": true}', { search: false, temperature: 0, maxOutputTokens: 256 });
  const skipped = r.tried.filter((t) => t.kind === "gone" || t.kind === "quota").map((t) => t.model);
  return { model: r.model, available: names.length, skipped };
}

/* -------------------------------- grounding sources -------------------------------- */
async function resolveSources(sources, limit = 12) {
  const list = (sources || []).slice(0, limit);
  const redirects = list.filter((s) => /vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(s.uri));
  const map = {};
  if (redirects.length && cfg.bridgeUrl) {
    try { const r = await bridgeCall({ action: "resolveUrls", urls: redirects.map((s) => s.uri) }); (r.urls || []).forEach((x) => (map[x.url] = x.resolved)); } catch (_) {}
  }
  return list.map((s) => ({ url: map[s.uri] || s.uri, title: s.title || "" }));
}
function sameUrl(a, b) {
  const n = (u) => String(u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return n(a) && n(a) === n(b);
}
/** Keep a model-supplied URL only if search really returned it; else fall back to a source from the same publisher. */
function verifyUrl(url, sourceName, resolved) {
  if (url && resolved.some((s) => sameUrl(s.url, url))) return url;
  const name = String(sourceName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (name.length > 3) {
    const hit = resolved.find((s) => { const t = (s.title || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return t && (t.includes(name) || name.includes(t)); });
    if (hit) return hit.url;
  }
  return "";
}
function companyBlurb(p = {}) {
  const services = Array.isArray(p.services) && p.services.length ? p.services : ["Visual Merchandising (VM)", "Sales Force Outsourcing (SFO) / Promoter Management"];
  return { company: p.companyName || "our company", website: p.companyWebsite || "", services, servicesText: services.join("; "), pitch: p.pitch || "", proof: p.proofPoints || "", sectors: p.sectors || "Consumer Electronics", geography: p.geography || "India" };
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; } };

/* =============================== contact-detail rules =============================== */
const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|rediffmail|aol|icloud|proton|protonmail)\./i;
const GENERIC_LOCAL = /^(info|information|contact|contactus|contact[-_.]us|care|cares|[a-z]*care|customer[-_.]?(care|service|support|relations)?|[a-z]*support|help|helpdesk|[a-z]*help|hello|hi|sales|enquir[a-z]*|inquir[a-z]*|quer(y|ies)|feedback|service|services|mail|office|admin|administrator|webmaster|marketing|press|media|pr|corporate|corp|investor[s]?|ir|hr|career[s]?|jobs|recruit[a-z]*|complaint[s]?|grievance[s]?|noreply|no[-_.]reply|donotreply|reception|general|team|tradeenquiry|dealer[s]?|franchise|b2b|bulk|partner[s]?|connect|reach|talk|desk)$/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const firstEmailIn = (s) => { const m = String(s || "").match(EMAIL_RE); return m ? m[0] : ""; };
const isGenericEmail = (e) => { e = String(e || "").trim(); if (!e) return false; const local = e.split("@")[0]; return FREE_MAIL.test(e) || GENERIC_LOCAL.test(local); };
const digitsOf = (p) => String(p || "").replace(/\D/g, "");
function isGenericPhone(p) {
  const raw = String(p || "").trim(); if (!raw) return false;
  const d = digitsOf(raw), nat = d.replace(/^(0091|91|0)/, "");
  if (/^(1800|1860|1900|140|1600)/.test(nat) || /^(1800|1860)/.test(d)) return true; // toll-free / premium / telemarketing
  if (nat.length < 8) return true;
  if (/customer|care|helpline|toll|support|toll free|call centre|call center/i.test(raw)) return true;
  return false;
}
function nameTokens(name) {
  return String(name || "").toLowerCase().replace(/\b(mr|mrs|ms|dr|shri|smt|prof)\b\.?/g, " ").split(/[^a-z]+/).filter((t) => t.length > 1);
}
/** A personal address contains the person's first or last name (or first-initial + surname). */
function emailMatchesPerson(email, name) {
  const local = String(email).split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const t = nameTokens(name); if (!t.length || !local) return false;
  const first = t[0], last = t[t.length - 1];
  return (first.length >= 3 && local.includes(first)) || (last.length >= 3 && local.includes(last)) || (last.length >= 3 && local.includes(first[0] + last)) || (first.length >= 3 && local.includes(last[0] + first));
}
/** Removes customer-care / generic details from an existing contact row. Returns the cleaned fields or null. */
function scrubGeneric(c) {
  const em = c["Official Email (public only)"], ph = c["Official Contact Number (public only)"];
  const out = {};
  const emails = String(em || "").split(/[;,/\s]+/).filter((x) => EMAIL_RE.test(x));
  if (emails.length && emails.every((x) => isGenericEmail(x))) out["Official Email (public only)"] = "";
  if (ph && isGenericPhone(ph)) out["Official Contact Number (public only)"] = "";
  return Object.keys(out).length ? out : null;
}

const linkedinProfile = (url) => { const m = String(url || "").match(/linkedin\.com\/in\/([^/?#\s]+)/i); return m ? `https://www.linkedin.com/in/${m[1].replace(/\/+$/, "")}/` : ""; };

/** Fetches pages in Google's cloud (via the user's own bridge) and reports which needles appear on each. */
async function checkPages(urls, needles, timeoutMs = 15000) {
  const u = [...new Set(urls.filter((x) => /^https?:\/\//i.test(x)))].slice(0, 8);
  if (!u.length) return { available: true, results: [] };
  try { const r = await Promise.race([bridgeCall({ action: "checkPages", urls: u, needles }), new Promise((_, rej) => setTimeout(() => rej(new Error("page check timed out")), timeoutMs))]); return { available: true, results: r.results || [] }; }
  catch (e) { if (/unknown action/i.test(e.message)) return { available: false, results: [] }; return { available: true, results: [], error: e.message }; }
}

/* ================================== contact research ================================== */
const DEFAULT_ROLES = [
  "Head of Marketing / CMO / VP Marketing / Director Marketing",
  "Head of Trade Marketing / Retail Marketing / Channel Marketing",
  "Head of Sales / VP Sales / National Sales Head / Retail Sales Head",
  "Head of Retail Operations / Retail Execution / Customer Experience",
  "Business Head / Managing Director / Country Head (only if the above cannot be found)",
];

async function researchContactAI(name, { profile, recommendedDept, mode = "update" } = {}) {
  const co = companyBlurb(profile);
  const roles = profile && profile.buyerRoles ? String(profile.buyerRoles).split("|").map((s) => s.trim()).filter(Boolean) : DEFAULT_ROLES;
  const todayStr = new Date().toISOString().slice(0, 10);
  const T0 = Date.now(), HARD = T0 + 60000; // whole contact search is capped at 1 minute

  /* ---- pass 1: who is the buyer? (names & roles only — no contact details) ---- */
  const p1 = `You are a B2B sales-intelligence researcher working for ${co.company}, which sells: ${co.servicesText}.
Today is ${todayStr}. Find the people at "${name}" (${co.geography} operations) who would decide on or influence buying those services.
${recommendedDept ? `Preferred department: ${recommendedDept}.` : ""}

Role priority (search in this order):
${roles.map((r, i) => `${i + 1}. ${r}`).join("\n")}

How to search (use Google Search):
- "${name}" ${co.geography} "Head of Marketing" OR "VP Sales" OR "Trade Marketing" OR "Retail" OR "Chief Marketing Officer" appointed OR joins OR elevated
- Business press: ET BrandEquity, afaqs, Exchange4Media, Storyboard18, Mint, Economic Times, Business Standard, Indian Retailer, company press releases, the brand's own leadership / newsroom pages.
- LinkedIn: site:linkedin.com/in "<Full Name>" "${name}"

STRICT RULES
- Report ONLY people whose NAME and CURRENT designation at ${name} appear on a page you found. Never invent a name, role or URL.
- The role must be current: the supporting page must be from the last 12 months, or the person must still be listed on the company's own site. If there was a recent leadership change, return the NEW person. Ignore people who have left.
- Do NOT include any e-mail address or phone number in this step.
- sourceUrl = the exact page where the name and role appear. sourceDate = that page's publication date (YYYY-MM-DD) if visible, else "".
- Up to 3 people, best buyer first. If you cannot verify anyone, return an empty list.

Return ONLY JSON:
{ "people": [ { "name": "", "designation": "", "department": "", "location": "city, state", "linkedinUrl": "", "sourceUrl": "", "sourceDate": "", "evidence": "1-2 sentences: where this was found and how recent", "confidence": "High|Medium|Low" } ] }`;

  let o1;
  try { o1 = await gemini(p1, { search: true, allowUngrounded: false, temperature: 0.1, maxOutputTokens: 4000, deadline: T0 + 38000, callTimeout: 30000 }); }
  catch (e) { if (e.code === "timeout") return { ok: true, found: false, contacts: [], note: "Search timed out after 1 minute — nothing was saved. Please try again." }; throw e; }
  let resolved = await resolveSources(o1.sources, 14);
  const people = (Array.isArray(o1.data.people) ? o1.data.people : Array.isArray(o1.data.contacts) ? o1.data.contacts : [])
    .filter((p) => p && String(p.name || "").trim().split(/\s+/).length >= 2).slice(0, 3);
  if (!people.length) return { ok: true, found: false, contacts: [], note: "No verifiable decision-maker found. Try again later or add one manually." };

  /* ---- pass 2: public, individual contact details for the top 2 people ---- */
  let verifyAvailable = true;
  const details = await Promise.all(people.slice(0, 2).map(async (p) => {
    const d = { email: "", phone: "", emailNote: "", phoneNote: "" };
    if (HARD - Date.now() < 8000) { d.emailNote = "Ran out of time for the contact-detail search."; return d; }
    try {
      const p2 = `Find the OFFICIAL, INDIVIDUAL, publicly published business contact details of ${p.name}, ${p.designation || "leader"} at ${name}.
Search for: "${p.name}" ${name} email · "${p.name}" ${name} contact · press releases that list this person as the media/business contact · the company's leadership / team page · speaker or panel bios · regulatory filings (BSE / NSE / MCA) signed by this person · industry-award nominations.

STRICT RULES
- Return an e-mail ONLY if the full address is printed on a web page you found AND it belongs to this person individually (for example firstname.lastname@company.com). NEVER guess, NEVER infer an address pattern from other employees, NEVER use a pattern like first.last@domain without seeing it printed.
- Return a phone number ONLY if it is this person's own direct line or mobile number, printed on a page.
- NEVER return: customer-care / helpline / toll-free (1800, 1860) numbers, switchboard or board lines, shared mailboxes such as info@, care@, customercare@, support@, sales@, contact@, hello@, marketing@, press@, enquiry@, or any PR-agency or department contact.
- For every value give the exact URL of the page where it is printed.
- If you cannot find it, return empty strings. Empty is the correct answer when unsure.

Return ONLY JSON:
{ "email": "", "emailSource": "", "emailType": "personal|generic|none", "phone": "", "phoneSource": "", "phoneType": "direct|mobile|generic|toll_free|none" }`;
      const o2 = await gemini(p2, { search: true, allowUngrounded: false, temperature: 0, maxOutputTokens: 1500, deadline: HARD - 9000, callTimeout: 25000 });
      const more = await resolveSources(o2.sources, 12);
      resolved = [...resolved, ...more];
      const r = o2.data || {};
      let email = firstEmailIn(r.email), phone = String(r.phone || "").trim();
      if (email && (r.emailType !== "personal" || isGenericEmail(email) || !emailMatchesPerson(email, p.name))) { d.emailNote = "A generic or non-personal address was rejected."; email = ""; }
      if (phone && (!["direct", "mobile"].includes(r.phoneType) || isGenericPhone(phone))) { d.phoneNote = "A generic / customer-care number was rejected."; phone = ""; }
      if (email || phone) {
        // proof: the value must literally be printed on a page we can fetch (cited page first, then other search results)
        const urls = [r.emailSource, r.phoneSource, p.sourceUrl, ...resolved.map((s) => s.url)].filter(Boolean);
        const chk = await checkPages(urls, [email, phone, nameTokens(p.name).slice(-1)[0] || p.name], Math.max(4000, Math.min(12000, HARD - Date.now())));
        if (!chk.available) { verifyAvailable = false; email = ""; phone = ""; }
        else {
          const hitE = email && chk.results.find((x) => x.found && x.found[0]);
          const hitP = phone && chk.results.find((x) => x.found && x.found[1] && x.found[2]);
          if (email && hitE) { d.email = email; d.emailNote = `Verified on ${hostOf(hitE.url)}`; } else if (email) d.emailNote = "An address was suggested but could not be confirmed on any page, so it was not saved.";
          if (phone && hitP) { d.phone = phone; d.phoneNote = `Verified on ${hostOf(hitP.url)}`; } else if (phone) d.phoneNote = "A number was suggested but could not be confirmed on a page that names this person, so it was not saved.";
        }
      }
    } catch (e) { if (e.keyProblem) throw e; d.emailNote = e.code === "timeout" ? "Contact-detail search timed out." : "Contact-detail search was unavailable."; }
    return d;
  }));

  /* ---- shape + save ---- */
  const verifiedLinkedIn = resolved.map((s) => linkedinProfile(s.url)).filter(Boolean);
  const saved = [];
  for (let i = 0; i < people.length; i++) {
    const c = people[i], d = details[i] || { email: "", phone: "", emailNote: "", phoneNote: "" };
    const parts = nameTokens(c.name).filter((x) => x.length > 2);
    const raw = linkedinProfile(c.linkedinUrl);
    let li = "", liVerified = false;
    if (raw && verifiedLinkedIn.includes(raw)) { li = raw; liVerified = true; }
    else { const byName = verifiedLinkedIn.find((u) => parts.some((x) => u.toLowerCase().includes(x))); if (byName) { li = byName; liVerified = true; } }
    if (!li) li = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([c.name, name].join(" "))}`;

    const srcOk = c.sourceUrl && /^https?:\/\//.test(c.sourceUrl);
    const status = [
      c.evidence || "",
      srcOk ? `Source: ${c.sourceUrl}${c.sourceDate ? " (" + c.sourceDate + ")" : ""}.` : "",
      d.email ? `Email ${d.emailNote.toLowerCase()}.` : "No individual email is publicly published — reach out via LinkedIn.",
      d.phone ? `Phone ${d.phoneNote.toLowerCase()}.` : "",
      !verifyAvailable && i < 2 ? "Update your bridge script (Setup) to enable email/phone verification." : "",
      liVerified ? "LinkedIn profile found in search." : "LinkedIn link is a people-search (profile not confirmed).",
      `Confidence: ${c.confidence || "Low"}. Researched ${todayStr} — verify before outreach.`,
    ].filter(Boolean).join(" ");

    const row = {
      "Decision Maker Name": c.name || "", "Designation": c.designation || "", "Department": c.department || "", "LinkedIn Profile": li,
      "Official Email (public only)": d.email, "Official Contact Number (public only)": d.phone,
      "Company Website": "", "Office Location": c.location || "", "Research Status": status,
    };
    if (i === 0 && mode === "update") await bridgeUpsert("Contacts", "Brand", name, row);
    else await bridgeCall({ action: "appendRows", sheet: "Contacts", rows: [{ Brand: name, ...row }], dedupeOn: ["Brand", "Decision Maker Name"] });
    saved.push({ ...row, Brand: name, _linkedinVerified: liVerified, _confidence: c.confidence || "Low", _emailVerified: !!d.email, _phoneVerified: !!d.phone });
  }
  return { ok: true, found: true, contacts: saved, grounded: o1.grounded, model: o1.model, verifyAvailable };
}

/* ================================== brand research ================================== */
async function researchBrandAI(name, { profile, context, brandInfo, write: doWrite = true } = {}) {
  const co = companyBlurb(profile);
  const today_ = new Date().toISOString().slice(0, 10);
  const prompt = `You are a B2B sales-intelligence analyst working for ${co.company}${co.website ? ` (${co.website})` : ""}.
${co.company} sells: ${co.servicesText}.
${co.pitch ? `Positioning: ${co.pitch}` : ""}

TASK: Research the brand "${name}" in ${co.geography} (sector focus: ${co.sectors}). Use Google Search. Today is ${today_}.
Find REAL, RECENT (preferably the last 90 days) moves by this brand that give ${co.company} a reason to reach out about: ${co.servicesText}.
Look for: new/expanded retail stores, exclusive/experience stores, distribution or channel changes, product launches that need in-store demo/merchandising, festive or seasonal campaigns, leadership changes in sales/marketing/retail, capex or growth targets, retail hiring.
${brandInfo && brandInfo.sector ? `Already known: sector=${brandInfo.sector}; segment=${brandInfo.segment || ""}.` : ""}
${context && context.headline ? `Known trigger: "${context.headline}" — ${context.summary || ""}` : ""}

STRICT RULES
- Report only facts you found in search results. If you cannot verify something write "Not publicly confirmed". Never invent headlines, dates, numbers, people or URLs.
- Every signal must come from a real article or official page. Give its publication name and its exact URL from the search results. Prefer primary sources (company newsroom, regulatory filing) and established business press.
- Dates as YYYY-MM-DD (use YYYY-MM-01 if only a month is known). A date must never be after ${today_}. Skip rumours, forecasts presented as facts and anything older than 12 months.
- Do not report a leadership change unless the article states the person has taken, or will take, the role; give the effective date in the summary.
- recommendedService must be one of: ${co.services.map((s) => `"${s}"`).join(", ")} (or a combination joined with " + ").
- Signal categories allowed: ${SIGNAL_TYPES.join(", ")}.

Return ONLY a JSON object, no markdown, in exactly this shape:
{
  "profile": { "sector": "", "segment": "", "priorityTier": "High|Medium|Low", "website": "bare domain e.g. example.com", "hqIndia": "city, state", "statusNotes": "1-2 sentences: why this brand matters to ${co.company} right now" },
  "signals": [ { "date": "YYYY-MM-DD", "headline": "", "category": "", "source": "publication", "url": "", "summary": "2 sentences, facts only", "whyItMatters": "1 sentence on the in-store / field-force implication" } ],
  "opportunities": [ { "type": "signal category", "businessImpact": "what is happening and its scale", "opportunityForUs": "specific way ${co.company} can help", "recommendedService": "", "contactDept": "e.g. Retail Operations / Trade Marketing / Sales", "nextAction": "one concrete next step", "whyNow": "timing trigger", "priorityScore": 1-5, "confidenceScore": 1-5, "linkedSignal": 1 } ]
}
Give 2-5 signals (newest first) and 1-3 opportunities ranked best first. If nothing recent is verifiable return an empty "signals" array and one low-confidence opportunity.`;

  const out = await gemini(prompt, { search: true, temperature: 0.2, maxOutputTokens: 6000 });
  const r = out.data, grounded = out.grounded, model = out.model;
  const resolved = await resolveSources(out.sources, 12);
  const warning = grounded ? "" : "Search grounding was unavailable (quota). Results are model knowledge only — verify before outreach.";

  const p = r.profile || {};
  const signals = (Array.isArray(r.signals) ? r.signals : []).slice(0, 5)
    .filter((s) => { const d = parseDate(s.date); return !d || d.getTime() <= Date.now() + 864e5; })
    .map((s) => ({ ...s, url: grounded ? verifyUrl(s.url, s.source, resolved) : "" }));
  const opps = (Array.isArray(r.opportunities) ? r.opportunities : []).slice(0, 3);
  const clamp = (v, d) => Math.max(1, Math.min(5, Math.round(Number(v)) || d));

  const brandRow = {
    "Brand": name, "Sector": p.sector || (brandInfo && brandInfo.sector) || co.sectors.split(/[|,]/)[0].trim(), "Segment": p.segment || (brandInfo && brandInfo.segment) || "",
    "Priority Tier": ["High", "Medium", "Low"].includes(p.priorityTier) ? p.priorityTier : (brandInfo && brandInfo.tier) || "Medium",
    "Website": (p.website || (brandInfo && brandInfo.website) || "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
    "HQ / India Office": p.hqIndia || (brandInfo && brandInfo.hq) || "", "Status Notes": p.statusNotes || "", "Date Added": today_,
  };
  const pipelineRow = { "Brand": name, "Stage": "Prospect", "Owner": (profile && profile.ownerName) || "", "Last Update": today_, "Next Follow-up Date": "", "Notes": "Added with AI research — verify before outreach." };
  const newsRows = signals.filter((s) => s.headline).map((s) => ({ "Brand": name, "Date": s.date || today_, "Headline": s.headline, "Category": SIGNAL_TYPES.includes(s.category) ? s.category : "Other", "AI Summary": s.summary || "", "Source": s.source || "", "URL": s.url || "", "Why It Matters": s.whyItMatters || "" }));
  const oppRows = opps.filter((o) => o.opportunityForUs || o.businessImpact).map((o) => ({
    "Brand": name, "Opportunity Type": o.type || "Retail Expansion", "Business Impact": o.businessImpact || "",
    "Opportunity for Channelplay": [o.opportunityForUs, o.whyNow ? `Why now: ${o.whyNow}` : ""].filter(Boolean).join(" "),
    "Confidence Score (1-5)": clamp(o.confidenceScore, 3), "Priority Score (1-5)": clamp(o.priorityScore, 3), "Recommended Service": o.recommendedService || co.services[0],
    "Recommended Contact Department": o.contactDept || "Retail Operations / Trade Marketing", "Suggested Next Action": o.nextAction || "",
    "Linked News Ref": o.linkedSignal && newsRows[o.linkedSignal - 1] ? newsRows[o.linkedSignal - 1].Headline : "",
  }));

  let written = null;
  if (doWrite) {
    const add = await bridgeCall({ action: "addBrand", brand: brandRow, pipeline: pipelineRow });
    const news = newsRows.length ? await bridgeCall({ action: "appendRows", sheet: "News feed", rows: newsRows, dedupeOn: ["Brand", "Headline"] }) : { added: 0 };
    const opp = oppRows.length ? await bridgeCall({ action: "appendRows", sheet: "Opportunities", rows: oppRows, dedupeOn: ["Brand", "Opportunity Type", "Suggested Next Action"] }) : { added: 0 };
    written = { brandAdded: add.brandAdded !== false, news: news.added ?? newsRows.length, opportunities: opp.added ?? oppRows.length };
  }
  return { ok: true, brand: brandRow, signals: newsRows, opportunities: oppRows, grounded, model, warning, written };
}

/* ================================== e-mail drafting ================================== */
async function siteContext(website) {
  if (!/^https?:\/\//i.test(website || "") || !cfg.bridgeUrl) return "";
  const base = website.replace(/\/+$/, "");
  try {
    const r = await bridgeCall({ action: "fetchText", urls: [base + "/", base + "/success-stories", base + "/services"], max: 3000 });
    return (r.pages || []).map((p) => `--- ${p.url} ---\n${p.text}`).join("\n\n");
  } catch (_) { return ""; }
}

async function generateEmailAI({ brand, sector, segment, topOpportunity, recentNews, contactName, contactDesignation, profile, sender }) {
  const co = companyBlurb(profile);
  const site = await siteContext(co.website);
  const news = (recentNews || []).slice(0, 6).map((n) => `- [${n.date}] ${n.headline} (${n.source || "news"}): ${n.summary || ""}`).join("\n") || "No recent news on file.";
  const opp = topOpportunity ? `Signal: ${topOpportunity.type}\nImpact: ${topOpportunity.businessImpact}\nHow we help: ${topOpportunity.opportunityForChannelplay}\nService: ${topOpportunity.recommendedService}\nNext action: ${topOpportunity.nextAction}` : "None scored yet — infer a sensible angle from the news only; do not invent facts.";
  const recipient = contactName ? `${contactName}${contactDesignation ? `, ${contactDesignation}` : ""}` : "the Head of Marketing / Sales (greet as \"Hello [Name],\")";
  const prompt = `You write cold-outreach emails that senior Indian marketing and sales leaders actually reply to.
SENDER: ${(sender && sender.senderName) || "the sender"}${sender && sender.senderDesignation ? `, ${sender.senderDesignation}` : ""} at ${co.company}.
${co.company} offers: ${co.servicesText}.
${co.pitch ? `Positioning: ${co.pitch}` : ""}
${co.proof ? `PROOF POINTS (the only capability claims you may make): ${co.proof}` : ""}

RECIPIENT: ${recipient}
BRAND: ${brand} (sector: ${sector || "n/a"}; segment: ${segment || "n/a"})

RECENT SIGNALS ABOUT ${brand}:
${news}

TOP OPPORTUNITY:
${opp}

SENDER WEBSITE CONTEXT (use for capabilities and case studies; do not copy marketing fluff):
${site || "(not available)"}

WRITING RULES
- Greeting: "Hello <FirstName>," (never "Hi", never initials-only). If no name: "Hello [Name],".
- Open with ONE specific, true observation about ${brand} taken from the signals above (not generic congratulations).
- Connect it to a concrete in-store / field-force consequence (shelf share, demo quality, promoter coverage, launch-readiness, Tier-2/3 rollout) — hypotheses phrased as hypotheses.
- Only claim capabilities that appear in the proof points or website context. Never invent client names, numbers or results.
- Tone: confident, warm, zero hype, no buzzword stacking. Short sentences. Indian business English.
- Length: hook (1-2 sentences) + context (≤70 words) + value (≤70 words) + 3 capability bullets (each "Title: one line") + closing (≤30 words) + soft ask for 15 minutes.
- Subject lines: specific to ${brand}, under 70 characters, no clickbait.

Return ONLY JSON:
{ "subject": "", "subjectAlt": "", "hook": "", "context": "", "value": "", "capabilities": ["Title: sentence", "Title: sentence", "Title: sentence"], "closing": "", "softAsk": "", "linkedinNote": "connection request note, max 280 characters, no links", "followUp": "short follow-up email body (≤70 words) to send after 4-5 days, no greeting/signature" }`;
  const out = await gemini(prompt, { search: false, expect: "json", temperature: 0.6, maxOutputTokens: 3500 });
  const d = out.data;
  if (contactName && d.hook) { d.hook = d.hook.replace(/^(?:Hello|Hi|Dear)\s+[^,]+,\s*/i, ""); d.hook = `Hello ${String(contactName).trim().split(/\s+/)[0]}, ${d.hook}`; }
  return { ok: true, ...d, model: out.model };
}
