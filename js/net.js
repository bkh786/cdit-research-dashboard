/* ==========================================================================
   Direct network layer — the browser talks to Google Apps Script web apps
   (your master sheet + your own data sheet) and to Gemini. No server in between,
   so nothing has to be configured on the hosting platform.
   ========================================================================== */
"use strict";

const BRIDGE_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.\-_]+\/|macros\/)s\/[A-Za-z0-9_\-]+\/exec$/;
const tokStore = {
  get: () => { try { return sessionStorage.getItem("bri_tok") || ""; } catch (_) { return ""; } },
  set: (v) => { try { sessionStorage.setItem("bri_tok", v); } catch (_) {} },
  clear: () => { try { sessionStorage.removeItem("bri_tok"); } catch (_) {} },
};

/** POST JSON to an Apps Script /exec URL. "text/plain" keeps it a CORS "simple request" (no preflight). */
async function gasCall(url, body, label) {
  let resp;
  try {
    resp = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" });
  } catch (_) {
    const e = new Error(`Couldn't reach the ${label}. Check your internet connection and that the Apps Script is deployed as a Web app with “Who has access: Anyone” (not “Anyone with Google account”).`);
    e.code = "network"; throw e;
  }
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch (_) {
    const e = new Error(`The ${label} did not return JSON. Re-deploy the Apps Script as a Web app with “Who has access: Anyone” and use the /exec URL.`);
    e.code = "badjson"; throw e;
  }
  if (data && data.error) {
    const e = new Error(data.error);
    e.code = /^unauthorized/i.test(data.error) && !/secret/i.test(data.error) ? 401 : 400;
    throw e;
  }
  return data;
}

/* ------------------------------- master sheet ------------------------------- */
function masterUrl() {
  const c = (window.BRI_CONFIG && window.BRI_CONFIG.masterUrl) || "";
  if (c) return c;
  try { return localStorage.getItem("bri.masterUrl") || ""; } catch (_) { return ""; }
}
async function masterCall(action, payload = {}) {
  const url = masterUrl();
  if (!url) throw new Error("The platform (master sheet) is not configured.");
  try { return await gasCall(url, { action, token: tokStore.get(), ...payload }, "master sheet"); }
  catch (e) { if (e.code === 401 && action !== "login") { e.message = "Session expired — please sign in again."; } throw e; }
}

/* ------------------------------ user's data sheet ------------------------------ */
async function bridgeCall(body) {
  if (!cfg.bridgeUrl) { const e = new Error("No Google Sheet is connected yet. Open Setup and connect your sheet."); e.code = "nosheet"; throw e; }
  if (!BRIDGE_RE.test(cfg.bridgeUrl)) throw new Error("The saved Bridge URL is not a valid Apps Script /exec URL. Fix it in Setup.");
  return gasCall(cfg.bridgeUrl, { ...body, secret: cfg.bridgeSecret }, "sheet bridge");
}

/** updateRow, falling back to append when no row matched (works with older bridges too). */
async function bridgeUpsert(sheet, matchColumn, matchValue, updates) {
  try { return await bridgeCall({ action: "upsertRow", sheet, matchColumn, matchValue, updates }); }
  catch (err) { if (!/unknown action/i.test(err.message)) throw err; }
  const r = await bridgeCall({ action: "updateRow", sheet, matchColumn, matchValue, updates });
  if (r && (r.updated > 0 || r.updated === true)) return r;
  return bridgeCall({ action: "appendRows", sheet, rows: [{ [matchColumn]: matchValue, ...updates }] });
}

/** Same call shape the UI has always used: write("appendRows", {…}). */
async function write(action, payload = {}) {
  if (action === "upsertRow") return bridgeUpsert(payload.sheet, payload.matchColumn, payload.matchValue, payload.updates);
  if (action === "saveSettings") {
    try { return await bridgeCall({ action, ...payload }); }
    catch (err) {
      if (!/unknown action/i.test(err.message)) throw err;
      for (const [k, v] of Object.entries(payload.pairs || {})) await bridgeUpsert("Workspace Settings", "Key", k, { Value: v });
      return { ok: true, saved: Object.keys(payload.pairs || {}).length, legacy: true };
    }
  }
  return bridgeCall({ action, ...payload });
}
