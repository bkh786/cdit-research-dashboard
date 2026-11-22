// Shared helpers for every serverless function.
//
// A "workspace" is the per-user connection the dashboard sends with each request:
//   x-bridge-url / x-bridge-secret : the user's own Apps Script bridge (their sheet)
//   x-gemini-key / x-gemini-model  : the user's own Gemini key (optional)
// If a header is missing we fall back to the server defaults (Vercel env vars),
// so the original single-owner deployment keeps working unchanged.

const BRIDGE_URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.\-_]+\/|macros\/)s\/[A-Za-z0-9_\-]+\/exec$/;

const crypto = require("crypto");

/* ---------------- master mode (users, roles, workspaces live in the set-up-master sheet) ---------------- */

function masterMode() { return !!process.env.MASTER_BRIDGE_URL; }

async function master(body) {
  const url = process.env.MASTER_BRIDGE_URL;
  if (!url) { const e = new Error("MASTER_BRIDGE_URL is not configured on the server."); e.status = 500; throw e; }
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, secret: process.env.MASTER_BRIDGE_SECRET || "" }),
    redirect: "follow",
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch (_) {
    const e = new Error("The master sheet bridge did not return JSON. Check MASTER_BRIDGE_URL and that the script is deployed for “Anyone”.");
    e.status = 502; throw e;
  }
  if (data && data.error) { const e = new Error(data.error); e.status = /unauthorized/i.test(data.error) ? 401 : 400; throw e; }
  return data;
}

function sessionKey() { return process.env.SESSION_SECRET || process.env.MASTER_BRIDGE_SECRET || ""; }
const b64u = (b) => Buffer.from(b).toString("base64url");

function signToken(user, hours) {
  const key = sessionKey();
  if (!key) { const e = new Error("SESSION_SECRET is not configured on the server."); e.status = 500; throw e; }
  const payload = b64u(JSON.stringify({ e: user.email, exp: Date.now() + (hours || 12) * 3600 * 1000 }));
  const sig = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return payload + "." + sig;
}

function verifyToken(token) {
  const key = sessionKey();
  if (!key || !token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const good = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch (_) { return null; }
}

function bearer(req) {
  const h = String((req.headers || {}).authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

/** Authorizes the request. Master mode: signed session token + live check of the user in the master sheet. */
async function authorize(req, res) {
  if (masterMode()) {
    const p = verifyToken(bearer(req));
    if (!p) { res.status(401).json({ error: "Unauthorized" }); return false; }
    try {
      const { user } = await master({ action: "getUser", email: p.e });
      req.user = user;
      return true;
    } catch (_) { res.status(401).json({ error: "Unauthorized" }); return false; }
  }
  const supplied = req.headers["x-dashboard-password"] || (req.query && req.query.password);
  if (!process.env.DASHBOARD_PASSWORD || supplied !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

async function requireAdmin(req, res) {
  if (!(await authorize(req, res))) return false;
  if (!req.user || !req.user.isAdmin) { res.status(403).json({ error: "Administrator access required." }); return false; }
  return true;
}

const wsCache = new Map();
async function masterWorkspace(email) {
  const hit = wsCache.get(email);
  if (hit && hit.t > Date.now() - 30000) return hit.w;
  const { workspace: w } = await master({ action: "getWorkspace", email });
  wsCache.set(email, { t: Date.now(), w });
  return w;
}
function clearWsCache(email) { if (email) wsCache.delete(email); else wsCache.clear(); }

async function workspace(req) {
  if (masterMode() && req.user) {
    const w = (await masterWorkspace(req.user.email)) || {};
    const bu = String(w["Bridge URL"] || "").trim();
    if (bu && !BRIDGE_URL_RE.test(bu)) {
      const e = new Error("The Bridge URL saved for this workspace is not a valid Apps Script /exec URL. Ask your administrator to fix it.");
      e.status = 400; throw e;
    }
    return {
      custom: true,
      own: true,
      bridgeUrl: String(w["Bridge URL"] || "").trim(),
      bridgeSecret: String(w["Bridge Secret"] || "").trim(),
      geminiKey: String(w["Gemini API Key"] || "").trim() || process.env.GEMINI_API_KEY || "",
      geminiModel: String(w["Gemini Model"] || "").trim() || process.env.GEMINI_MODEL || "",
      sheetId: "",
      googleApiKey: "",
      owner: req.user.email,
    };
  }
  return legacyWorkspace(req);
}

function legacyWorkspace(req) {
  const h = req.headers || {};
  const customUrl = String(h["x-bridge-url"] || "").trim();
  const customSecret = String(h["x-bridge-secret"] || "").trim();
  let bridgeUrl = "";
  let bridgeSecret = "";
  let custom = false;

  if (customUrl) {
    // Never forward the server's own secret to a user-supplied URL.
    if (!BRIDGE_URL_RE.test(customUrl)) {
      const e = new Error("Bridge URL must look like https://script.google.com/macros/s/…/exec");
      e.status = 400;
      throw e;
    }
    bridgeUrl = customUrl;
    bridgeSecret = customSecret;
    custom = true;
  } else if (String(h["x-workspace"] || "") === "own") {
    // The user chose "my own workspace" but hasn't connected a sheet yet:
    // never fall back to the shared/server sheet.
    bridgeUrl = "";
  } else {
    bridgeUrl = process.env.APPS_SCRIPT_URL || "";
    bridgeSecret = process.env.APPS_SCRIPT_SECRET || "";
  }

  return {
    custom,
    own: custom || String(h["x-workspace"] || "") === "own",
    bridgeUrl,
    bridgeSecret,
    geminiKey: String(h["x-gemini-key"] || "").trim() || process.env.GEMINI_API_KEY || "",
    geminiModel: String(h["x-gemini-model"] || "").trim() || process.env.GEMINI_MODEL || "",
    sheetId: process.env.GOOGLE_SHEET_ID || "",
    googleApiKey: process.env.GOOGLE_API_KEY || "",
  };
}

async function bridge(ws, body) {
  if (!ws.bridgeUrl) {
    const e = new Error("No Google Sheet is connected yet. Open Setup and connect your sheet.");
    e.status = 400;
    throw e;
  }
  const resp = await fetch(ws.bridgeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, secret: ws.bridgeSecret }),
    redirect: "follow",
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    const e = new Error(
      "The sheet bridge did not return JSON. Re-deploy the Apps Script as a Web app with “Who has access: Anyone”, and make sure you pasted the /exec URL."
    );
    e.status = 502;
    throw e;
  }
  if (data && data.error) {
    const e = new Error(data.error);
    e.status = /unauthorized/i.test(data.error) ? 401 : 400;
    e.bridge = true;
    throw e;
  }
  return data;
}

/** updateRow, falling back to append when no row matched (works with the legacy bridge too). */
async function upsert(ws, sheet, matchColumn, matchValue, updates) {
  try {
    return await bridge(ws, { action: "upsertRow", sheet, matchColumn, matchValue, updates });
  } catch (err) {
    if (!/unknown action/i.test(err.message)) throw err;
  }
  const r = await bridge(ws, { action: "updateRow", sheet, matchColumn, matchValue, updates });
  if (r && (r.updated > 0 || r.updated === true)) return r;
  return bridge(ws, { action: "appendRows", sheet, rows: [{ [matchColumn]: matchValue, ...updates }] });
}

/* ------------------------------- Gemini -------------------------------- */

function modelList(ws) {
  return [...new Set([ws.geminiModel, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"].filter(Boolean))];
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.search(/[\[{]/);
  if (start < 0) return null;
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function callGeminiOnce(ws, model, prompt, { search, json, temperature, maxOutputTokens }) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: temperature ?? 0.3, maxOutputTokens: maxOutputTokens || 4096 },
  };
  if (search) body.tools = [{ google_search: {} }];
  // JSON mode cannot be combined with search grounding.
  if (json && !search) body.generationConfig.responseMimeType = "application/json";

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": ws.geminiKey },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) {
    const t = await resp.text();
    let msg = t;
    try { msg = JSON.parse(t).error.message; } catch (_) {}
    throw new Error(`Gemini (${model}) ${resp.status}: ${msg}`);
  }
  const data = await resp.json();
  const cand = data.candidates && data.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || "").join("");
  const chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  return {
    text,
    finishReason: cand && cand.finishReason,
    sources: chunks.map((c) => ({ uri: (c.web && c.web.uri) || "", title: (c.web && c.web.title) || "" })).filter((s) => s.uri),
  };
}

/**
 * Calls Gemini across fallback models; tries Google-Search grounding first,
 * then (if allowed) an ungrounded call when quota/search fails.
 * Returns { data, sources, grounded, model }.
 */
async function gemini(ws, prompt, opts = {}) {
  if (!ws.geminiKey) {
    const e = new Error("No Gemini API key. Add yours in Setup → AI, or ask the admin to set GEMINI_API_KEY on the server.");
    e.status = 400;
    throw e;
  }
  const { search = false, allowUngrounded = true, expect = "json" } = opts;
  let lastErr = null;
  for (const model of modelList(ws)) {
    const attempts = search ? (allowUngrounded ? [true, false] : [true]) : [false];
    for (const useSearch of attempts) {
      try {
        const r = await callGeminiOnce(ws, model, prompt, { ...opts, search: useSearch, json: expect === "json" });
        if (expect === "text") return { data: r.text, sources: r.sources, grounded: useSearch, model };
        const parsed = extractJson(r.text);
        if (!parsed) throw new Error(`Gemini (${model}) returned no usable JSON (${r.finishReason || "unknown"}).`);
        return { data: parsed, sources: r.sources, grounded: useSearch, model };
      } catch (err) {
        lastErr = err;
        if (/\b(400|401|403)\b/.test(err.message) && /API key|API_KEY|permission/i.test(err.message)) throw err;
        if (/429|RESOURCE_EXHAUSTED|quota/i.test(err.message)) await new Promise((r) => setTimeout(r, 900));
      }
    }
  }
  throw lastErr || new Error("Gemini request failed.");
}

/** Grounding links are vertexaisearch redirects — resolve them to the real article URL. */
async function resolveSources(sources, limit = 10) {
  const out = [];
  const list = (sources || []).slice(0, limit);
  await Promise.all(
    list.map(async (s) => {
      let url = s.uri;
      if (/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(url)) {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 4000);
          const r = await fetch(url, { redirect: "manual", signal: ctl.signal });
          clearTimeout(t);
          const loc = r.headers.get("location");
          if (loc) url = loc;
        } catch (_) {}
      }
      out.push({ url, title: s.title || "" });
    })
  );
  return out;
}

function sameUrl(a, b) {
  const n = (u) => String(u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return n(a) && n(a) === n(b);
}

/** Keep a model-supplied URL only if search actually returned it; else fall back to a source from the same publisher. */
function verifyUrl(url, sourceName, resolved) {
  if (url && resolved.some((s) => sameUrl(s.url, url))) return url;
  const name = String(sourceName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (name.length > 3) {
    const hit = resolved.find((s) => (s.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(name) || name.includes((s.title || "").toLowerCase().replace(/[^a-z0-9]/g, "")));
    if (hit && hit.title) return hit.url;
  }
  return "";
}

function companyBlurb(p = {}) {
  const services = Array.isArray(p.services) && p.services.length ? p.services : ["Visual Merchandising (VM)", "Sales Force Outsourcing (SFO) / Promoter Management"];
  return {
    company: p.companyName || "our company",
    website: p.companyWebsite || "",
    services,
    servicesText: services.join("; "),
    pitch: p.pitch || "",
    proof: p.proofPoints || "",
    sectors: p.sectors || "Consumer Electronics",
    geography: p.geography || "India",
  };
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(err.status || 500).json({ error: err.message || "Request failed" });
    }
  };
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = {
  masterMode, master, signToken, verifyToken, bearer, requireAdmin, clearWsCache,
  authorize, workspace, legacyWorkspace, bridge, upsert, gemini, resolveSources, verifyUrl, sameUrl,
  companyBlurb, handle, escHtml, extractJson,
};
