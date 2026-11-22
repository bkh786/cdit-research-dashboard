// Researches one brand end-to-end with Gemini + live Google Search grounding and
// writes the results into the workspace sheet:
//   Brands Master / Pipeline (if new), News feed, Opportunities.
//
// Used by: "Add brand → research with AI", "Refresh research" on a brand page,
// the setup wizard's bulk research, and "Track this brand" in Competitor Watch.
//
// Body: { brand, profile, context?, brandInfo?, write? (default true) }

const { authorize, workspace, bridge, gemini, resolveSources, verifyUrl, companyBlurb, handle } = require("./_lib/common");

const SIGNAL_TYPES = [
  "Retail Expansion", "New Store / Experience Zone", "Product Launch", "Leadership Change",
  "Festive / Seasonal Campaign", "Distribution / Channel Partnership", "Manufacturing / Capex",
  "Funding / Financials", "Marketing Campaign", "Hiring / Workforce", "Other",
];

module.exports = handle(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!authorize(req, res)) return;
  const ws = workspace(req);

  const { brand, profile, context, brandInfo, write = true } = req.body || {};
  if (!brand || !String(brand).trim()) return res.status(400).json({ error: "brand is required" });
  const name = String(brand).trim();
  const co = companyBlurb(profile);
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `You are a B2B sales-intelligence analyst working for ${co.company}${co.website ? ` (${co.website})` : ""}.
${co.company} sells: ${co.servicesText}.
${co.pitch ? `Positioning: ${co.pitch}` : ""}

TASK: Research the brand "${name}" in ${co.geography} (sector focus: ${co.sectors}). Use Google Search. Today is ${today}.
The goal is to find REAL, RECENT (preferably the last 90 days) moves by this brand that create a reason for ${co.company} to reach out about: ${co.servicesText}.
Look for: new/expanded retail stores, exclusive/experience stores, distribution or channel changes, product launches that need in-store demo/merchandising, festive or seasonal campaigns, leadership changes in sales/marketing/retail, capex or growth targets, workforce/hiring in retail.
${brandInfo && brandInfo.sector ? `Already known: sector=${brandInfo.sector}; segment=${brandInfo.segment || ""}.` : ""}
${context && context.headline ? `Known trigger: "${context.headline}" — ${context.summary || ""}` : ""}

STRICT RULES
- Only report facts you found in search results. If you cannot verify something write "Not publicly confirmed". Never invent headlines, dates, numbers, people or URLs.
- Each signal must have a real publication and, if available, its exact article URL from the search results.
- Dates as YYYY-MM-DD (use YYYY-MM-01 if only a month is known).
- recommendedService must be one of: ${co.services.map((s) => `"${s}"`).join(", ")} (or a combination joined with " + ").
- Signal categories allowed: ${SIGNAL_TYPES.join(", ")}.

Return ONLY a JSON object, no markdown, in exactly this shape:
{
  "profile": {
    "sector": "", "segment": "", "priorityTier": "High|Medium|Low",
    "website": "bare domain e.g. example.com", "hqIndia": "city, state",
    "statusNotes": "1-2 sentences: why this brand matters to ${co.company} right now"
  },
  "signals": [
    { "date": "YYYY-MM-DD", "headline": "", "category": "", "source": "publication", "url": "", "summary": "2 sentences, facts only", "whyItMatters": "1 sentence on the in-store / field-force implication" }
  ],
  "opportunities": [
    { "type": "signal category", "businessImpact": "what is happening and its scale", "opportunityForUs": "specific way ${co.company} can help", "recommendedService": "", "contactDept": "e.g. Retail Operations / Trade Marketing / Sales", "nextAction": "one concrete next step", "whyNow": "timing trigger", "priorityScore": 1-5, "confidenceScore": 1-5, "linkedSignal": 1 }
  ]
}
Give 2-5 signals (newest first) and 1-3 opportunities ranked best first. If nothing recent is verifiable return an empty "signals" array and one low-confidence opportunity.`;

  let r, resolved = [], grounded = false, model = "", warning = "";
  try {
    const out = await gemini(ws, prompt, { search: true, temperature: 0.2, maxOutputTokens: 6000 });
    r = out.data;
    grounded = out.grounded;
    model = out.model;
    resolved = await resolveSources(out.sources, 12);
    if (!grounded) warning = "Search grounding was unavailable (quota). Results are model knowledge only — verify before outreach.";
  } catch (err) {
    err.status = err.status || 502;
    throw err;
  }

  const p = r.profile || {};
  const signals = (Array.isArray(r.signals) ? r.signals : []).slice(0, 5).map((s) => ({
    ...s,
    url: grounded ? verifyUrl(s.url, s.source, resolved) : "",
  }));
  const opps = (Array.isArray(r.opportunities) ? r.opportunities : []).slice(0, 3);
  const clampScore = (v, d) => Math.max(1, Math.min(5, Math.round(Number(v)) || d));

  const brandRow = {
    "Brand": name,
    "Sector": p.sector || (brandInfo && brandInfo.sector) || co.sectors.split(/[|,]/)[0].trim(),
    "Segment": p.segment || (brandInfo && brandInfo.segment) || "",
    "Priority Tier": ["High", "Medium", "Low"].includes(p.priorityTier) ? p.priorityTier : "Medium",
    "Website": (p.website || (brandInfo && brandInfo.website) || "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
    "HQ / India Office": p.hqIndia || (brandInfo && brandInfo.hq) || "",
    "Status Notes": p.statusNotes || "",
    "Date Added": today,
  };
  const pipelineRow = { "Brand": name, "Stage": "Prospect", "Owner": (profile && profile.ownerName) || "", "Last Update": today, "Next Follow-up Date": "", "Notes": "Added with AI research — verify before outreach." };

  const newsRows = signals.filter((s) => s.headline).map((s) => ({
    "Brand": name,
    "Date": s.date || today,
    "Headline": s.headline,
    "Category": SIGNAL_TYPES.includes(s.category) ? s.category : "Other",
    "AI Summary": s.summary || "",
    "Source": s.source || "",
    "URL": s.url || "",
    "Why It Matters": s.whyItMatters || "",
  }));
  const oppRows = opps.filter((o) => o.opportunityForUs || o.businessImpact).map((o) => ({
    "Brand": name,
    "Opportunity Type": o.type || "Retail Expansion",
    "Business Impact": o.businessImpact || "",
    "Opportunity for Channelplay": [o.opportunityForUs, o.whyNow ? `Why now: ${o.whyNow}` : ""].filter(Boolean).join(" "),
    "Confidence Score (1-5)": clampScore(o.confidenceScore, 3),
    "Priority Score (1-5)": clampScore(o.priorityScore, 3),
    "Recommended Service": o.recommendedService || co.services[0],
    "Recommended Contact Department": o.contactDept || "Retail Operations / Trade Marketing",
    "Suggested Next Action": o.nextAction || "",
    "Linked News Ref": o.linkedSignal && newsRows[o.linkedSignal - 1] ? newsRows[o.linkedSignal - 1].Headline : "",
  }));

  let written = null;
  if (write) {
    const add = await bridge(ws, { action: "addBrand", brand: brandRow, pipeline: pipelineRow });
    const news = newsRows.length ? await bridge(ws, { action: "appendRows", sheet: "News feed", rows: newsRows, dedupeOn: ["Brand", "Headline"] }) : { added: 0 };
    const opp = oppRows.length ? await bridge(ws, { action: "appendRows", sheet: "Opportunities", rows: oppRows, dedupeOn: ["Brand", "Opportunity Type", "Suggested Next Action"] }) : { added: 0 };
    written = { brandAdded: add.brandAdded !== false, news: news.added ?? newsRows.length, opportunities: opp.added ?? oppRows.length };
  }

  res.status(200).json({ ok: true, brand: brandRow, signals: newsRows, opportunities: oppRows, grounded, model, warning, written });
});
