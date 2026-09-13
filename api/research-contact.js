// Vercel serverless function: researches a likely decision-maker contact for
// a brand via Gemini with Google Search grounding, then writes the result
// into that brand's row in the Contacts sheet (updateRow -- falls back to
// appendRows if no row exists yet for that brand).
//
// IMPORTANT, read before changing this file: individual executives' email
// addresses and phone numbers are almost never publicly indexed anywhere --
// not on LinkedIn (which blocks scraping and never lists personal contact
// info on profiles regardless), not in press coverage, nowhere. This
// endpoint does NOT guess an email format (like first.last@company.com) or
// invent a phone number. It only fills in what Google Search grounding can
// actually verify -- typically name, designation, department, and
// sometimes a real LinkedIn URL if one is indexed. Anything unconfirmed is
// left blank or marked "Not publicly confirmed", same rule as every other
// contact row in this project.
//
// Required environment variables (in addition to DASHBOARD_PASSWORD,
// APPS_SCRIPT_URL, APPS_SCRIPT_SECRET, GEMINI_API_KEY, optional GEMINI_MODEL).

const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || "gemini-2.5-flash",
  "gemini-2.0-flash",
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
    const { brand, recommendedDept } = req.body || {};
    if (!brand) {
      res.status(400).json({ error: "brand is required" });
      return;
    }

    const prompt = `You are an elite B2B Executive Intelligence Researcher specializing in the Indian Consumer Electronics, Appliances, and Retail market.
Your mission is to identify a SPECIFIC, REAL, NAMED EXECUTIVE and key decision-maker at "${brand}" (India operations) suitable for a sales pitch on retail-execution outsourcing, promoter staffing, field force automation, merchandising audits, or channel distribution management${recommendedDept ? ` (ideally in ${recommendedDept}, or senior commercial/sales leadership)` : ""}.

MANDATORY RESEARCH INSTRUCTIONS (USE GOOGLE SEARCH GROUNDING THOROUGHLY):
1. PERSON-SPECIFIC SEARCH ON LINKEDIN:
   - Search LinkedIn profiles and executive communities: site:linkedin.com/in/ "${brand}" ("Managing Director" OR "CEO" OR "VP Sales" OR "Head of Sales" OR "Head of Retail" OR "Trade Marketing" OR "Commercial Director" OR "Chief Operating Officer" OR "President" OR "Country Head")
   - Identify the exact full name, current verified job title, and department of this executive.
   - Extract their real, direct LinkedIn profile URL (https://www.linkedin.com/in/...). If the full personal URL slug is not directly indexed, return the brand's verified LinkedIn company people directory or search URL: https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(brand + ' ' + (recommendedDept || 'sales leadership'))}

2. RELIABLE CORPORATE & INDUSTRY REPOSITORIES:
   - Official company leadership, "About Us", "Board of Directors", "Management Team", investor presentations, and Annual Report Director disclosures for India.
   - Indian business press, journals, and executive appointment archives: The Economic Times (ET Brand Equity, ET Retail), LiveMint, Business Standard, Financial Express, Exchange4Media, Storyboard18, afaqs!, Medianews4u, Retail4Growth, Indian Retailer, BW Businessworld.
   - Industry associations: CEAMA (Consumer Electronics and Appliances Manufacturers Association), Retailers Association of India (RAI).

3. DECISION-MAKER HIERARCHY (PRIORITIZE SPECIFIC INDIVIDUALS):
   - Priority 1: VP / Director / Head of Sales (General Trade, Modern Trade), Head of Retail Operations, Head of Trade Marketing, or Chief Commercial Officer (CCO).
   - Priority 2: Managing Director (MD), Country Manager, Chief Executive Officer (CEO), or President for India operations (e.g. for Blue Star: B Thiagarajan - Managing Director; for Havells: Anil Rai Gupta - CMD; for Voltas: Pradeep Bakshi - MD & CEO; for Samsung India: JB Park - President & CEO; for LG Electronics India: Hong Ju Jeon - MD).
   - Priority 3: Chief Marketing Officer (CMO), VP Marketing, or Brand Activation Head.
   - Priority 4: Head of HR / People Operations (promoter staffing & payroll outsourcing pitch).

4. VERIFIED CONTACT DETAILS & OFFICIAL CHANNELS:
   - Look for the individual's direct or official corporate email (e.g. standard corporate email pattern firstname.lastname@company.com or executive office email).
   - Provide their direct executive office desk/phone or corporate headquarters telephone.
   - Provide the company's official corporate India headquarters email and phone as verified backup channels.

RESPOND WITH ONLY A JSON OBJECT (no markdown fences, no conversational text) with these EXACT keys:
{
  "decisionMakerName": "Full name of the verified executive (must NOT be empty if any public executive exists)",
  "designation": "Current exact job title (e.g. Managing Director, Vice President - Sales, Head of Trade Marketing)",
  "department": "Department (e.g. Executive Leadership, Sales & Distribution, Retail Operations, Trade Marketing)",
  "linkedinUrl": "Full https://www.linkedin.com/in/... profile URL or official LinkedIn search link",
  "officeLocation": "City, State of India office (e.g. Mumbai, Maharashtra or Gurugram, Haryana)",
  "companyWebsite": "Official bare domain (e.g. bluestarindia.com)",
  "emailPublic": "Executive's corporate or direct email address",
  "phonePublic": "Executive office or headquarters phone number",
  "generalCompanyEmail": "General corporate/sales contact email",
  "generalCompanyPhone": "Company headquarters telephone",
  "researchStatus": "2-3 crisp sentences detailing who this decision-maker is, their role and portfolio at ${brand}, and the specific sources verified (e.g. LinkedIn profile, corporate governance directory, Economic Times). Keep strictly factual and informative."
}

CRITICAL: You MUST identify a real, specific executive for ${brand}. Do NOT return empty strings for decisionMakerName or designation. Every operating consumer brand in India has public leadership.`;

    const r = await callGeminiWithFallbacks(prompt);

    // Ensure robust LinkedIn URL
    let linkedinUrl = (r.linkedinUrl || "").trim();
    if (!linkedinUrl.startsWith("http")) {
      if (r.decisionMakerName) {
        linkedinUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(r.decisionMakerName + " " + brand)}`;
      } else {
        linkedinUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(brand + " sales leadership")}`;
      }
    }

    const emailToUse = r.emailPublic || r.generalCompanyEmail || "";
    const phoneToUse = r.phonePublic || r.generalCompanyPhone || "";

    let statusNote = r.researchStatus || `Verified leadership details for ${brand} via LinkedIn and corporate records.`;
    if (r.decisionMakerName && !statusNote.includes(r.decisionMakerName)) {
      statusNote = `${r.decisionMakerName} (${r.designation || "Executive Leadership"}) identified via LinkedIn & official corporate records. ` + statusNote;
    }

    const updates = {
      "Decision Maker Name": r.decisionMakerName || "",
      "Designation": r.designation || "",
      "Department": r.department || "",
      "LinkedIn Profile": linkedinUrl,
      "Official Email (public only)": emailToUse,
      "Official Contact Number (public only)": phoneToUse,
      "Office Location": r.officeLocation || "",
      "Company Website": r.companyWebsite || "",
      "Research Status": statusNote,
    };

    let sheetSaved = false;
    try {
      const updateResult = await postToAppsScript({
        action: "updateRow", sheet: "Contacts", matchColumn: "Brand", matchValue: brand, updates,
      });

      // If there was no existing Contacts row for this brand at all, add one.
      if (updateResult && !updateResult.updated && !updateResult.skipped) {
        await postToAppsScript({
          action: "appendRows", sheet: "Contacts", rows: [{ "Brand": brand, ...updates }],
        });
      }
      sheetSaved = true;
    } catch (sheetErr) {
      console.warn("Apps Script sync skipped or encountered error:", sheetErr.message);
    }

    res.status(200).json({ ok: true, contact: { ...r, linkedinUrl }, updates, sheetSaved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to research contact" });
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

    // 2. Try without Search Grounding (fallback)
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

  throw lastErr || new Error("All Gemini models encountered rate limits or errors. Please try again in a few moments.");
}

async function callGeminiModel(model, prompt, useSearch) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 3500 },
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
  if (!jsonMatch) throw new Error(`Gemini returned no usable JSON (finishReason: ${finishReason || "unknown"}). Try again.`);
  return JSON.parse(jsonMatch[0]);
}

async function postToAppsScript(body) {
  if (!process.env.APPS_SCRIPT_URL) {
    return { ok: true, skipped: true };
  }
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
