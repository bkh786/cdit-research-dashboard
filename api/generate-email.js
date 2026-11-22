// Drafts a personalised cold-outreach email (+ LinkedIn note + follow-up) with Gemini.
// Grounded in: the brand's recent signals, the top opportunity, the recipient, and
// the sender company's own website (fetched live) plus its editable proof points.
// Returns structured parts; the browser assembles HTML/plain with the user's signature.

const { authorize, workspace, gemini, companyBlurb, handle } = require("./_lib/common");

async function fetchSiteContext(website) {
  if (!/^https?:\/\//i.test(website || "")) return "";
  const base = website.replace(/\/+$/, "");
  const urls = [base + "/", base + "/success-stories", base + "/services"];
  const chunks = [];
  for (const url of urls) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4500);
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BRI-Dashboard/2.0)" }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const text = (await r.text())
        .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
      if (text) chunks.push(`--- ${url} ---\n${text}`);
    } catch (_) {}
  }
  return chunks.join("\n\n");
}

module.exports = handle(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!authorize(req, res)) return;
  const ws = workspace(req);

  const { brand, sector, segment, topOpportunity, recentNews, contactName, contactDesignation, profile, sender } = req.body || {};
  if (!brand) return res.status(400).json({ error: "brand is required" });
  const co = companyBlurb(profile);

  const siteContext = await fetchSiteContext(co.website);
  const news = (recentNews || []).slice(0, 6).map((n) => `- [${n.date}] ${n.headline} (${n.source || "news"}): ${n.summary || ""}`).join("\n") || "No recent news on file.";
  const opp = topOpportunity
    ? `Signal: ${topOpportunity.type}\nImpact: ${topOpportunity.businessImpact}\nHow we help: ${topOpportunity.opportunityForChannelplay}\nService: ${topOpportunity.recommendedService}\nNext action: ${topOpportunity.nextAction}`
    : "None scored yet — infer a sensible angle from the news only; do not invent facts.";
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
${siteContext || "(not available)"}

WRITING RULES
- Greeting: "Hello <FirstName>," (never "Hi", never initials-only). If no name: "Hello [Name],".
- Open with ONE specific, true observation about ${brand} taken from the signals above (not generic congratulations).
- Connect it to a concrete in-store / field-force consequence (shelf share, demo quality, promoter coverage, launch-readiness, Tier-2/3 rollout) — hypotheses phrased as hypotheses.
- Only claim capabilities that appear in the proof points or website context. Never invent client names, numbers or results.
- Tone: confident, warm, zero hype, no buzzword stacking. Short sentences. Indian business English.
- Length: hook (1-2 sentences) + context (≤70 words) + value (≤70 words) + 3 capability bullets (each "Title: one line") + closing (≤30 words) + soft ask for 15 minutes.
- Subject lines: specific to ${brand}, under 70 characters, no clickbait.

Return ONLY JSON:
{
 "subject": "", "subjectAlt": "",
 "hook": "", "context": "", "value": "",
 "capabilities": ["Title: sentence", "Title: sentence", "Title: sentence"],
 "closing": "", "softAsk": "",
 "linkedinNote": "connection request note, max 280 characters, no links",
 "followUp": "short follow-up email body (≤70 words) to send after 4-5 days, no greeting/signature"
}`;

  const out = await gemini(ws, prompt, { search: false, expect: "json", temperature: 0.6, maxOutputTokens: 3500 });
  const d = out.data;

  if (contactName && d.hook) {
    d.hook = d.hook.replace(/^(?:Hello|Hi|Dear)\s+[^,]+,\s*/i, "");
    d.hook = `Hello ${String(contactName).trim().split(/\s+/)[0]}, ${d.hook}`;
  }
  res.status(200).json({ ok: true, ...d, model: out.model });
});
