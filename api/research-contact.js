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
    const { brand, recommendedDept } = req.body || {};
    if (!brand) {
      res.status(400).json({ error: "brand is required" });
      return;
    }

    const prompt = `You are a B2B sales researcher trying to identify the right decision-maker contact at "${brand}" (India operations) for a retail-execution/field-force outsourcing pitch${recommendedDept ? ` -- ideally someone in ${recommendedDept}` : ""}.

Use real, current, verifiable public information only (press coverage, company website, official announcements, publicly indexed profile pages). Respond with ONLY a JSON object (no markdown fences, no commentary) with exactly these keys:
{
  "decisionMakerName": "full name, or empty string if you cannot verify one",
  "designation": "their job title, or empty string",
  "department": "e.g. Retail Operations, Trade Marketing, HR, Channel Sales -- or empty string",
  "linkedinUrl": "a real, complete LinkedIn profile URL ONLY if you found one in search results -- otherwise empty string, do NOT guess or construct a URL",
  "officeLocation": "city, state -- or empty string",
  "companyWebsite": "bare domain -- or empty string",
  "emailPublic": "the named individual's personal/direct email address ONLY if you found it verbatim on a public page -- otherwise empty string. Never construct or guess an email format.",
  "phonePublic": "the named individual's personal/direct phone number ONLY if you found it verbatim on a public page -- otherwise empty string. Never guess.",
  "generalCompanyEmail": "the company's general public contact email for its India operations -- e.g. from the official 'Contact Us' page (sales@, info@, marketing@, or a named department inbox) -- empty string if none found. This is a company channel, not a personal one, so it is fine to report standard published addresses here.",
  "generalCompanyPhone": "the company's general public switchboard/customer-care/regional-office phone number for India -- from its official 'Contact Us' page -- empty string if none found.",
  "researchStatus": "1-2 sentences: what you found, your confidence, and the type of source (e.g. 'press coverage from 2025', 'company leadership page', 'official Contact Us page') -- or explain that nothing could be verified"
}

Do not fabricate anything. If you cannot verify a named individual at all, set decisionMakerName to empty string and explain in researchStatus that no public decision-maker could be confirmed -- but still try to find the company's general contact email/phone from its official website, since that is legitimately public even when no individual is.`;

    const r = await callGeminiWithFallbacks(prompt);

    // Prefer the named individual's own public email/phone. If those aren't
    // publicly indexed (the common case), fall back to the company's general
    // contact channel -- and say so explicitly in Research Status, so nobody
    // mistakes a sales@ inbox for a personal line.
    const usingEmailFallback = !r.emailPublic && !!r.generalCompanyEmail;
    const usingPhoneFallback = !r.phonePublic && !!r.generalCompanyPhone;
    const emailToUse = r.emailPublic || r.generalCompanyEmail || "";
    const phoneToUse = r.phonePublic || r.generalCompanyPhone || "";

    let statusNote = r.researchStatus || "Researched via Gemini + Google Search grounding.";
    if (r.decisionMakerName) statusNote += " Verify via LinkedIn/company before outreach.";
    if (usingEmailFallback || usingPhoneFallback) {
      statusNote += ` Note: ${[usingEmailFallback && "email", usingPhoneFallback && "phone"].filter(Boolean).join(" and ")} shown ${usingEmailFallback && usingPhoneFallback ? "are" : "is"} the company's general contact channel, not personal to the named individual -- no individual-level ${[usingEmailFallback && "email", usingPhoneFallback && "phone"].filter(Boolean).join("/")} is publicly available.`;
    }

    const updates = {
      "Decision Maker Name": r.decisionMakerName || "",
      "Designation": r.designation || "",
      "Department": r.department || "",
      "LinkedIn Profile": r.linkedinUrl || "",
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

    res.status(200).json({ ok: true, contact: r, updates, sheetSaved });
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

    // 2. Try without Search Grounding (higher rate limits / fallback)
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
    generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
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
