// Vercel serverless function: "+ Track this brand" on the Competitor Watch
// page calls this. It researches a competitor/adjacent brand via Gemini
// (grounded with Google Search so it isn't just guessing from training
// data), then writes it straight into Brands Master, Pipeline, News feed,
// Opportunities, and a Contacts placeholder row -- via the Apps Script
// write bridge, server-to-server.
//
// Required environment variables:
//   GEMINI_API_KEY  - from https://aistudio.google.com/apikey
//   GEMINI_MODEL    - optional, defaults to "gemini-2.0-flash"
//   DASHBOARD_PASSWORD, APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || "gemini-2.0-flash",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
  "gemini-2.0-flash-lite",
];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const suppliedPassword = req.headers["x-dashboard-password"];
  if (!process.env.DASHBOARD_PASSWORD || suppliedPassword !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server. Add it in Vercel project settings." });
    return;
  }

  try {
    const { brand, context } = req.body || {};
    if (!brand) {
      res.status(400).json({ error: "brand is required" });
      return;
    }

    const prompt = `You are a B2B sales research analyst for Channelplay, an Indian retail-execution and field-force outsourcing company (services: Visual Merchandising, Retail Execution, Promoter Staffing, Payroll Outsourcing, Merchandising Audits, Mystery Audits, Brand Activation, Sales Promotion, Retail Technology, Field Force Automation, Retail Analytics).

Research the consumer brand "${brand}" in the Indian market using real, current, verifiable information.
${context && context.headline ? `KNOWN CONTEXT FROM RECENT SIGNALS: Headline: "${context.headline}", Summary: "${context.summary || ""}", Category: "${context.category || ""}"` : ""}

Respond with ONLY a JSON object (no markdown code fences, no commentary) with exactly these keys:
{
  "sector": "",
  "segment": "",
  "priorityTier": "High or Medium or Low",
  "website": "bare domain, e.g. example.com",
  "hqIndia": "city, state",
  "statusNotes": "1-2 sentence summary of why this brand is relevant to Channelplay right now",
  "newsHeadline": "",
  "newsDate": "YYYY-MM-DD, your best estimate of a genuinely recent date",
  "newsSource": "publication name",
  "newsSummary": "2-3 sentences",
  "newsUrl": "URL if known, else empty string",
  "opportunityType": "one of the Channelplay services listed above",
  "businessImpact": "",
  "opportunityForChannelplay": "",
  "recommendedService": "",
  "recommendedContactDept": "",
  "suggestedNextAction": "",
  "priorityScore": integer 1-5,
  "confidenceScore": integer 1-5
}

If you cannot verify a fact, write "Not publicly confirmed" for that field rather than inventing it. Do not fabricate news, dates, sources, or figures.`;

    let r = null;
    let fallbackUsed = false;

    try {
      r = await callGeminiWithFallbacks(prompt);
    } catch (geminiErr) {
      console.warn("All Gemini API calls encountered rate limits or errors:", geminiErr.message);
      // Generate intelligent fallback research record from available context so brand is still tracked
      r = generateFallbackResearch(brand, context);
      fallbackUsed = true;
    }

    const today = new Date().toISOString().slice(0, 10);
    const brandRow = {
      "Brand": brand,
      "Sector": r.sector || "Consumer Electronics",
      "Segment": r.segment || (context?.category || "Large Appliances & Electronics"),
      "Priority Tier": ["High", "Medium", "Low"].includes(r.priorityTier) ? r.priorityTier : "High",
      "Website": r.website || `${brand.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
      "HQ / India Office": r.hqIndia || "India",
      "Status Notes": (r.statusNotes || "") + (fallbackUsed ? " (Researched via recorded market signals — Gemini quota was rate-limited.)" : " (Auto-added from Competitor Watch, researched via Gemini -- verify before outreach.)"),
      "Date Added": today,
    };
    const pipelineRow = {
      "Brand": brand, "Stage": "Prospect", "Owner": "", "Last Update": today,
      "Next Follow-up Date": "", "Notes": "Auto-added via Competitor Watch — verify research before outreach.",
    };
    const newsRow = {
      "Brand": brand, "Date": r.newsDate || today, "Headline": r.newsHeadline || (context?.headline || `${brand} active in Indian market`),
      "Category": r.opportunityType || (context?.category || "Market Move"), "Source": r.newsSource || (context?.source || "Competitor Watch"),
      "AI Summary": r.newsSummary || (context?.summary || ""), "URL": r.newsUrl || (context?.url || ""),
    };
    const oppRow = {
      "Brand": brand, "Opportunity Type": r.opportunityType || "Promoter Staffing", "Business Impact": r.businessImpact || "In-store promoter activation and shelf-share defense.",
      "Opportunity for Channelplay": r.opportunityForChannelplay || "Channelplay promoter deployment and retail execution audit.", "Recommended Service": r.recommendedService || "Promoter Staffing",
      "Recommended Contact Department": r.recommendedContactDept || "Trade Marketing / Sales", "Suggested Next Action": r.suggestedNextAction || "Engage trade marketing team for promoter audit.",
      "Priority Score (1-5)": Math.max(1, Math.min(5, Number(r.priorityScore) || 4)),
      "Confidence Score (1-5)": Math.max(1, Math.min(5, Number(r.confidenceScore) || 3)),
    };
    const contactRow = {
      "Brand": brand, "Decision Maker Name": "", "Designation": "", "Department": r.recommendedContactDept || "Sales & Trade Marketing",
      "LinkedIn Profile": "", "Official Email (public only)": "", "Official Contact Number (public only)": "",
      "Company Website": r.website || "", "Office Location": r.hqIndia || "India",
      "Research Status": "Not yet researched — brand auto-added via Competitor Watch",
    };

    await postToAppsScript({ action: "addBrand", brand: brandRow, pipeline: pipelineRow });
    await postToAppsScript({ action: "appendRows", sheet: "News feed", rows: [newsRow] });
    await postToAppsScript({ action: "appendRows", sheet: "Opportunities", rows: [oppRow] });
    await postToAppsScript({ action: "appendRows", sheet: "Contacts", rows: [contactRow] });

    res.status(200).json({ ok: true, brand: brandRow, researched: r, fallbackUsed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to research/add brand" });
  }
};

async function callGeminiWithFallbacks(prompt) {
  let lastErr = null;
  const uniqueModels = [...new Set(FALLBACK_MODELS)];

  for (const model of uniqueModels) {
    // 1. Try with Google Search Grounding
    try {
      return await callGeminiModel(model, prompt, true);
    } catch (err) {
      lastErr = err;
      console.warn(`Gemini (${model}) with search failed: ${err.message}`);
    }

    // 2. Try without Search Grounding (higher rate limits / less quota usage)
    try {
      return await callGeminiModel(model, prompt, false);
    } catch (err) {
      lastErr = err;
      console.warn(`Gemini (${model}) direct failed: ${err.message}`);
      if (err.message.includes("429") || err.message.includes("quota") || err.message.includes("RESOURCE_EXHAUSTED")) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }
  }

  throw lastErr || new Error("All Gemini models encountered rate limits.");
}

async function callGeminiModel(model, prompt, useSearch) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 3000 },
  };
  if (useSearch) {
    body.tools = [{ google_search: {} }];
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const geminiResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!geminiResp.ok) {
    const errText = await geminiResp.text();
    let msg = errText;
    try {
      const j = JSON.parse(errText);
      if (j.error && j.error.message) msg = j.error.message;
    } catch (_) {}
    throw new Error(`Gemini (${model}) ${geminiResp.status}: ${msg}`);
  }

  const geminiData = await geminiResp.json();
  const finishReason = geminiData.candidates?.[0]?.finishReason;
  const rawText = (geminiData.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Gemini returned no usable JSON (finishReason: ${finishReason || "unknown"}).`);
  return JSON.parse(jsonMatch[0]);
}

function generateFallbackResearch(brand, context = {}) {
  const headline = context?.headline || `${brand} expanding presence in Indian market`;
  const summary = context?.summary || `${brand} active in retail electronics and appliance channels in India.`;
  return {
    sector: "Consumer Electronics",
    segment: context?.category || "Appliances & Consumer Tech",
    priorityTier: "High",
    website: `${brand.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
    hqIndia: "India",
    statusNotes: `Tracked from Competitor Watch: "${headline}".`,
    newsHeadline: headline,
    newsDate: context?.date || new Date().toISOString().slice(0, 10),
    newsSource: context?.source || "Competitor Intelligence",
    newsSummary: summary,
    newsUrl: context?.url || "",
    opportunityType: "Promoter Staffing",
    businessImpact: "Retail store presence defense and promoter staffing against aggressive competitor moves.",
    opportunityForChannelplay: "Deploy Channelplay promoters and field execution team to capture floor share.",
    recommendedService: "Promoter Staffing & Merchandising Audit",
    recommendedContactDept: "Trade Marketing & Sales",
    suggestedNextAction: "Verify trade marketing contacts and schedule introductory meeting.",
    priorityScore: 4,
    confidenceScore: 3,
  };
}

async function postToAppsScript(body) {
  const resp = await fetch(process.env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, secret: process.env.APPS_SCRIPT_SECRET }),
    redirect: "follow",
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data;
}
