// Vercel serverless function: "+ Track this brand" on the Competitor Watch
// page calls this. It researches a competitor/adjacent brand via Gemini
// (grounded with Google Search so it isn't just guessing from training
// data), then writes it straight into Brands Master, Pipeline, News feed,
// Opportunities, and a Contacts placeholder row -- via the Apps Script
// write bridge, server-to-server (no URL length limits here, unlike the
// browser-based automation writes elsewhere in this project).
//
// Required environment variables (in addition to DASHBOARD_PASSWORD,
// APPS_SCRIPT_URL, APPS_SCRIPT_SECRET already used by sheet-write.js):
//   GEMINI_API_KEY  - from https://aistudio.google.com/apikey
//   GEMINI_MODEL    - optional, defaults to "gemini-2.0-flash"
//
// This never fabricates contact names/emails/phones -- the Contacts row it
// creates is intentionally left blank pending a real research pass, same
// as every other "Not yet researched" row in that sheet.

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
    const { brand } = req.body || {};
    if (!brand) {
      res.status(400).json({ error: "brand is required" });
      return;
    }

    const prompt = `You are a B2B sales research analyst for Channelplay, an Indian retail-execution and field-force outsourcing company (services: Visual Merchandising, Retail Execution, Promoter Staffing, Payroll Outsourcing, Merchandising Audits, Mystery Audits, Brand Activation, Sales Promotion, Retail Technology, Field Force Automation, Retail Analytics).

Research the consumer brand "${brand}" in the Indian market using real, current, verifiable information. Respond with ONLY a JSON object (no markdown code fences, no commentary) with exactly these keys:
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

    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 3000 },
        }),
      }
    );
    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      throw new Error(`Gemini API error ${geminiResp.status}: ${errText}`);
    }
    const geminiData = await geminiResp.json();
    const finishReason = geminiData.candidates?.[0]?.finishReason;
    const rawText = (geminiData.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Gemini returned no usable content (finishReason: ${finishReason || "unknown"}). Try again.`);
    let r;
    try {
      r = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error(`Gemini's response was truncated or malformed (finishReason: ${finishReason || "unknown"}). Try again.`);
    }

    const today = new Date().toISOString().slice(0, 10);
    const brandRow = {
      "Brand": brand,
      "Sector": r.sector || "",
      "Segment": r.segment || "",
      "Priority Tier": ["High", "Medium", "Low"].includes(r.priorityTier) ? r.priorityTier : "Low",
      "Website": r.website || "",
      "HQ / India Office": r.hqIndia || "",
      "Status Notes": (r.statusNotes || "") + " (Auto-added from Competitor Watch, researched via Gemini -- verify before outreach.)",
      "Date Added": today,
    };
    const pipelineRow = {
      "Brand": brand, "Stage": "Prospect", "Owner": "", "Last Update": today,
      "Next Follow-up Date": "", "Notes": "Auto-added via Competitor Watch — verify research before outreach.",
    };
    const newsRow = {
      "Brand": brand, "Date": r.newsDate || today, "Headline": r.newsHeadline || "",
      "Category": r.opportunityType || "", "Source": r.newsSource || "",
      "AI Summary": r.newsSummary || "", "URL": r.newsUrl || "",
    };
    const oppRow = {
      "Brand": brand, "Opportunity Type": r.opportunityType || "", "Business Impact": r.businessImpact || "",
      "Opportunity for Channelplay": r.opportunityForChannelplay || "", "Recommended Service": r.recommendedService || "",
      "Recommended Contact Department": r.recommendedContactDept || "", "Suggested Next Action": r.suggestedNextAction || "",
      "Priority Score (1-5)": Math.max(1, Math.min(5, Number(r.priorityScore) || 3)),
      "Confidence Score (1-5)": Math.max(1, Math.min(5, Number(r.confidenceScore) || 2)),
    };
    const contactRow = {
      "Brand": brand, "Decision Maker Name": "", "Designation": "", "Department": r.recommendedContactDept || "",
      "LinkedIn Profile": "", "Official Email (public only)": "", "Official Contact Number (public only)": "",
      "Company Website": r.website || "", "Office Location": r.hqIndia || "",
      "Research Status": "Not yet researched — brand auto-added via Competitor Watch",
    };

    await postToAppsScript({ action: "addBrand", brand: brandRow, pipeline: pipelineRow });
    await postToAppsScript({ action: "appendRows", sheet: "News feed", rows: [newsRow] });
    await postToAppsScript({ action: "appendRows", sheet: "Opportunities", rows: [oppRow] });
    await postToAppsScript({ action: "appendRows", sheet: "Contacts", rows: [contactRow] });

    res.status(200).json({ ok: true, brand: brandRow, researched: r });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to research/add brand" });
  }
};

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
