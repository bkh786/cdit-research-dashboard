/* ==========================================================================
   Setup guide (connect sheet → bridge → one-click tabs → Gemini → brands)
   and Settings (workspace profile, sender & signature, connection)
   ========================================================================== */
"use strict";

const LATEST_BRIDGE = "2.1.0";
const REQUIRED_TABS = ["Brands Master", "News feed", "Opportunities", "Contacts", "Pipeline", "Email Drafts", "Competitor Watch", "Email Settings", "Workspace Settings"];
let PING = null; // last ping result

function tabsPresent() {
  const h = S.headers || {};
  return REQUIRED_TABS.filter((t) => Object.keys(h).some((k) => lc(k) === lc(t)) || (PING && PING.status && PING.status[t] && PING.status[t].exists));
}

/* ================================== SETUP ================================== */
function renderSetup() {
  const C = $("#content");
  const own = true;
  const connected = S.meta.connection === "bridge";
  if (connected && !PING && !renderSetup._pinging) { renderSetup._pinging = true; write("ping", {}).then((r) => { PING = r; }).catch(() => {}).finally(() => { renderSetup._pinging = false; if (view === "setup") renderSetup(); }); }
  const tabsOk = tabsPresent().length === REQUIRED_TABS.length;
  const hasGem = !!S.meta.geminiConnected;
  const hasBrands = S.D.brands.length > 0;
  const steps = own ? [
    !!cfg.bridgeUrl || connected, !!cfg.bridgeUrl, connected, connected && tabsOk, hasGem, hasBrands,
  ] : [true, true, true, true, hasGem, hasBrands];
  const cur = steps.findIndex((s) => !s);
  const cls = (i) => `step ${steps[i] ? "done" : i === cur ? "cur" : ""}`;
  const num = (i) => (steps[i] ? ic("check", 16) : i + 1);
  const secret = cfg.bridgeSecret;

  C.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Setup guide</div><h1>Connect your own workspace</h1>
      <p>Your brands, signals and contacts live in <b>your own Google Sheet</b> — private to you. This guide takes about 5 minutes; everything after step 1 is automatic.</p></div>
    </div>
    ${PING && PING.version && PING.version !== LATEST_BRIDGE ? `<div class="note warn" style="margin-bottom:18px">${ic("warn", 18)}<div><b>Your bridge script is v${esc(PING.version)}; the latest is v${LATEST_BRIDGE}.</b> The new version lets the dashboard verify contact e-mails/phones on the source page. Click <b>Copy bridge script</b> in step 2, replace the code in Apps Script, then <b>Deploy → Manage deployments → ✏️ → New version → Deploy</b>. The web-app URL stays the same.</div></div>` : ""}

    <div class="split rev" style="grid-template-columns:minmax(0,1fr) 340px">
      <div class="steps">
        ${own ? `
        <div class="${cls(0)}"><div class="step-num">${num(0)}</div><div class="step-body"><h3>Create a Google Sheet</h3>
          <p>Create a blank Google Sheet in your own Google Drive (any name, e.g. “My Brand Research”). It stays private — nobody else needs access.</p>
          <a class="btn ghost" href="https://sheets.new" target="_blank" rel="noopener">${ic("ext", 14)}Create a new sheet</a></div></div>

        <div class="${cls(1)}"><div class="step-num">${num(1)}</div><div class="step-body"><h3>Add the bridge script to your sheet</h3>
          <p>A small Google Apps Script lets the dashboard read and write <i>only</i> your sheet. We generate a private secret for you and put it inside the script.</p>
          <ol class="ol"><li>Click <b>Copy bridge script</b> below.</li><li>In your sheet open <b>Extensions → Apps Script</b>. Delete any code, <b>paste</b> the script and press <b>Save</b> (💾).</li>
            <li>Click <b>Deploy → New deployment</b> → gear icon → <b>Web app</b>.</li><li>Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then <b>Deploy</b> and approve the permissions (Advanced → Go to project).</li><li>Copy the <b>Web app URL</b> (ends in <span class="mono">/exec</span>).</li></ol>
          <div class="row"><button class="btn" data-act="copy-bridge">${ic("copy", 14)}Copy bridge script</button><button class="btn ghost" data-act="show-bridge">Preview script</button></div>
          <div class="tip" style="margin-top:8px">Your secret: <span class="mono">${esc(secret ? secret.slice(0, 4) + "••••••••••••" : "(created when you copy)")}</span> — it never leaves your browser and your Apps Script.</div>
          <div id="bridgePreview"></div></div></div>

        <div class="${cls(2)}"><div class="step-num">${num(2)}</div><div class="step-body"><h3>Paste the Web app URL</h3>
          <p>Paste the URL from the deployment and test the connection.</p>
          <div class="field" style="max-width:640px"><input class="input mono" id="bridgeUrl" placeholder="https://script.google.com/macros/s/AKfy…/exec" value="${attr(cfg.bridgeUrl)}"></div>
          <div class="row"><button class="btn" data-act="test-bridge">${ic("link", 14)}Test connection</button><span id="bridgeMsg"></span></div></div></div>

        <div class="${cls(3)}"><div class="step-num">${num(3)}</div><div class="step-body"><h3>Set up my sheet — one click</h3>
          <p>Creates every tab the dashboard needs (<span class="mono">Brands Master, News feed, Opportunities, Contacts, Pipeline, Email Drafts, Competitor Watch, Email Settings, Workspace Settings</span>) with the correct headers. Existing data is never touched.</p>
          <button class="btn lg" data-act="setup-sheets" ${connected ? "" : "disabled"}>${ic("rocket", 16)}Set up my sheet</button><span id="setupMsg" style="margin-left:12px"></span></div></div>
        ` : ""}

        <div class="${cls(4)}"><div class="step-num">${num(4)}</div><div class="step-body"><h3>Add your Gemini API key</h3>
          <p>Gemini (with Google Search) powers brand research, decision-maker search and email drafting. The free tier is enough for personal use. Your key is kept in your own private workspace row (${AUTH.mode === "master" ? "in the set-up-master sheet" : "in this browser only"}) and is sent only to Google — never to a hosting server.</p>
          <ol class="ol"><li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio → Get API key</a> and create a key.</li><li>Paste it below.</li></ol>
          <div class="fgrid" style="max-width:640px"><div class="field"><label>Gemini API key</label><input class="input mono" type="password" id="gemKey" placeholder="AIza…" value="${attr(cfg.geminiKey)}" autocomplete="off"></div>
          <div class="field"><label>Preferred model <span class="muted">(optional)</span></label><input class="input mono" id="gemModel" placeholder="Leave blank — chosen automatically" value="${attr(cfg.geminiModel)}"><div class="hint">No model is fixed. The app asks Google which models your key can use, tries the best one and automatically falls back if a model is retired or out of quota.</div></div></div>
          <div class="row"><button class="btn" data-act="save-gemini">${ic("sparkle", 14)}Save &amp; test Gemini</button><span id="gemMsg"></span></div></div></div>

        <div class="${cls(5)}"><div class="step-num">${num(5)}</div><div class="step-body"><h3>Add the brands you want to track</h3>
          <p>Type your brand names (comma or new line separated). Tick <b>Research now</b> and the AI will find recent signals, score opportunities for your services, and you can find decision-makers next.</p>
          <div class="field" style="max-width:640px"><textarea class="textarea" id="setupBrands" placeholder="Samsung, LG, Sony, Dyson…"></textarea></div>
          <div class="fgrid" style="max-width:640px"><div class="field"><label>Default sector <span class="muted">(optional)</span></label><input class="input" id="setupSector" placeholder="${attr((cfg.profile.sectors.split("|")[0]) || "Consumer Electronics")}"></div>
          <div class="field"><label>Default priority</label><select class="select" id="setupTier"><option>High</option><option selected>Medium</option><option>Low</option></select></div></div>
          <label class="row" style="gap:8px;margin-bottom:12px;cursor:pointer"><input type="checkbox" id="setupResearch" ${hasGem ? "checked" : "disabled"}> <span><b>Research now</b> with AI ${hasGem ? "" : '<span class="muted">(needs a Gemini key — step 5)</span>'}</span></label>
          <button class="btn lg" data-act="setup-brands" ${connected ? "" : "disabled"}>${ic("plus", 16)}Add brands</button></div></div>

        ${steps.every(Boolean) ? `<div class="note good">${ic("check", 18)}<div><b>You're all set.</b> <a href="#/overview">Open the dashboard →</a> and set your name &amp; signature in <a href="#/settings">Settings</a>.</div></div>` : ""}
      </div>

      <div class="stack">
        <div class="card"><div class="card-head"><h3>${ic("check", 17)}Sheet health</h3><button class="btn sm ghost" data-act="ping">${ic("refresh", 12)}Check</button></div><div class="card-body"><div class="checklist">
          ${REQUIRED_TABS.map((t) => { const ok = tabsPresent().includes(t); return `<div class="chk ${ok ? "ok" : "miss"}">${ic(ok ? "check" : "x", 15)}<span>${esc(t)}</span><span>${ok ? "ready" : "missing"}</span></div>`; }).join("")}</div>
          ${S.meta.spreadsheet ? `<div class="tip" style="margin-top:10px">Connected to <b>${esc(S.meta.spreadsheet)}</b></div>` : ""}</div></div>
        <div class="card"><div class="card-head"><h3>${ic("book", 17)}Troubleshooting</h3></div><div class="card-body" style="padding:12px">
          <details class="fold"><summary>“Unauthorized: secret mismatch”</summary><div>The secret inside the script doesn't match this browser. Click <b>Copy bridge script</b> again, replace the script in Apps Script, then <b>Deploy → Manage deployments → Edit → New version</b>.</div></details>
          <details class="fold"><summary>“Did not return JSON”</summary><div>Re-deploy as <b>Web app</b> with <b>Who has access: Anyone</b>. “Anyone with Google account” won't work. Use the <span class="mono">/exec</span> URL, not <span class="mono">/dev</span>.</div></details>
          <details class="fold"><summary>I changed the script — nothing happens</summary><div>Apps Script runs the <i>deployed version</i>. After every edit use <b>Deploy → Manage deployments → ✏️ → Version: New version → Deploy</b>.</div></details>
          <details class="fold"><summary>“Couldn't reach the sheet bridge”</summary><div>The browser could not open your Apps Script URL. Check the URL ends in <span class="mono">/exec</span> and the deployment says <b>Who has access: Anyone</b>. Ad-blockers that block <span class="mono">script.google.com</span> also cause this.</div></details>
          <details class="fold"><summary>Gemini model errors or quota (429)</summary><div>Models are discovered and switched automatically. If every model reports quota, wait a minute or enable billing for the key in Google AI Studio. A message that the key is rejected means the key itself needs re-copying.</div></details>
          <details class="fold"><summary>Is my data private?</summary><div>Yes. Your sheet is never shared publicly. Only someone with your secret + URL could write to it. They live in your private workspace and in your Apps Script.</div></details>
        </div></div>
      </div>
    </div>`;
}

Object.assign(ACT, {
  "show-bridge": async () => {
    const txt = await bridgeScript();
    $("#bridgePreview").innerHTML = `<pre class="code" style="margin-top:10px">${esc(txt)}</pre>`;
  },
  "copy-bridge": async (t) => {
    const txt = await bridgeScript();
    toast((await copyText(txt)) ? "Bridge script copied — now paste it into Apps Script." : "Couldn't copy; use “Preview script” and copy manually.", "ok", 5000);
    renderSetup();
  },
  "test-bridge": async (t) => {
    const url = $("#bridgeUrl").value.trim(), msg = $("#bridgeMsg");
    if (!BRIDGE_RE.test(url)) { msg.innerHTML = `<span class="pill bad">URL must look like https://script.google.com/macros/s/…/exec</span>`; return; }
    cfg.bridgeUrl = url; cfg.mode = "own"; cfg.bridgeSecret ||= randomSecret(); saveCfg();
    t.disabled = true; msg.innerHTML = '<span class="muted">Testing…</span>';
    try {
      PING = await write("ping", {});
      if (PING.spreadsheetUrl) { cfg.sheetUrl = PING.spreadsheetUrl; saveCfg(); }
      msg.innerHTML = `<span class="pill good">${ic("check", 12)} Connected to “${esc(PING.spreadsheet)}”</span>`;
      await loadData(); paintChrome();
      renderSetup();
    } catch (e) { msg.innerHTML = `<span class="pill bad">${esc(e.message).slice(0, 160)}</span>`; }
    t.disabled = false;
  },
  "setup-sheets": async (t) => {
    t.disabled = true; $("#setupMsg").innerHTML = '<span class="muted">Creating tabs…</span>';
    try {
      const r = await write("setupSheets", {});
      PING = await write("ping", {});
      await loadData();
      toast(`Sheet ready — ${r.created.length} tab${r.created.length === 1 ? "" : "s"} created${r.repaired.length ? `, ${r.repaired.length} repaired` : ""}.`);
      renderSetup();
    } catch (e) { $("#setupMsg").innerHTML = `<span class="pill bad">${esc(e.message)}</span>`; t.disabled = false; }
  },
  ping: async () => { try { PING = await write("ping", {}); await loadData(); } catch (e) { toast(e.message, "err"); } renderSetup(); },
  "save-gemini": async (t) => {
    cfg.geminiKey = $("#gemKey").value.trim(); cfg.geminiModel = $("#gemModel").value.trim(); saveCfg();
    const msg = $("#gemMsg"); t.disabled = true; msg.innerHTML = '<span class="muted">Testing…</span>';
    if (!cfg.geminiKey) { msg.innerHTML = '<span class="pill bad">Paste your Gemini API key first.</span>'; t.disabled = false; return; }
    try {
      const r = await testGemini(); S.meta.geminiConnected = true;
      msg.innerHTML = `<span class="pill good">${ic("check", 12)} Working · auto-selected ${esc(r.model)} (${r.available} models available${r.skipped.length ? `; skipped ${esc(r.skipped.join(", "))}` : ""})</span>${r.search === "ok" ? ` <span class="pill good">${ic("check", 12)} Web search works</span>` : `<div class="note warn" style="margin-top:8px">${ic("warn", 16)}<div><b>Web search is not available on this key</b> — contact &amp; brand research need it. ${esc(r.searchMsg).slice(0, 380)}</div></div>`}`;
      paintChrome(); if (r.search === "ok") setTimeout(renderSetup, 2500);
    } catch (e) { S.meta.geminiConnected = false; msg.innerHTML = `<span class="pill bad">${esc(e.message).slice(0, 260)}</span>`; paintChrome(); }
    t.disabled = false;
  },
  "setup-brands": async () => {
    const names = uniq($("#setupBrands").value.split(/[\n,;]+/).map((s) => s.trim())).filter((n) => !brandByName(n));
    if (!names.length) return toast("Enter at least one new brand name.", "info");
    await bulkAddBrands(names, { research: $("#setupResearch").checked, sector: $("#setupSector").value.trim(), tier: $("#setupTier").value });
    renderSetup();
  },
});

async function bridgeScript() {
  cfg.bridgeSecret ||= randomSecret(); saveCfg();
  const r = await fetch("apps-script/Code.gs", { cache: "no-store" });
  if (!r.ok) throw new Error("Couldn't load the bridge script.");
  return (await r.text()).replace("const SECRET = '__SECRET__';", `const SECRET = '${cfg.bridgeSecret}';`);
}

/* ================================= SETTINGS ================================= */
function tagbox(id, values) {
  return `<div class="tagbox" id="${id}" data-tagbox>${values.map((v) => `<span class="pill" data-tag="${attr(v)}">${esc(v)}<button type="button" data-act="tag-x" aria-label="Remove">${ic("x", 12)}</button></span>`).join("")}<input placeholder="Type and press Enter" autocomplete="off"></div>`;
}
const tagValues = (id) => $$(`#${id} [data-tag]`).map((x) => x.dataset.tag);
function addTag(box, v) {
  v = v.trim().replace(/\|/g, "/"); if (!v) return;
  if (tagValues(box.id).some((x) => lc(x) === lc(v))) return;
  const s = document.createElement("span"); s.className = "pill"; s.dataset.tag = v;
  s.innerHTML = `${esc(v)}<button type="button" data-act="tag-x" aria-label="Remove">${ic("x", 12)}</button>`;
  box.insertBefore(s, box.querySelector("input"));
}
document.addEventListener("keydown", (e) => {
  const inp = e.target.closest && e.target.closest("[data-tagbox] input"); if (!inp) return;
  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(inp.closest("[data-tagbox]"), inp.value); inp.value = ""; }
  if (e.key === "Backspace" && !inp.value) { const t = inp.closest("[data-tagbox]").querySelectorAll("[data-tag]"); if (t.length) t[t.length - 1].remove(); }
});
document.addEventListener("focusout", (e) => { const inp = e.target.closest && e.target.closest("[data-tagbox] input"); if (inp && inp.value.trim()) { addTag(inp.closest("[data-tagbox]"), inp.value); inp.value = ""; } });
ACT["tag-x"] = (t) => t.closest("[data-tag]").remove();

function renderSettings() {
  const C = $("#content"), p = cfg.profile, s = cfg.sender;
  const f = (id, label, val, ph = "", hint = "") => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" value="${attr(val)}" placeholder="${attr(ph)}">${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  C.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Settings</div><h1>Make it yours</h1><p>Your company profile shapes what the AI researches and how it writes. Settings are saved to your sheet (“Workspace Settings” tab), so they follow you across devices.</p></div>
      <div class="actions"><button class="btn" data-act="save-settings">${ic("check", 15)}Save settings</button></div></div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) 400px">
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${ic("rocket", 17)}What you sell</h3></div><div class="card-body">
          <div class="fgrid">${f("sCompany", "Company name", p.companyName, "Acme Retail Services")}${f("sWebsite", "Company website", p.companyWebsite, "https://www.example.com", "Used for the email's capability context")}</div>
          <div class="field"><label>Services you offer</label>${tagbox("sServices", p.services)}<div class="hint">Research and opportunity scoring are matched to these. Visual Merchandising (VM) and Promoter / Sales-Force Outsourcing (SFO) are tagged automatically.</div></div>
          <div class="field"><label for="sPitch">One-line positioning</label><textarea class="textarea" id="sPitch" style="min-height:64px">${esc(p.pitch)}</textarea></div>
          <div class="field"><label for="sProof">Proof points the AI may quote</label><textarea class="textarea" id="sProof" style="min-height:84px">${esc(p.proofPoints)}</textarea><div class="hint">Separate with semicolons. The AI is told to make <i>no other</i> capability claims.</div></div></div></div>
        <div class="card"><div class="card-head"><h3>${ic("search", 17)}Who you target</h3></div><div class="card-body">
          <div class="field"><label>Sectors</label>${tagbox("sSectors", split(p.sectors))}</div>
          <div class="fgrid">${f("sGeo", "Geography", p.geography, "India")}${f("sOwner", "Default pipeline owner", p.ownerName, cfg.sender.senderName || "Your name")}</div>
          <div class="field"><label for="sRoles">Buyer roles to look for <span class="muted">(one per line, optional)</span></label><textarea class="textarea" id="sRoles" style="min-height:90px" placeholder="Head of Marketing / CMO&#10;Head of Trade Marketing&#10;Head of Sales / National Sales Head&#10;Head of Retail Operations">${esc(String(p.buyerRoles || "").split("|").join("\n"))}</textarea><div class="hint">Leave empty to use sensible defaults (marketing, trade-marketing, sales and retail-operations heads).</div></div></div></div>
        <div class="card"><div class="card-head"><h3>${ic("mail", 17)}Sender &amp; signature</h3></div><div class="card-body">
          <div class="fgrid">${f("sName", "Your name", s.senderName, "Priya Sharma")}${f("sDesig", "Designation", s.senderDesignation, "Business Manager – Consumer Electronics")}${f("sEmail", "Email", s.senderEmail, "priya@company.com")}${f("sCc", "Default CC", s.defaultCc, "(optional)")}${f("sPhone", "Phone", s.phoneNumber, "+91 98xxxxxxx")}${f("sTag", "Signature tagline", split(p.tagline).join(" | "), "Retail Execution | Visual Merchandising", "Separate with | — shown in colour")}</div></div></div>
      </div>
      <div class="stack" style="position:sticky;top:84px">
        <div class="card"><div class="card-head"><h3>Signature preview</h3></div><div class="card-body" style="background:#fff;border-radius:0 0 18px 18px"><div id="sigPreview">${sigHtml()}</div></div></div>
        <div class="card"><div class="card-head"><h3>${ic("link", 17)}Connection</h3></div><div class="card-body">
          <div class="checklist">
            <div class="chk ok">${ic("users", 15)}<span>Workspace</span><span>${AUTH.user ? esc(AUTH.user.email) : "Personal (this browser)"}</span></div>
            <div class="chk ${S.meta.connection === "bridge" ? "ok" : "miss"}">${ic("check", 15)}<span>Google Sheet</span><span>${esc(S.meta.spreadsheet || "not connected")}</span></div>
            <div class="chk ${S.meta.writable ? "ok" : "warn"}">${ic("check", 15)}<span>Write access</span><span>${S.meta.writable ? "yes" : "read-only"}</span></div>
            <div class="chk ${S.meta.geminiConnected ? "ok" : "miss"}">${ic("sparkle", 15)}<span>Gemini</span><span>${S.meta.geminiConnected ? esc(GEM.good || cfg.geminiModel || "ready · auto model") : "no key"}</span></div></div>
          <div class="row" style="margin-top:12px"><a class="btn sm ghost" href="#/setup">Open setup guide</a>${cfg.bridgeUrl ? `<button class="btn sm danger" data-act="disconnect">Disconnect my sheet</button>` : ""}</div></div></div>
      </div>
    </div>`;
  const live = () => { const sv = readSettingsForm(); const old = { p: { ...cfg.profile }, s: { ...cfg.sender } }; Object.assign(cfg.profile, sv.profile); Object.assign(cfg.sender, sv.sender); $("#sigPreview").innerHTML = sigHtml(); Object.assign(cfg.profile, old.p); Object.assign(cfg.sender, old.s); };
  $$("#content input.input, #content textarea").forEach((i) => i.addEventListener("input", live));
}
function readSettingsForm() {
  return {
    profile: {
      companyName: $("#sCompany").value.trim(), companyWebsite: $("#sWebsite").value.trim(), services: tagValues("sServices"), pitch: $("#sPitch").value.trim(),
      proofPoints: $("#sProof").value.trim(), sectors: tagValues("sSectors").join("|"), geography: $("#sGeo").value.trim() || "India", ownerName: $("#sOwner").value.trim(),
      buyerRoles: $("#sRoles").value.split("\n").map((x) => x.trim()).filter(Boolean).join("|"), tagline: $("#sTag").value.split("|").map((x) => x.trim()).filter(Boolean).join("|"),
    },
    sender: { senderName: $("#sName").value.trim(), senderDesignation: $("#sDesig").value.trim(), senderEmail: $("#sEmail").value.trim(), defaultCc: $("#sCc").value.trim(), phoneNumber: $("#sPhone").value.trim() },
  };
}
Object.assign(ACT, {
  "save-settings": async (t) => {
    const v = readSettingsForm();
    if (!v.profile.services.length) return toast("Add at least one service you offer.", "err");
    Object.assign(cfg.profile, v.profile); Object.assign(cfg.sender, v.sender); saveCfg();
    t.disabled = true;
    try { const r = await saveProfileToSheet(); toast(r.local ? "Saved in this browser (connect a sheet to sync)" : "Settings saved to your sheet"); }
    catch (e) { toast("Saved locally, but the sheet sync failed: " + e.message, "err", 7000); }
    t.disabled = false; renderSettings();
  },
  disconnect: async () => { cfg.bridgeUrl = ""; cfg.bridgeSecret = ""; cfg.sheetUrl = ""; saveCfg(); PING = null; await loadData(); toast("Disconnected from your sheet"); render(); },
});
