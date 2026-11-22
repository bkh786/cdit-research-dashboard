/* ==========================================================================
   Auto-research: set the parameters once, pick your AI tool, follow the guide.
   Generates, from those parameters:
     • Claude   → SKILL.md (+ ready-to-upload .zip) and the scheduled-task prompt
     • Gemini   → an Apps Script that researches on a daily trigger (fully automatic) or a task prompt
     • ChatGPT  → a Task prompt whose JSON result is pasted into "Import results"
   Nothing here talks to a server — it's all produced in your browser.
   ========================================================================== */
"use strict";

const AR_TOOLS = {
  claude: { name: "Claude", tag: "Hands-free · writes to your sheet", blurb: "A scheduled Claude task runs a skill you upload, researches with web search and writes straight into your Google Sheet." },
  gemini: { name: "Gemini", tag: "Hands-free · free tier", blurb: "A Google Apps Script with a daily trigger calls the Gemini API (with Google Search) and writes to your sheet. No chat app needed." },
  chatgpt: { name: "ChatGPT", tag: "Scheduled · paste to import", blurb: "A ChatGPT Task researches on a schedule and returns JSON that you import with one click." },
};
const AR_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const AR = { tool: "claude" };

/* ------------------------------- small utilities ------------------------------- */
const FENCE = "```";
const arP = () => cfg.auto;
function arCron(p) {
  const [h, m] = (p.time || "08:00").split(":").map((x) => parseInt(x, 10) || 0);
  const dow = p.freq === "weekdays" ? "1-5" : p.freq === "weekly" ? String(AR_DAYS.indexOf(p.day) + 1 || 1) : "*";
  return `${m} ${h} * * ${dow}`;
}
function arWhen(p) {
  const t = p.time || "08:00";
  return p.freq === "weekdays" ? `every weekday at ${t}` : p.freq === "weekly" ? `every ${p.day} at ${t}` : `every day at ${t}`;
}
function arBrands(p) {
  let list = S.D ? S.D.brands.slice() : [];
  if (p.tier === "High") list = list.filter((b) => b.tier === "High");
  return list.map((b) => b.name);
}
function download(name, data, mime = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: mime })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Minimal ZIP writer (no compression) so the skill can be uploaded to claude.ai as-is. */
function makeZip(files) {
  const enc = new TextEncoder(), T = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = [], central = []; let off = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  files.forEach((f) => {
    const nm = enc.encode(f.name), data = enc.encode(f.data), c = crc(data);
    const head = [0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
    parts.push(new Uint8Array(head), nm, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
    off += head.length + nm.length + data.length;
  });
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  parts.push(...central, new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), 0, 0]));
  return new Blob(parts, { type: "application/zip" });
}

/* ------------------------------ shared instruction text ------------------------------ */
function arRules(p) {
  const cats = p.categories.length ? p.categories : SIGNAL_TYPES;
  return `## Research rules (accuracy first)
- Search the web for each brand. Report only facts you can open and verify on a real article or official page. Never invent headlines, dates, people, numbers or URLs. If nothing new is verifiable for a brand, skip it.
- Look back ${p.lookback} day${p.lookback == 1 ? "" : "s"}. Dates are YYYY-MM-DD and never in the future.
- Every item needs its publication name and the exact article URL you opened. No URL → do not report it.
- Do not repeat anything already in the sheet's "News feed" (same Brand + Headline).
- Signal categories allowed: ${cats.join(", ")}.
- Recommended service must be one of: ${(cfg.profile.services || []).map((s) => `"${s}"`).join(", ")} (or a combination joined with " + ").
${p.extra ? `\n## Extra instructions from the owner\n${p.extra}\n` : ""}
## Contact rules (only if decision-makers are in scope)
- Only people whose NAME and CURRENT role you saw on a page from the last 12 months, or on the company's own site.
- Record an e-mail ONLY if the full address is printed on a web page and belongs to that person individually (e.g. firstname.lastname@brand.com). Record a phone number ONLY if it is that person's own direct or mobile number printed on a page.
- NEVER record customer-care, helpline, toll-free (1800 / 1860), switchboard or board-line numbers, nor shared mailboxes such as info@, care@, customercare@, support@, sales@, contact@, hello@, marketing@, press@, enquiry@ — and never guess an address from a pattern. Leave the field blank instead; blank is the correct answer when unsure.`;
}
function arSchemaJson(p) {
  const parts = [];
  if (p.doSignals) parts.push(`  "news": [ { "Brand": "", "Date": "YYYY-MM-DD", "Headline": "", "Category": "", "AI Summary": "2 factual sentences", "Source": "publication", "URL": "exact article URL", "Why It Matters": "1 sentence on the in-store / field-force implication" } ]`);
  if (p.doOpps) parts.push(`  "opportunities": [ { "Brand": "", "Opportunity Type": "signal category", "Business Impact": "", "Opportunity for Channelplay": "how we help; end with 'Why now: …'", "Confidence Score (1-5)": 4, "Priority Score (1-5)": 4, "Recommended Service": "", "Recommended Contact Department": "", "Suggested Next Action": "", "Linked News Ref": "headline" } ]`);
  if (p.doComps) parts.push(`  "competitors": [ { "Competitor": "", "Related Tracked Brand": "", "Date": "YYYY-MM-DD", "Category": "", "Headline": "", "Summary": "", "Full Analysis": "", "Source": "", "URL": "" } ]`);
  if (p.doContacts) parts.push(`  "contacts": [ { "Brand": "", "Decision Maker Name": "", "Designation": "", "Department": "", "LinkedIn Profile": "", "Official Email (public only)": "", "Official Contact Number (public only)": "", "Office Location": "", "Research Status": "where found + date" } ]`);
  return `{\n${parts.join(",\n")}\n}`;
}
function arHeader(p) {
  const pr = cfg.profile;
  return `You are the daily research analyst for ${pr.companyName}${pr.companyWebsite ? ` (${pr.companyWebsite})` : ""}.
${pr.companyName} sells: ${(pr.services || []).join("; ")}.
${pr.pitch ? "Positioning: " + pr.pitch + "\n" : ""}Target sectors: ${split(pr.sectors).join(", ") || "n/a"}. Geography: ${pr.geography || "India"}.
Goal: find NEW, verifiable market signals about the brands tracked in the owner's Google Sheet that create a reason to reach out about those services.`;
}
function arScope(p, snapshot) {
  const what = [p.doSignals && "news signals", p.doOpps && "scored opportunities", p.doComps && "competitor moves", p.doContacts && "missing decision-makers"].filter(Boolean).join(", ");
  return `## Scope
- Brands: ${p.tier === "High" ? "High-priority brands only" : "every tracked brand"}; research at most ${p.maxBrands} brands per run, choosing the ones with the oldest or no recent signals first.
- Produce: ${what || "news signals"}.`;
}

/* ----------------------------------- Claude ----------------------------------- */
function arClaudeSkill(p, embedSecret) {
  const url = cfg.bridgeUrl || "<YOUR_BRIDGE_URL>";
  const sec = embedSecret ? cfg.bridgeSecret || "<YOUR_BRIDGE_SECRET>" : "<YOUR_BRIDGE_SECRET>";
  const rules = arRules(p);
  return `---
name: brand-research-auto
description: Daily brand research for ${cfg.profile.companyName}. Reads the tracked brands from the owner's Google Sheet, finds new verifiable retail / field-force signals on the web and writes them back to the sheet. Use when a scheduled task or the user asks to run the brand research.
---

${arHeader(p)}

## Connection (the owner's private Google Sheet bridge)
- Bridge URL: ${url}
- Secret: ${sec}
- Every call is an HTTP POST with a JSON body that includes "secret". Use curl with \`-sL\` and WITHOUT \`-X POST\` (Google answers with a redirect that curl must follow as GET). Write the JSON to a temp file first so quotes survive:
${FENCE}bash
cat > /tmp/req.json <<'JSON'
{"secret":"${sec}","action":"readAll"}
JSON
curl -sL -H 'Content-Type: text/plain' --data-binary @/tmp/req.json '${url}'
${FENCE}

${arScope(p)}

## Steps
1. READ — call action \`readAll\`. Use \`sheets["Brands Master"]\` (brands to research), \`sheets["News feed"]\` (to avoid duplicates), \`sheets["Contacts"]\` (who is already found).
2. RESEARCH — for each brand in scope, search the web and collect only verifiable items.
3. WRITE — one call per sheet. Duplicates are skipped by the sheet itself when you pass \`dedupeOn\`:
${p.doSignals ? `   - News: \`{"secret":…,"action":"appendRows","sheet":"News feed","dedupeOn":["Brand","Headline"],"rows":[{"Brand":"","Date":"YYYY-MM-DD","Headline":"","Category":"","AI Summary":"","Source":"","URL":"","Why It Matters":""}]}\`\n` : ""}${p.doOpps ? `   - Opportunities (only when a signal clearly creates a need for our services): \`{"secret":…,"action":"appendRows","sheet":"Opportunities","dedupeOn":["Brand","Opportunity Type","Suggested Next Action"],"rows":[{"Brand":"","Opportunity Type":"","Business Impact":"","Opportunity for Channelplay":"","Confidence Score (1-5)":4,"Priority Score (1-5)":4,"Recommended Service":"","Recommended Contact Department":"","Suggested Next Action":"","Linked News Ref":""}]}\`\n` : ""}${p.doComps ? `   - Competitor moves: \`{"secret":…,"action":"appendRows","sheet":"Competitor Watch","dedupeOn":["Competitor","Headline"],"rows":[{"Competitor":"","Related Tracked Brand":"","Date":"","Category":"","Headline":"","Summary":"","Full Analysis":"","Source":"","URL":""}]}\`\n` : ""}${p.doContacts ? `   - Contacts: \`{"secret":…,"action":"appendRows","sheet":"Contacts","dedupeOn":["Brand","Decision Maker Name"],"rows":[{"Brand":"","Decision Maker Name":"","Designation":"","Department":"","LinkedIn Profile":"","Official Email (public only)":"","Official Contact Number (public only)":"","Office Location":"","Research Status":""}]}\`\n` : ""}4. REPORT — print how many rows were added per sheet and which brands were skipped and why. Do not e-mail or message anyone.

${rules}
`;
}
function arClaudeTaskPrompt(p) {
  return `Run the "brand-research-auto" skill now for my Brand Research sheet and write the results to it. Finish by telling me how many rows were added to each sheet and which brands you skipped.`;
}

/* ----------------------------------- ChatGPT / Gemini app ----------------------------------- */
function arJsonTaskPrompt(p) {
  const brands = arBrands(p);
  return `${arHeader(p)}

${arScope(p)}
Brands to research (snapshot of my sheet — pick up to ${p.maxBrands}):
${brands.length ? brands.map((b) => "- " + b).join("\n") : "- (add your brands here)"}

${arRules(p)}

## Output
Reply with ONLY one JSON object (no commentary, no markdown fences) in exactly this shape. Omit a key if you found nothing for it:
${arSchemaJson(p)}`;
}

/* ----------------------------------- Gemini: Apps Script runner ----------------------------------- */
function arGasScript(p, embedKey) {
  const pr = cfg.profile, q = (s) => JSON.stringify(String(s || ""));
  const hour = parseInt((p.time || "08:00").split(":")[0], 10) || 8;
  const days = p.freq === "weekdays" ? ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] : p.freq === "weekly" ? [String(p.day || "Monday").toUpperCase()] : [];
  const trigger = days.length
    ? `  ${JSON.stringify(days)}.forEach(function (d) { ScriptApp.newTrigger('runAutoResearch').timeBased().onWeekDay(ScriptApp.WeekDay[d]).atHour(AR.HOUR).inTimezone(AR.TIMEZONE).create(); });`
    : `  ScriptApp.newTrigger('runAutoResearch').timeBased().everyDays(1).atHour(AR.HOUR).inTimezone(AR.TIMEZONE).create();`;
  return `/**
 * Brand Research — automatic research (Gemini + Google Search).  Generated ${today()}.
 * HOW TO USE: open the Apps Script project of your data sheet (Extensions → Apps Script), click the “+” next to
 * Files → Script, name it AutoResearch, paste this whole file, Save. Choose  installDailyTrigger  in the function
 * menu and press Run (approve the permissions once). To test right now, run  runAutoResearch.
 * Runs on Google's servers ${arWhen(p)} (${p.tz}); nothing needs to be open or switched on.
 */
const AR = {
  GEMINI_KEY: ${q(embedKey ? cfg.geminiKey : "")},   // ${embedKey ? "your key (keep this file private)" : "PASTE YOUR GEMINI API KEY HERE"}
  COMPANY: ${q(pr.companyName)}, WEBSITE: ${q(pr.companyWebsite)}, PITCH: ${q(pr.pitch)},
  SERVICES: ${JSON.stringify(pr.services || [])}, SECTORS: ${q(split(pr.sectors).join(", "))}, GEOGRAPHY: ${q(pr.geography || "India")},
  CATEGORIES: ${JSON.stringify(p.categories.length ? p.categories : SIGNAL_TYPES)},
  LOOKBACK_DAYS: ${+p.lookback || 2}, MAX_BRANDS: ${+p.maxBrands || 12}, ONLY_HIGH_PRIORITY: ${p.tier === "High"},
  DO_SIGNALS: ${!!p.doSignals}, DO_OPPORTUNITIES: ${!!p.doOpps},
  HOUR: ${hour}, TIMEZONE: ${q(p.tz)},
  EXTRA: ${q(p.extra)}
};

function installDailyTrigger() {
  removeDailyTrigger();
${trigger}
  Logger.log('Auto-research scheduled: ${arWhen(p)} (${p.tz}).');
}
function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runAutoResearch') ScriptApp.deleteTrigger(t); });
}

function runAutoResearch() {
  if (!AR.GEMINI_KEY) throw new Error('Paste your Gemini API key into AR.GEMINI_KEY first.');
  const started = Date.now(), props = PropertiesService.getScriptProperties();
  let brands = readObjects_(ensureSheet_('Brands Master')).filter(function (b) { return b['Brand'] && (!AR.ONLY_HIGH_PRIORITY || norm_(b['Priority Tier']) === 'high'); });
  if (!brands.length) { Logger.log('No brands to research.'); return; }
  let cursor = Number(props.getProperty('AR_CURSOR') || 0) % brands.length, done = 0, added = { news: 0, opps: 0 };
  while (done < Math.min(AR.MAX_BRANDS, brands.length) && Date.now() - started < 4.5 * 60 * 1000) {
    const b = brands[cursor % brands.length]; cursor++; done++;
    try { const r = arResearchOne_(b); added.news += r.news; added.opps += r.opps; Logger.log(b['Brand'] + ': +' + r.news + ' signals, +' + r.opps + ' opportunities'); }
    catch (e) { Logger.log(b['Brand'] + ': skipped — ' + e.message); }
  }
  props.setProperty('AR_CURSOR', String(cursor % brands.length));
  Logger.log('Done. ' + added.news + ' signals and ' + added.opps + ' opportunities added.');
}

function arResearchOne_(brand) {
  const name = brand['Brand'], today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  const prompt = 'You are the research analyst for ' + AR.COMPANY + (AR.WEBSITE ? ' (' + AR.WEBSITE + ')' : '') + '. ' + AR.COMPANY + ' sells: ' + AR.SERVICES.join('; ') + '. ' + (AR.PITCH || '') + '\\n' +
    'Research the brand "' + name + '" in ' + AR.GEOGRAPHY + ' (sector focus: ' + AR.SECTORS + ') using Google Search. Today is ' + today + '. Find NEW moves from the last ' + AR.LOOKBACK_DAYS + ' days (extend to 30 days only if nothing newer exists) that give a reason to reach out about those services: new or expanded stores, experience zones, product launches needing in-store demos, festive campaigns, leadership changes in sales/marketing/retail, distribution changes, capex, retail hiring.\\n' +
    'STRICT RULES: only facts found in search results; never invent headlines, dates, numbers, people or URLs; every signal needs its publication and the exact article URL; dates YYYY-MM-DD and never after ' + today + '; categories allowed: ' + AR.CATEGORIES.join(', ') + '; recommendedService must be one of: ' + AR.SERVICES.join(' | ') + ' (or joined with " + "). ' + (AR.EXTRA ? 'Extra instructions: ' + AR.EXTRA + ' ' : '') + 'If nothing new is verifiable return empty arrays.\\n' +
    'Return ONLY JSON: {"signals":[{"date":"","headline":"","category":"","source":"","url":"","summary":"2 factual sentences","whyItMatters":""}],"opportunities":[{"type":"","businessImpact":"","opportunityForUs":"","recommendedService":"","contactDept":"","nextAction":"","whyNow":"","priorityScore":1,"confidenceScore":1,"linkedSignal":1}]}';
  const out = arGemini_(prompt), news = [], opps = [];
  (out.signals || []).slice(0, 5).forEach(function (s) {
    if (!s.headline || (s.date && s.date > today)) return;
    news.push({ 'Brand': name, 'Date': s.date || today, 'Headline': s.headline, 'Category': AR.CATEGORIES.indexOf(s.category) >= 0 ? s.category : 'Other', 'AI Summary': s.summary || '', 'Source': s.source || '', 'URL': arUrlOk_(s.url, name) ? s.url : '', 'Why It Matters': s.whyItMatters || '' });
  });
  (out.opportunities || []).slice(0, 3).forEach(function (o) {
    if (!(o.opportunityForUs || o.businessImpact) || !news.length) return;
    const ref = news[Math.max(0, (o.linkedSignal || 1) - 1)] || news[0];
    opps.push({ 'Brand': name, 'Opportunity Type': o.type || 'Retail Expansion', 'Business Impact': o.businessImpact || '', 'Opportunity for Channelplay': [o.opportunityForUs, o.whyNow ? 'Why now: ' + o.whyNow : ''].filter(String).join(' '), 'Confidence Score (1-5)': Math.max(1, Math.min(5, Math.round(o.confidenceScore) || 3)), 'Priority Score (1-5)': Math.max(1, Math.min(5, Math.round(o.priorityScore) || 3)), 'Recommended Service': o.recommendedService || AR.SERVICES[0], 'Recommended Contact Department': o.contactDept || '', 'Suggested Next Action': o.nextAction || '', 'Linked News Ref': ref['Headline'] });
  });
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    let n = 0, p = 0;
    if (AR.DO_SIGNALS && news.length) n = appendRows_('News feed', news, ['Brand', 'Headline']).added || 0;
    if (AR.DO_OPPORTUNITIES && opps.length) p = appendRows_('Opportunities', opps, ['Brand', 'Opportunity Type', 'Suggested Next Action']).added || 0;
    return { news: n, opps: p };
  } finally { lock.releaseLock(); }
}

/** A source URL is kept only if the page opens and actually mentions the brand. */
function arUrlOk_(url, brand) {
  if (!/^https?:\\/\\//i.test(url || '')) return false;
  try { const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BrandResearchBot/1.0)' } }); return r.getResponseCode() < 400 && r.getContentText().toLowerCase().indexOf(String(brand).toLowerCase()) >= 0; }
  catch (e) { return false; }
}

/* ---- Gemini: discover the models this key can use, fall back automatically ---- */
function arModels_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('ar_models'); if (hit) return JSON.parse(hit);
  let names = [];
  try {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': AR.GEMINI_KEY }, muteHttpExceptions: true });
    (JSON.parse(r.getContentText()).models || []).forEach(function (m) { if ((m.supportedGenerationMethods || []).indexOf('generateContent') >= 0) names.push(String(m.name).replace('models/', '')); });
  } catch (e) {}
  names = names.filter(function (n) { return /^gemini-/.test(n) && !/(embedding|aqa|imagen|veo|tts|image|live|audio|robotics|computer-use|learnlm|vision|-exp|customtools|thinking)/i.test(n); });
  const key = function (n) { const fam = /flash-lite/.test(n) ? 1 : /flash/.test(n) ? 0 : /pro/.test(n) ? 2 : 3, v = parseFloat((n.match(/^gemini-(\\d+(?:\\.\\d+)?)/) || [])[1]) || 0; return fam * 1e6 + (/preview/.test(n) ? 1e5 : 0) + (/-\\d{3}$|-\\d{2}-\\d{2}$/.test(n) ? 1e4 : 0) + (/-latest$/.test(n) ? 1e3 : 0) + (100 - Math.round(v * 10)); };
  names.sort(function (a, b) { return key(a) - key(b); });
  if (!names.length) names = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  names = names.slice(0, 8); cache.put('ar_models', JSON.stringify(names), 21600); return names;
}
function arGemini_(prompt) {
  const models = arModels_(); let last = '';
  for (let i = 0; i < models.length; i++) {
    for (let s = 0; s < 2; s++) {
      const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 6000 } };
      if (s === 0) body.tools = [{ google_search: {} }];
      let r; try { r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', { method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': AR.GEMINI_KEY }, payload: JSON.stringify(body), muteHttpExceptions: true }); } catch (e) { last = String(e); continue; }
      const code = r.getResponseCode(), txt = r.getContentText();
      if (code === 200) {
        const parts = ((((JSON.parse(txt).candidates || [])[0] || {}).content || {}).parts) || [];
        const text = parts.map(function (p) { return p.text || ''; }).join('').replace(/\`\`\`json|\`\`\`/gi, '');
        const a = text.indexOf('{'), z = text.lastIndexOf('}');
        if (a >= 0 && z > a) { try { return JSON.parse(text.slice(a, z + 1)); } catch (e) {} }
        last = models[i] + ': no JSON'; continue;
      }
      last = models[i] + ' ' + code;
      if (code === 400 && /API key/i.test(txt)) throw new Error('Gemini rejected the API key.');
      if (code === 404) break;            // model retired → next model
      if (code === 429 && s === 0) continue; // search quota → try without search
      if (code === 429) break;            // quota → next model
    }
  }
  throw new Error('No Gemini model worked (' + last + ')');
}
`;
}

/* ================================ page ================================ */
function renderAuto() {
  const C = $("#content"), p = arP();
  const latest = S.D && S.D.news.length ? S.D.news.map((n) => n.Date).sort().pop() : "";
  const tzs = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch (_) { return ["Asia/Kolkata", "UTC", "Europe/London", "America/New_York", "Asia/Dubai", "Asia/Singapore"]; } })();
  const chk = (id, label, on) => `<label class="ar-chk"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${label}</label>`;
  C.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Auto-research</div><h1>Keep your sheet fresh, automatically</h1>
      <p>Choose when and what to research, pick the AI tool you already use, and follow the steps. Every person sets this up in <b>their own</b> AI account — so each sheet is researched with your own settings and nobody shares a schedule.</p></div></div>

    <div class="ar-status card"><div class="row" style="gap:14px;flex-wrap:nowrap">${ic("clock", 22)}<div class="grow"><b>${latest ? `Last signal in your sheet: ${esc(relDate(latest))}` : "No signals in your sheet yet"}</b>
      <div class="sub">${latest && daysAgo(latest) > 3 ? "Nothing new for a few days — your automation may not be running yet." : latest ? "If you've set up auto-research, this is how you can tell it works." : "Finish the steps below, run it once, and signals will appear here."}</div></div></div></div>

    <div class="steps" style="margin-top:20px">
      <div class="step done"><div class="step-num">1</div><div class="step-body"><h3>What should it research?</h3>
        <div class="card card-pad" style="max-width:860px">
          <div class="fgrid">
            <div class="field"><label>Run</label><select class="select" id="arFreq"><option value="daily" ${p.freq === "daily" ? "selected" : ""}>Every day</option><option value="weekdays" ${p.freq === "weekdays" ? "selected" : ""}>Weekdays (Mon–Fri)</option><option value="weekly" ${p.freq === "weekly" ? "selected" : ""}>Once a week</option></select></div>
            <div class="field ${p.freq === "weekly" ? "" : "hidden"}" id="arDayWrap"><label>On</label><select class="select" id="arDay">${AR_DAYS.map((d) => `<option ${p.day === d ? "selected" : ""}>${d}</option>`).join("")}</select></div>
            <div class="field"><label>At</label><input class="input" type="time" id="arTime" value="${attr(p.time)}"></div>
            <div class="field"><label>Time zone</label><select class="select" id="arTz">${[...new Set([p.tz, ...tzs])].map((z) => `<option ${p.tz === z ? "selected" : ""}>${esc(z)}</option>`).join("")}</select></div>
            <div class="field"><label>Look back (days)</label><input class="input" type="number" min="1" max="30" id="arLook" value="${attr(p.lookback)}"><div class="hint">Only news from this window is reported.</div></div>
            <div class="field"><label>Brands per run</label><input class="input" type="number" min="1" max="60" id="arMax" value="${attr(p.maxBrands)}"><div class="hint">It rotates through your brands over several runs.</div></div>
            <div class="field"><label>Which brands</label><select class="select" id="arTier"><option value="all" ${p.tier === "all" ? "selected" : ""}>All tracked brands</option><option value="High" ${p.tier === "High" ? "selected" : ""}>High priority only</option></select></div>
          </div>
          <div class="field"><label>Research</label><div class="row" style="gap:6px 18px">${chk("arSig", "News signals", p.doSignals)}${chk("arOpp", "Opportunities", p.doOpps)}${chk("arComp", "Competitor moves", p.doComps)}${chk("arCon", "Missing decision-makers", p.doContacts)}</div>
            <div class="hint">Decision-maker research is stricter and works best from the dashboard (“Find with AI”), where e-mails and phones are verified on the source page.</div></div>
          <div class="field"><label>Signal types to look for</label><div class="row" style="gap:6px 14px">${SIGNAL_TYPES.map((t, i) => `<label class="ar-chk"><input type="checkbox" data-cat="${attr(t)}" ${!p.categories.length || p.categories.includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("")}</div></div>
          <div class="field" style="margin-bottom:0"><label>Anything else the AI should know <span class="muted">(optional)</span></label><textarea class="textarea" id="arExtra" style="min-height:64px" placeholder="e.g. Focus on south-India expansion. Ignore pure financial-results news.">${esc(p.extra)}</textarea></div>
        </div></div></div>

      <div class="step done"><div class="step-num">2</div><div class="step-body"><h3>Which AI tool will run it?</h3>
        <div class="ar-tools">${Object.entries(AR_TOOLS).map(([id, t]) => `<button class="ar-tool ${AR.tool === id ? "on" : ""}" data-act="ar-tool" data-t="${id}"><b>${t.name}</b><span class="pill ${id === "chatgpt" ? "" : "good"}">${t.tag}</span><p>${t.blurb}</p></button>`).join("")}</div></div></div>

      <div id="arOut"></div>
    </div>`;
  arBindForm();
  arRenderOut();
}

function arBindForm() {
  const p = arP(), save = () => { saveCfgLocalOnlyAuto(); arRenderOut(); };
  const bind = (id, key, num) => { const el = $("#" + id); if (!el) return; el.addEventListener("input", () => { p[key] = num ? Math.max(1, +el.value || 1) : el.value; if (key === "freq") $("#arDayWrap").classList.toggle("hidden", el.value !== "weekly"); save(); }); };
  bind("arFreq", "freq"); bind("arDay", "day"); bind("arTime", "time"); bind("arTz", "tz"); bind("arLook", "lookback", true); bind("arMax", "maxBrands", true); bind("arTier", "tier"); bind("arExtra", "extra");
  [["arSig", "doSignals"], ["arOpp", "doOpps"], ["arComp", "doComps"], ["arCon", "doContacts"]].forEach(([id, k]) => $("#" + id).addEventListener("change", (e) => { p[k] = e.target.checked; save(); }));
  $$("[data-cat]").forEach((el) => el.addEventListener("change", () => { const all = $$("[data-cat]"); const on = all.filter((x) => x.checked).map((x) => x.dataset.cat); p.categories = on.length === all.length ? [] : on; save(); }));
}
function saveCfgLocalOnlyAuto() { saveCfgLocalOnly(); }

function arRenderOut() {
  const out = $("#arOut"); if (!out) return;
  const p = arP(), tool = AR.tool, when = arWhen(p);
  const needSheetMsg = !cfg.bridgeUrl ? `<div class="note warn" style="margin-bottom:12px">${ic("warn", 16)}<div>Connect your Google Sheet first (<a href="#/setup">Setup guide</a>) — the generated files include your sheet connection.</div></div>` : "";
  let body = "";
  if (tool === "claude") {
    const skill = arClaudeSkill(p, true), prompt = arClaudeTaskPrompt(p);
    body = `<h3>Set up with Claude</h3><p class="sub">Claude will run on its own at ${esc(when)} (${esc(p.tz)}). You need the Claude desktop app (Cowork / Code) — scheduled tasks run on your computer while it is on and Claude is open.</p>${needSheetMsg}
      <ol class="ol big">
        <li><b>Download the skill.</b> It contains your instructions and your sheet connection.<div class="row" style="margin:8px 0"><button class="btn" data-act="ar-dl-zip">${ic("download", 14)}Download skill (.zip)</button><button class="btn ghost" data-act="ar-dl-skill">${ic("download", 14)}SKILL.md only</button></div></li>
        <li><b>Add it to Claude.</b> Claude desktop or claude.ai: <b>Settings → Capabilities → Skills → Upload skill</b> and choose the .zip. In Claude Code you can instead save <span class="mono">SKILL.md</span> as <span class="mono">~/.claude/skills/brand-research-auto/SKILL.md</span>.</li>
        <li><b>Create the schedule.</b> In the Claude desktop app open <b>Scheduled</b> (scheduled tasks) → <b>New task</b>. Name it “Brand research”, paste the prompt below and set it to run <b>${esc(when)}</b> (cron: <span class="mono">${esc(arCron(p))}</span>, time zone ${esc(p.tz)}). In Claude Code you can do the same with <span class="mono">/schedule</span>.</li>
        <li><b>Allow network access once.</b> Press <b>Run now</b> on the task. When Claude asks to use the web and to contact <span class="mono">script.google.com</span>, choose <b>Always allow</b> so later runs are unattended.</li>
        <li><b>Check the result.</b> Open <a href="#/signals">Signals</a> — new items appear within a few minutes of a run. The “Last signal” banner above turns fresh.</li>
      </ol>
      <div class="field"><label>Task prompt to paste</label><div class="row"><textarea class="textarea mono" readonly id="arPrompt" style="min-height:70px">${esc(prompt)}</textarea></div><button class="btn sm ghost" data-act="ar-copy" data-src="arPrompt">${ic("copy", 13)}Copy prompt</button></div>
      <details class="fold"><summary>Preview SKILL.md</summary><pre class="code" style="max-height:340px;white-space:pre-wrap">${esc(skill)}</pre></details>
      <div class="tip" style="margin-top:8px">${ic("shield", 12)} The skill includes your private bridge secret so Claude can write to your sheet. Keep the file private; if it leaks, make a new secret by re-copying the bridge script in Setup.</div>`;
  } else if (tool === "gemini") {
    const gas = arGasScript(p, true);
    const prompt = arJsonTaskPrompt(p);
    body = `<h3>Set up with Gemini</h3>
      <div class="note info" style="margin-bottom:14px">${ic("sparkle", 16)}<div><b>Recommended: the Apps Script runner.</b> It uses the Gemini API key you already added in Setup, runs on Google's servers (${esc(when)}, ${esc(p.tz)}) and writes straight into your sheet — nothing to keep open. Free-tier Gemini is enough.</div></div>${needSheetMsg}
      ${cfg.geminiKey ? "" : `<div class="note warn" style="margin-bottom:12px">${ic("warn", 16)}<div>No Gemini key yet — add one in <a href="#/setup">Setup</a>, or paste it into the script yourself.</div></div>`}
      <ol class="ol big">
        <li><b>Open your sheet's script.</b> In your data Google Sheet choose <b>Extensions → Apps Script</b> (the project where the bridge script lives).</li>
        <li><b>Add the runner.</b> Click <b>+</b> next to <b>Files → Script</b>, name it <span class="mono">AutoResearch</span>, paste the code below and press <b>Save</b>.<div class="row" style="margin:8px 0"><button class="btn" data-act="ar-copy-gas">${ic("copy", 14)}Copy runner script</button><button class="btn ghost" data-act="ar-dl-gas">${ic("download", 14)}Download .gs</button></div></li>
        <li><b>Turn on the schedule.</b> Pick <span class="mono">installDailyTrigger</span> in the function drop-down and press <b>Run</b>. Approve the permissions (Advanced → Go to project).</li>
        <li><b>Test once.</b> Pick <span class="mono">runAutoResearch</span> and press <b>Run</b>; open <b>Execution log</b> to see what it added. After that it runs by itself.</li>
        <li><b>Stop or change it.</b> Run <span class="mono">removeDailyTrigger</span> to stop. To change the settings, come back here and paste the regenerated script over the old one.</li>
      </ol>
      <details class="fold"><summary>Preview runner script</summary><pre class="code" style="max-height:340px;white-space:pre-wrap">${esc(gas)}</pre></details>
      <details class="fold" style="margin-top:10px"><summary>Alternative: Gemini app scheduled action (paid Gemini plans)</summary><div>
        <p class="sub">The Gemini app can run a prompt on a schedule but cannot write to your sheet, so you import its answer.</p>
        <ol class="ol"><li>In the Gemini app say: <i>“Every ${esc(p.freq === "weekly" ? p.day : p.freq === "weekdays" ? "weekday" : "day")} at ${esc(p.time)}, run the following prompt and send me the result.”</i> and paste the prompt below (or create it under <b>Scheduled actions</b>).</li><li>Copy the JSON it returns and paste it into <b>Import results</b> at the bottom of this page.</li></ol>
        <div class="field"><textarea class="textarea mono" readonly id="arPrompt" style="min-height:90px">${esc(prompt)}</textarea></div><button class="btn sm ghost" data-act="ar-copy" data-src="arPrompt">${ic("copy", 13)}Copy prompt</button></div></details>
      <div class="tip" style="margin-top:8px">${ic("shield", 12)} The runner includes your Gemini key so Google can call the API for you. It stays inside your own Apps Script project — don't share the file. The runner covers signals and opportunities; use the dashboard for decision-makers.</div>`;
  } else {
    const prompt = arJsonTaskPrompt(p);
    body = `<h3>Set up with ChatGPT</h3><p class="sub">ChatGPT Tasks can run a prompt on a schedule (paid plans). They cannot write to your Google Sheet, so each run gives you JSON that you import here with one click.</p>${needSheetMsg}
      <ol class="ol big">
        <li><b>Copy the prompt</b> generated from your settings (it includes a snapshot of your brand list — regenerate it when you add brands).<div class="field" style="margin-top:8px"><textarea class="textarea mono" readonly id="arPrompt" style="min-height:120px">${esc(prompt)}</textarea></div><div class="row"><button class="btn" data-act="ar-copy" data-src="arPrompt">${ic("copy", 14)}Copy prompt</button><button class="btn ghost" data-act="ar-dl-prompt">${ic("download", 14)}Download .txt</button></div></li>
        <li><b>Create a Task.</b> In ChatGPT, start a new chat and write: <i>“Every ${esc(p.freq === "weekly" ? p.day : p.freq === "weekdays" ? "weekday" : "day")} at ${esc(p.time)}, run the prompt below and send me the result.”</i> then paste the prompt. ChatGPT creates the task — you can see and edit it under <b>Tasks</b> in your profile menu. Turn on notifications so you know when it finishes.</li>
        <li><b>Run it once now</b> by saying “Run this task now”, and make sure the answer is a single JSON object.</li>
        <li><b>Import the result.</b> Copy the JSON and paste it into <b>Import results</b> below. Only new rows are added — duplicates are skipped and generic contact details are removed automatically.</li>
      </ol>`;
  }
  out.innerHTML = `<div class="step done"><div class="step-num">3</div><div class="step-body">${body}</div></div>
    <div class="step done"><div class="step-num">4</div><div class="step-body"><h3>Import results <span class="muted" style="font-weight:500">· for ChatGPT / Gemini app / any AI</span></h3>
      <p class="sub">Paste the JSON an AI returned. You see what will be written before anything is saved.</p>
      <div class="field" style="max-width:860px"><textarea class="textarea mono" id="arImport" style="min-height:120px" placeholder='{"news":[{"Brand":"…","Date":"2026-11-20","Headline":"…"}], "opportunities":[…]}'></textarea></div>
      <div class="row"><button class="btn" data-act="ar-preview">${ic("search", 14)}Preview</button><button class="btn soft" data-act="ar-import" disabled id="arImportBtn">${ic("check", 14)}Write to my sheet</button><span id="arImportMsg" class="muted"></span></div></div></div>`;
}

/* ------------------------------------ import ------------------------------------ */
function arParseImport() {
  const raw = $("#arImport").value.trim();
  if (!raw) throw new Error("Paste the JSON first.");
  const obj = extractJson(raw);
  if (!obj || typeof obj !== "object") throw new Error("That isn't valid JSON. Copy only the JSON object the AI returned.");
  const T = (cfg.auto.categories.length ? cfg.auto.categories : SIGNAL_TYPES);
  const clean = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object");
  const future = (d) => { const x = parseDate(d); return x && x.getTime() > Date.now() + 864e5; };
  const news = clean(obj.news || obj.signals).filter((r) => r.Brand && r.Headline && !future(r.Date)).map((r) => ({ ...r, Category: SIGNAL_TYPES.includes(r.Category) ? r.Category : "Other", Date: r.Date || today() }));
  const opps = clean(obj.opportunities).filter((r) => r.Brand && (r["Business Impact"] || r["Opportunity for Channelplay"]));
  const comps = clean(obj.competitors).filter((r) => r.Competitor && r.Headline);
  let stripped = 0;
  const contacts = clean(obj.contacts).filter((r) => r.Brand && r["Decision Maker Name"]).map((r) => {
    const fix = scrubGeneric(r); if (fix) stripped++;
    const em = r["Official Email (public only)"]; const personal = em && !isGenericEmail(em) && emailMatchesPerson(firstEmailIn(em), r["Decision Maker Name"]);
    return { ...r, ...(fix || {}), ...(em && !personal ? { "Official Email (public only)": "" } : {}) };
  });
  const brandsNew = [...new Set(news.concat(opps).map((r) => r.Brand))].filter((b) => !brandByName(b));
  return { news, opps, comps, contacts, stripped, brandsNew };
}

Object.assign(ACT, {
  "ar-tool": (t) => { AR.tool = t.dataset.t; $$(".ar-tool").forEach((b) => b.classList.toggle("on", b.dataset.t === AR.tool)); arRenderOut(); },
  "ar-copy": async (t) => toast((await copyText($("#" + t.dataset.src).value)) ? "Copied" : "Copy failed"),
  "ar-copy-gas": async () => toast((await copyText(arGasScript(arP(), true))) ? "Runner script copied — paste it into a new Apps Script file." : "Copy failed"),
  "ar-dl-gas": () => download("AutoResearch.gs", arGasScript(arP(), true), "text/plain"),
  "ar-dl-skill": () => download("SKILL.md", arClaudeSkill(arP(), true), "text/markdown"),
  "ar-dl-zip": () => download("brand-research-auto.zip", makeZip([{ name: "brand-research-auto/SKILL.md", data: arClaudeSkill(arP(), true) }]), "application/zip"),
  "ar-dl-prompt": () => download("brand-research-prompt.txt", arJsonTaskPrompt(arP()), "text/plain"),
  "ar-preview": () => {
    const m = $("#arImportMsg");
    try {
      const r = arParseImport();
      const total = r.news.length + r.opps.length + r.comps.length + r.contacts.length;
      m.innerHTML = total ? `<b>${r.news.length}</b> signals · <b>${r.opps.length}</b> opportunities · <b>${r.comps.length}</b> competitor moves · <b>${r.contacts.length}</b> contacts${r.brandsNew.length ? ` · new brands: ${esc(r.brandsNew.join(", "))}` : ""}${r.stripped ? ` · generic contact details removed from ${r.stripped}` : ""}` : "Nothing to import — the JSON has no usable rows.";
      $("#arImportBtn").disabled = !total;
    } catch (e) { m.textContent = e.message; $("#arImportBtn").disabled = true; }
  },
  "ar-import": async (t) => {
    const m = $("#arImportMsg"); t.disabled = true;
    try {
      const r = arParseImport(); const done = {};
      for (const b of r.brandsNew) await bridgeCall({ action: "addBrand", brand: { Brand: b, Sector: cfg.profile.sectors.split("|")[0] || "", Segment: "", "Priority Tier": "Medium", Website: "", "HQ / India Office": "", "Status Notes": "Added by auto-research import.", "Date Added": today() }, pipeline: { Brand: b, Stage: "Prospect", Owner: cfg.sender.senderName || "", "Last Update": today(), "Next Follow-up Date": "", Notes: "" } });
      const put = async (sheet, rows, dedupeOn) => { if (rows.length) done[sheet] = (await bridgeCall({ action: "appendRows", sheet, rows, dedupeOn })).added ?? rows.length; };
      await put("News feed", r.news, ["Brand", "Headline"]);
      await put("Opportunities", r.opps, ["Brand", "Opportunity Type", "Suggested Next Action"]);
      await put("Competitor Watch", r.comps, ["Competitor", "Headline"]);
      await put("Contacts", r.contacts, ["Brand", "Decision Maker Name"]);
      await loadData(); paintChrome();
      m.textContent = `Added: ${Object.entries(done).map(([k, v]) => `${v} to ${k}`).join(", ") || "nothing new"}.`;
      toast("Import finished"); $("#arImport").value = "";
    } catch (e) { m.textContent = e.message; toast(e.message, "err"); }
    t.disabled = true;
  },
});
