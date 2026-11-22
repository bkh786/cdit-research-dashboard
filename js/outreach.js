/* ==========================================================================
   Brand detail, contact research, AI email composer, sharing
   ========================================================================== */
"use strict";

let DRAFT = null; // { brand, parts, contact, tab }

/* ----------------------------- contact research ----------------------------- */
async function researchContact(name, { silent } = {}) {
  const b = brandByName(name);
  const onlyPlaceholders = !b || b.contacts.every((c) => isPlaceholder(c["Decision Maker Name"]));
  const rec = b && b.top ? b.top["Recommended Contact Department"] : "";
  const r = await api("/api/research-contact", { brand: name, profile: cfg.profile, recommendedDept: rec, mode: onlyPlaceholders ? "update" : "append" });
  if (!silent) toast(r.found ? `Found ${r.contacts[0]["Decision Maker Name"]} (${r.contacts[0].Designation || "leader"})` : (r.note || "No contact found"), r.found ? "ok" : "info");
  return r;
}
ACT["research-contact"] = async (t) => {
  const name = t.dataset.brand;
  const old = t.innerHTML; t.disabled = true; t.innerHTML = `${ic("refresh", 13).replace('class="ic"', 'class="ic spin"')} Searching…`;
  try { await researchContact(name); await loadData(); render(); }
  catch (e) { toast(e.message, "err"); t.disabled = false; t.innerHTML = old; }
};
ACT["refresh-research"] = async (t) => {
  const name = t.dataset.brand, b = brandByName(name);
  const old = t.innerHTML; t.disabled = true; t.innerHTML = `${ic("refresh", 14).replace('class="ic"', 'class="ic spin"')} Researching…`;
  try {
    const r = await researchBrand(name, { brandInfo: b ? { sector: b.sector, segment: b.segment, website: b.website, hq: b.hq } : {} });
    await loadData();
    toast(`${r.written ? r.written.news : 0} new signals, ${r.written ? r.written.opportunities : 0} new opportunities${r.warning ? " — " + r.warning : ""}`, r.warning ? "info" : "ok", 7000);
    render();
  } catch (e) { toast(e.message, "err", 8000); t.disabled = false; t.innerHTML = old; }
};

/* ------------------------------- brand detail ------------------------------- */
function execSummary(b) {
  const t = b.top;
  if (!t) return `${b.name} is being tracked but hasn't been through a research pass yet. ${b.notes ? esc(b.notes) : "Run “Research with AI” to pull recent signals, score opportunities and find the decision-maker."}`;
  const n = b.news[0];
  return `<b>${esc(b.name)}</b> is a <b>${esc(b.tier)}-priority</b> account (heat ${b.heat}/100). The strongest angle is <b>${esc(t["Opportunity Type"])}</b>: ${esc(t["Business Impact"] || "")} ${esc(t["Opportunity for Channelplay"] || "")}${n ? ` Most recent signal (${esc(niceDate(n.Date))}): “${esc(n.Headline)}”.` : ""}${t["Suggested Next Action"] ? ` <b>Next step:</b> ${esc(t["Suggested Next Action"])}` : ""}`;
}

function renderBrand(name) {
  const b = brandByName(name), C = $("#content");
  DRAFT = DRAFT && DRAFT.brand === b.name ? DRAFT : null;
  const sel = (DRAFT && DRAFT.contactIdx) || 0;
  C.innerHTML = `
    <button class="crumb" data-act="go" data-view="overview">${ic("back", 14)} All brands</button>
    <div class="card hero" style="margin-bottom:18px">
      ${logoHtml(b, "lg")}
      <div class="grow"><div class="row" style="gap:10px"><h1>${esc(b.name)}</h1>${tierPill(b.tier)}${svcPills(b.services)}</div>
        <div class="sub" style="margin-top:4px">${esc([b.sector, b.segment].filter(Boolean).join(" · "))}</div>
        <div class="row" style="gap:14px;margin-top:6px;font-size:12.5px;color:var(--ink-3)">${b.hq ? `<span>${ic("pin", 12)} ${esc(b.hq)}</span>` : ""}${b.domain ? `<a href="https://${attr(b.domain)}" target="_blank" rel="noopener">${ic("link", 12)} ${esc(b.domain)}</a>` : ""}<span>Tracking since ${esc(niceDate(b.added))}</span></div></div>
      ${heatRing(b.heat)}
      <div class="actions row"><button class="btn soft" data-act="refresh-research" data-brand="${attr(b.name)}">${ic("sparkle", 14)}Research with AI</button><button class="btn ghost" data-act="share" data-brand="${attr(b.name)}">${ic("share", 14)}Share briefing</button></div>
    </div>

    <div class="split">
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${ic("book", 17)}Executive summary</h3></div><div class="card-body"><p style="line-height:1.7">${execSummary(b)}</p></div></div>

        <div class="card"><div class="card-head"><h3>${ic("bolt", 17)}Opportunities <span class="muted" style="font-weight:500">${b.opps.length}</span></h3></div><div class="card-body">
          ${b.opps.length ? b.opps.map((o) => `<div class="opp"><div class="row" style="justify-content:space-between;gap:8px"><h4>${esc(o["Opportunity Type"])}</h4><div class="row" style="gap:8px">${svcPills(serviceTags(o["Recommended Service"]))}${stars(o["Priority Score (1-5)"])}</div></div>
            <dl><dt>What's happening</dt><dd>${esc(o["Business Impact"])}</dd><dt>How we help</dt><dd>${esc(o["Opportunity for Channelplay"])}</dd><dt>Service</dt><dd>${esc(o["Recommended Service"])}</dd><dt>Talk to</dt><dd>${esc(o["Recommended Contact Department"])}</dd><dt>Next action</dt><dd style="color:var(--accent);font-weight:600">${esc(o["Suggested Next Action"])}</dd><dt>Confidence</dt><dd>${esc(o["Confidence Score (1-5)"] || "—")}/5</dd></dl></div>`).join("") : emptyState("bolt", "No opportunities scored yet", "Run AI research to generate them.", `<button class="btn soft" data-act="refresh-research" data-brand="${attr(b.name)}">${ic("sparkle", 14)} Research with AI</button>`)}</div></div>

        <div class="card"><div class="card-head"><h3>${ic("radar", 17)}Signals timeline <span class="muted" style="font-weight:500">${b.news.length}</span></h3></div><div class="card-body">
          ${b.news.length ? `<div class="timeline">${b.news.map((n) => `<div class="tl-item"><div class="when">${esc(niceDate(n.Date))} · ${esc(n.Source || "")} ${n.Category ? `· <span class="pill acc">${esc(n.Category)}</span>` : ""}</div>
            <h4>${n.URL ? `<a href="${attr(n.URL)}" target="_blank" rel="noopener" style="color:inherit">${esc(n.Headline)} ${ic("ext", 12)}</a>` : esc(n.Headline)}</h4><p>${esc(n["AI Summary"] || "")}</p>${n["Why It Matters"] ? `<div class="why-now"><b>Why it matters:</b> ${esc(n["Why It Matters"])}</div>` : ""}</div>`).join("")}</div>` : '<div class="muted">No signals recorded yet.</div>'}</div></div>

        <div class="card" id="composer"><div class="card-head"><h3>${ic("mail", 17)}Outreach draft</h3>
          <div class="row"><button class="btn sm" data-act="gen-email" data-brand="${attr(b.name)}">${ic("sparkle", 13)}${DRAFT ? "Regenerate" : "Generate with AI"}</button><button class="btn sm ghost" data-act="tpl-email" data-brand="${attr(b.name)}">Quick template</button></div></div>
          <div class="card-body" id="composerBody">${composerHtml(b)}</div></div>
      </div>

      <div class="stack">
        <div class="card"><div class="card-head"><h3>${ic("kanban", 17)}Pipeline</h3></div><div class="card-body">
          <div class="field"><label>Stage</label><select class="select" id="plStage">${STAGES.map((s) => `<option ${b.stage === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
          <div class="fgrid"><div class="field"><label>Owner</label><input class="input" id="plOwner2" value="${attr(b.owner)}" placeholder="${attr(cfg.sender.senderName || "Name")}"></div>
          <div class="field"><label>Follow-up</label><input class="input" type="date" id="plFollow" value="${attr(b.followUp)}"></div></div>
          <div class="field"><label>Notes</label><textarea class="textarea" id="plNotes" style="min-height:70px">${esc(b.pipeNotes)}</textarea></div>
          <button class="btn" style="width:100%" data-act="save-pipeline" data-brand="${attr(b.name)}">Save to sheet</button></div></div>

        <div class="card"><div class="card-head"><h3>${ic("users", 17)}Decision-makers</h3><button class="btn sm soft" data-act="research-contact" data-brand="${attr(b.name)}">${ic("sparkle", 13)}${b.readyContacts.length ? "Find more" : "Find with AI"}</button></div><div class="card-body" style="padding-top:6px">
          ${b.readyContacts.map((c, i) => `
            <div class="contact"><div class="avatar">${esc((c["Decision Maker Name"] || "?").charAt(0))}</div><div class="grow"><b>${esc(c["Decision Maker Name"])}</b><div class="sub">${esc(c.Designation)}${c.Department ? " · " + esc(c.Department) : ""}</div>${contactLinks(c)}
              ${c["Office Location"] ? `<div class="cline">${ic("pin", 12)} ${esc(c["Office Location"])}</div>` : ""}
              <div class="tip" style="margin-top:6px">${esc((c["Research Status"] || "").slice(0, 260))}</div></div></div>`).join("") || `<div class="empty" style="padding:22px 10px">${ic("users", 28)}<b>No decision-maker yet</b><div>Click “Find with AI” to search the web for the right person.</div></div>`}</div></div>

        ${b.notes ? `<div class="card"><div class="card-head"><h3>Status notes</h3></div><div class="card-body sub">${esc(b.notes)}</div></div>` : ""}
      </div>
    </div>`;
}

Object.assign(ACT, {
  "save-pipeline": async (t) => {
    const name = t.dataset.brand;
    t.disabled = true;
    try {
      const updates = { Stage: $("#plStage").value, Owner: $("#plOwner2").value.trim(), "Next Follow-up Date": $("#plFollow").value, Notes: $("#plNotes").value.trim(), "Last Update": today() };
      await write("upsertRow", { sheet: "Pipeline", matchColumn: "Brand", matchValue: name, updates });
      await loadData(); toast("Pipeline saved"); render();
    } catch (e) { toast(e.message, "err"); t.disabled = false; }
  },
});

/* ------------------------------ signature + email ------------------------------ */
const TAG_COLORS = ["#0f5c1b", "#de691a", "#164e86", "#773e9b", "#b4283d"];
function sigHtml() {
  const s = cfg.sender, p = cfg.profile;
  const tag = split(p.tagline || "").map((t, i) => `<span style="color:${TAG_COLORS[i % 5]};font-weight:700;font-style:italic">${esc(t)}</span>`).join(' <span style="font-weight:700">&bull;</span> ');
  const web = p.companyWebsite;
  return `<div style="margin-top:18px;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#1e293b">
<p style="margin:0 0 10px 0">Warm regards,</p>
<p style="margin:0 0 2px 0;font-weight:700;font-size:14px;color:#0f172a">${esc(s.senderName || "[Your name]")}</p>
<p style="margin:0 0 6px 0;color:#475569">${esc(s.senderDesignation || "")}${s.senderDesignation && p.companyName ? " &bull; " : ""}<strong style="color:#0f172a">${esc(p.companyName)}</strong></p>
<p style="margin:0 0 6px 0;font-size:12.5px;color:#64748b">${s.senderEmail ? `&#128231; <a href="mailto:${attr(s.senderEmail)}" style="color:#2563eb">${esc(s.senderEmail)}</a>&nbsp;&nbsp;` : ""}${s.phoneNumber ? `&#128222; ${esc(s.phoneNumber)}&nbsp;&nbsp;` : ""}${web ? `&#127760; <a href="${attr(web)}" style="color:#2563eb">${esc(web)}</a>` : ""}</p>
${tag ? `<p style="margin:10px 0 0 0;font-size:14px">${tag}</p>` : ""}</div>`;
}
function sigPlain() {
  const s = cfg.sender, p = cfg.profile;
  return `Warm regards,\n\n${s.senderName || "[Your name]"}\n${[s.senderDesignation, p.companyName].filter(Boolean).join(" • ")}\n${[s.senderEmail && "📧 " + s.senderEmail, s.phoneNumber && "📞 " + s.phoneNumber, p.companyWebsite && "🌐 " + p.companyWebsite].filter(Boolean).join("  ")}${p.tagline ? "\n" + split(p.tagline).join(" • ") : ""}`;
}
function partsToHtml(x) {
  const P = (t, st = "") => t ? `<p style="margin:0 0 14px 0;${st}">${esc(t)}</p>` : "";
  const caps = (x.capabilities || []).map((c) => { const i = c.indexOf(":"); return i > 0 ? `<li style="margin-bottom:6px"><strong>${esc(c.slice(0, i + 1))}</strong>${esc(c.slice(i + 1))}</li>` : `<li style="margin-bottom:6px">${esc(c)}</li>`; }).join("");
  return `${P(x.hook, "font-weight:600")}${P(x.context)}${P(x.value)}${caps ? `<ul style="margin:0 0 14px 0;padding-left:20px">${caps}</ul>` : ""}${P(x.closing)}${P(x.softAsk, "font-weight:600")}`;
}
function partsToPlain(x) {
  return [x.hook, x.context, x.value, (x.capabilities || []).map((c) => "• " + c).join("\n"), x.closing, x.softAsk].filter(Boolean).join("\n\n");
}
function templateParts(b, contact) {
  const first = contact && !isPlaceholder(contact["Decision Maker Name"]) ? firstName(contact["Decision Maker Name"]) : "[Name]";
  const n = b.news[0], o = b.top, p = cfg.profile;
  const svc = (p.services || []).join(" and ") || "retail execution";
  return {
    subject: `${b.name}: supporting in-store execution${n ? " after " + (n.Headline || "").slice(0, 40) : ""}`.slice(0, 90),
    hook: `Hello ${first}, ${n ? `I saw the news that ${n.Headline.replace(/\.$/, "")} (${n.Source || "press"}).` : `I've been following ${b.name}'s progress in ${p.geography || "India"}.`}`,
    context: o ? `${o["Business Impact"]} ${o["Why It Matters"] || ""}`.trim() : `Moves like this raise the bar for in-store execution — consistent displays and trained product advisors at every counter are what turn launches into sell-through.`,
    value: `${p.companyName} partners with brands on ${svc}. ${p.pitch || ""}`.trim(),
    capabilities: p.proofPoints ? p.proofPoints.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 4) : [],
    closing: "",
    softAsk: `Would you be open to a 15-minute conversation next week to see whether this could help ${b.name}?`,
    linkedinNote: `Hi ${first}, I follow ${b.name}'s retail moves closely and we help brands with ${svc}. Would be glad to connect.`.slice(0, 280),
    followUp: `Just following up on my note below. If useful, I can share a short example of how we've handled ${svc} for similar brands. Happy to work around your schedule.`,
    template: true,
  };
}

function pickContact(b) {
  return b.readyContacts[(DRAFT && DRAFT.contactIdx) || 0] || b.readyContacts[0] || null;
}
function emailOf(c) { const m = String((c && c["Official Email (public only)"]) || "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/); return m ? m[0] : ""; }

function composerHtml(b) {
  if (!DRAFT) return `<div class="empty" style="padding:26px 10px">${ic("mail", 30)}<b>Draft a personalised email in one click</b><div>Uses ${esc(b.name)}'s latest signals, the top opportunity, the decision-maker and your signature.</div></div>`;
  const c = pickContact(b), x = DRAFT.parts, contacts = b.readyContacts;
  const to = DRAFT.to !== undefined ? DRAFT.to : emailOf(c);
  const cc = DRAFT.cc !== undefined ? DRAFT.cc : cfg.sender.defaultCc;
  const tab = DRAFT.tab || "email";
  return `
    ${x.template ? `<div class="note info" style="margin-bottom:12px">${ic("sparkle", 16)}<div>${DRAFT.fallbackReason ? esc(DRAFT.fallbackReason) + " " : ""}This is a basic template. Use <b>Generate with AI</b> for a personalised draft.</div></div>` : ""}
    ${contacts.length > 1 ? `<div class="field"><label>Write to</label><select class="select" id="cmpContact">${contacts.map((k, i) => `<option value="${i}" ${i === (DRAFT.contactIdx || 0) ? "selected" : ""}>${esc(k["Decision Maker Name"])} — ${esc(k.Designation)}</option>`).join("")}</select></div>` : ""}
    <div class="tabs"><button class="${tab === "email" ? "on" : ""}" data-act="cmp-tab" data-t="email">Email</button><button class="${tab === "linkedin" ? "on" : ""}" data-act="cmp-tab" data-t="linkedin">LinkedIn note</button><button class="${tab === "follow" ? "on" : ""}" data-act="cmp-tab" data-t="follow">Follow-up</button></div>
    ${tab === "email" ? `
      <div class="compose"><div class="compose-row"><label>To</label><input id="cmpTo" value="${attr(to)}" placeholder="${c ? "No public email found — paste one or use LinkedIn" : "recipient@company.com"}"></div>
        <div class="compose-row"><label>Cc</label><input id="cmpCc" value="${attr(cc)}"></div>
        <div class="compose-row"><label>Subject</label><input id="cmpSubject" value="${attr(DRAFT.subject || x.subject)}"></div>
        <div class="compose-body" id="cmpBody" contenteditable="true" spellcheck="true">${DRAFT.bodyHtml}</div></div>
      ${x.subjectAlt ? `<div class="row" style="margin-top:8px"><span class="tip">Alternative subject:</span><button class="chip-btn" data-act="cmp-subj">${esc(x.subjectAlt)}</button></div>` : ""}
      ${!to ? `<div class="note warn" style="margin-top:10px">${ic("warn", 16)}<div><b>No verified e-mail address.</b> We never guess addresses. Check the company website or LinkedIn, then paste it above.</div></div>` : ""}
      <div class="row" style="margin-top:14px">
        <button class="btn" data-act="cmp-copy">${ic("copy", 14)}Copy email</button>
        <button class="btn ghost" data-act="cmp-outlook-web">Outlook Web</button>
        <button class="btn ghost" data-act="cmp-outlook-app">Outlook app</button>
        <button class="btn ghost" data-act="cmp-gmail">Gmail</button>
        <button class="btn ghost" data-act="cmp-eml">${ic("download", 14)}.eml</button>
        <button class="btn ghost" data-act="cmp-save">Save draft to sheet</button></div>
      <div class="tip" style="margin-top:8px">“Copy email” keeps formatting and signature — paste with ${navigator.platform.includes("Mac") ? "⌘V" : "Ctrl+V"} into the message body. Subject, To and Cc are pre-filled by the Outlook / Gmail buttons.</div>`
    : tab === "linkedin" ? `
      <div class="field"><label>Connection request note <span class="muted">(max 300 characters)</span></label><textarea class="textarea" id="cmpLi" maxlength="300">${esc(x.linkedinNote || "")}</textarea></div>
      <div class="row"><button class="btn" data-act="cmp-copy-li">${ic("copy", 14)}Copy note</button>${c && c["LinkedIn Profile"] ? `<a class="btn ghost" href="${attr(c["LinkedIn Profile"])}" target="_blank" rel="noopener">${ic("ext", 14)}Open LinkedIn</a>` : ""}</div>`
    : `
      <div class="field"><label>Follow-up after 4–5 days</label><textarea class="textarea" id="cmpFu" style="min-height:130px">${esc(x.followUp || "")}</textarea></div>
      <button class="btn" data-act="cmp-copy-fu">${ic("copy", 14)}Copy follow-up</button>`}`;
}

function setDraft(b, parts, extra = {}) {
  const c = pickContact(b);
  const greetName = c ? firstName(c["Decision Maker Name"]) : "";
  if (greetName && parts.hook) parts.hook = parts.hook.replace(/^Hello \[?Name\]?,/i, `Hello ${greetName},`);
  DRAFT = { brand: b.name, parts, subject: parts.subject, bodyHtml: partsToHtml(parts) + sigHtml(), contactIdx: (DRAFT && DRAFT.contactIdx) || 0, tab: "email", ...extra };
  $("#composerBody").innerHTML = composerHtml(b);
}

ACT["gen-email"] = async (t) => {
  const b = brandByName(t.dataset.brand);
  const c = pickContact(b);
  if (!S.meta.geminiConnected) { toast("Add a Gemini API key in Setup to generate AI drafts.", "info"); return go("setup"); }
  const old = t.innerHTML; t.disabled = true; t.innerHTML = `${ic("refresh", 13).replace('class="ic"', 'class="ic spin"')} Drafting…`;
  $("#composerBody").innerHTML = `<div class="empty" style="padding:30px">${ic("sparkle", 28)}<b>Reading signals &amp; writing…</b><div>Takes about 10–15 seconds.</div></div>`;
  const cutoff = Date.now() - 90 * 864e5;
  try {
    const r = await api("/api/generate-email", {
      brand: b.name, sector: b.sector, segment: b.segment,
      topOpportunity: b.top ? { type: b.top["Opportunity Type"], businessImpact: b.top["Business Impact"], opportunityForChannelplay: b.top["Opportunity for Channelplay"], recommendedService: b.top["Recommended Service"], nextAction: b.top["Suggested Next Action"] } : null,
      recentNews: b.news.filter((n) => { const d = parseDate(n.Date); return !d || d.getTime() >= cutoff; }).slice(0, 6).map((n) => ({ date: n.Date, headline: n.Headline, summary: n["AI Summary"], source: n.Source })),
      contactName: c ? firstName(c["Decision Maker Name"]) : "", contactDesignation: c ? c.Designation : "",
      profile: cfg.profile, sender: cfg.sender,
    });
    setDraft(b, r);
    toast("Draft ready — edit anything directly in the message.");
  } catch (e) {
    toast(e.message, "err", 7000);
    setDraft(b, templateParts(b, c), { fallbackReason: "AI draft unavailable (" + e.message.slice(0, 80) + ")." });
  }
  t.disabled = false; t.innerHTML = old;
};
ACT["tpl-email"] = (t) => { const b = brandByName(t.dataset.brand); setDraft(b, templateParts(b, pickContact(b))); };

function composeState() {
  const b = brandByName(DRAFT.brand);
  const html = $("#cmpBody").innerHTML;
  const plain = ($("#cmpBody").innerText || "").trim();
  return { b, to: $("#cmpTo").value.trim(), cc: $("#cmpCc").value.trim(), subject: $("#cmpSubject").value.trim(), html, plain };
}
document.addEventListener("input", (e) => { if (DRAFT && e.target.id === "cmpBody") DRAFT.bodyHtml = e.target.innerHTML; if (DRAFT && ["cmpTo", "cmpCc", "cmpSubject"].includes(e.target.id)) DRAFT[{ cmpTo: "to", cmpCc: "cc", cmpSubject: "subject" }[e.target.id]] = e.target.value; });
document.addEventListener("change", (e) => { if (DRAFT && e.target.id === "cmpContact") { DRAFT.contactIdx = +e.target.value; DRAFT.to = undefined; const b = brandByName(DRAFT.brand); setDraft(b, DRAFT.parts, { to: undefined }); } });

Object.assign(ACT, {
  "cmp-tab": (t) => { if (DRAFT) { DRAFT.tab = t.dataset.t; if ($("#cmpBody")) DRAFT.bodyHtml = $("#cmpBody").innerHTML; $("#composerBody").innerHTML = composerHtml(brandByName(DRAFT.brand)); } },
  "cmp-subj": (t) => { $("#cmpSubject").value = t.textContent; DRAFT.subject = t.textContent; },
  "cmp-copy": async () => { const s = composeState(); toast((await copyRich(s.html, s.plain)) ? "Email copied with formatting & signature" : "Couldn't copy — select the text manually", "ok"); },
  "cmp-copy-li": async () => { toast((await copyText($("#cmpLi").value)) ? "LinkedIn note copied" : "Copy failed", "ok"); },
  "cmp-copy-fu": async () => { toast((await copyText($("#cmpFu").value)) ? "Follow-up copied" : "Copy failed", "ok"); },
  "cmp-outlook-web": async () => {
    const s = composeState(); await copyRich(s.html, s.plain);
    toast("Body copied — paste it into the Outlook message (⌘V / Ctrl+V).", "info", 6000);
    const u = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(s.to)}&cc=${encodeURIComponent(s.cc)}&subject=${encodeURIComponent(s.subject)}`;
    window.open(u, "_blank", "noopener");
  },
  "cmp-outlook-app": async () => {
    const s = composeState(); await copyRich(s.html, s.plain);
    toast("Body copied — paste it into the draft that opens (⌘V / Ctrl+V).", "info", 6000);
    const a = document.createElement("a"); a.href = `mailto:${encodeURIComponent(s.to)}?${s.cc ? "cc=" + encodeURIComponent(s.cc) + "&" : ""}subject=${encodeURIComponent(s.subject)}`; a.click();
  },
  "cmp-gmail": async () => {
    const s = composeState(); await copyRich(s.html, s.plain);
    toast("Body copied — paste it into Gmail (⌘V / Ctrl+V).", "info", 6000);
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(s.to)}&cc=${encodeURIComponent(s.cc)}&su=${encodeURIComponent(s.subject)}`, "_blank", "noopener");
  },
  "cmp-eml": () => {
    const s = composeState(), sd = cfg.sender;
    const eml = ["X-Unsent: 1", `From: "${sd.senderName}" <${sd.senderEmail}>`, `To: <${s.to}>`, s.cc ? `Cc: <${s.cc}>` : "", `Subject: ${s.subject}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="utf-8"', "", `<html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b">${s.html}</body></html>`].filter((l) => l !== "").join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([eml], { type: "message/rfc822" })); a.download = `Outreach_${s.b.name.replace(/\W+/g, "_")}.eml`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000); toast("Downloaded .eml — double-click to open as a draft in Outlook.");
  },
  "cmp-save": async (t) => {
    const s = composeState(); t.disabled = true;
    try { await write("appendRows", { sheet: "Email Drafts", rows: [{ Brand: s.b.name, "Linked Opportunity": s.b.top ? s.b.top["Opportunity Type"] : "", Subject: s.subject, "Draft Body": s.plain, "Created At": today() }] }); toast("Draft saved to the “Email Drafts” tab"); }
    catch (e) { toast(e.message, "err"); }
    t.disabled = false;
  },
});

/* --------------------------------- sharing --------------------------------- */
function briefing(b) {
  const link = `${location.origin}${location.pathname}#/brand/${encodeURIComponent(b.name)}`;
  const lines = [`STRATEGIC BRIEFING — ${b.name.toUpperCase()}`, `${[b.sector, b.segment].filter(Boolean).join(" · ")} | Priority: ${b.tier} | Stage: ${b.stage} | Heat: ${b.heat}/100`, "", execSummary(b).replace(/<[^>]+>/g, "")];
  if (b.opps.length) { lines.push("", "OPPORTUNITIES"); b.opps.forEach((o, i) => lines.push(`${i + 1}. ${o["Opportunity Type"]} (${o["Priority Score (1-5)"]}/5) — ${o["Opportunity for Channelplay"]}  → ${o["Suggested Next Action"]}`)); }
  if (b.news.length) { lines.push("", "RECENT SIGNALS"); b.news.slice(0, 5).forEach((n) => lines.push(`• [${n.Date}] ${n.Headline} (${n.Source || ""}) ${n.URL || ""}`)); }
  const c = b.readyContacts[0]; if (c) lines.push("", `KEY CONTACT: ${c["Decision Maker Name"]}, ${c.Designation} ${c["LinkedIn Profile"] ? "· " + c["LinkedIn Profile"] : ""}`);
  lines.push("", `Open in dashboard: ${link}`);
  const plain = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;color:#1e293b"><h2 style="margin:0 0 4px">${esc(b.name)}</h2><div style="color:#64748b;font-size:13px;margin-bottom:12px">${esc([b.sector, b.segment].filter(Boolean).join(" · "))} · ${esc(b.tier)} priority · ${esc(b.stage)}</div><p style="line-height:1.6">${execSummary(b)}</p>${b.opps.length ? `<h3 style="font-size:14px">Opportunities</h3><ul>${b.opps.map((o) => `<li><b>${esc(o["Opportunity Type"])}</b> — ${esc(o["Opportunity for Channelplay"])}<br><i style="color:#4f46e5">${esc(o["Suggested Next Action"])}</i></li>`).join("")}</ul>` : ""}${b.news.length ? `<h3 style="font-size:14px">Recent signals</h3><ul>${b.news.slice(0, 5).map((n) => `<li>${esc(n.Date)} — ${n.URL ? `<a href="${attr(n.URL)}">${esc(n.Headline)}</a>` : esc(n.Headline)} <span style="color:#64748b">(${esc(n.Source || "")})</span></li>`).join("")}</ul>` : ""}<p><a href="${attr(link)}">Open in dashboard →</a></p></div>`;
  return { plain, html, link };
}
ACT.share = (t) => {
  const b = brandByName(t.dataset.brand), d = briefing(b);
  const o = modal(`<h2>Share briefing — ${esc(b.name)}</h2><p class="lead">A concise summary with opportunities, signals and the key contact.</p>
    <div class="grid g2"><button class="btn ghost" id="shRich">${ic("copy", 14)}Copy rich (Outlook / Docs)</button><button class="btn ghost" id="shPlain">${ic("copy", 14)}Copy plain (Teams / WhatsApp)</button><button class="btn ghost" id="shLink">${ic("link", 14)}Copy link</button><button class="btn ghost" id="shMail">${ic("mail", 14)}Open in mail app</button></div>
    <pre class="code" style="margin-top:14px;white-space:pre-wrap;max-height:260px">${esc(d.plain)}</pre><div class="modal-actions"><button class="btn" data-act="close-modal">Close</button></div>`, { wide: true });
  $("#shRich", o).onclick = async () => toast((await copyRich(d.html, d.plain)) ? "Copied rich briefing" : "Copy failed");
  $("#shPlain", o).onclick = async () => toast((await copyText(d.plain)) ? "Copied plain briefing" : "Copy failed");
  $("#shLink", o).onclick = async () => toast((await copyText(d.link)) ? "Link copied" : "Copy failed");
  $("#shMail", o).onclick = () => { location.href = `mailto:?subject=${encodeURIComponent("Briefing: " + b.name)}&body=${encodeURIComponent(d.plain.slice(0, 1800))}`; };
};
