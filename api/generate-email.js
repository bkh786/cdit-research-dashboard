// Vercel serverless function: generates a personalized outreach email via
// Gemini for the "Generate AI draft" button on a brand detail page.
//
// Grounding sources for the draft:
//   1. Recent news for the brand (last ~2 months), sent by the client --
//      the client already has the full Sheet loaded, so we don't re-fetch
//      Sheets API here, we just take what it sends.
//   2. Channelplay's own live website content (fetched fresh, server-side,
//      on every call) so the pitch references real services/case studies
//      instead of the model guessing from training data.
//
// Required environment variables (in addition to DASHBOARD_PASSWORD):
//   GEMINI_API_KEY  - from https://aistudio.google.com/apikey
//   GEMINI_MODEL    - optional, defaults to "gemini-2.0-flash"

const CHANNELPLAY_URLS = [
  "https://www.channelplay.in/",
  "https://www.channelplay.in/success-stories",
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
    const { brand, sector, segment, topOpportunity, recentNews, contactName, contactDesignation } = req.body || {};
    if (!brand) {
      res.status(400).json({ error: "brand is required" });
      return;
    }

    const channelplayContext = await fetchChannelplayContext();

    const newsBlock = (recentNews || []).length
      ? recentNews.map(n => `- [${n.date}] ${n.headline} (${n.source}): ${n.summary}`).join("\n")
      : "No recent news items on file for this brand yet.";

    const prompt = `You are a senior B2B sales copywriter for Channelplay, an Indian retail-execution and field-force outsourcing company. Write a short, specific outreach email to ${brand} (sector: ${sector || "unknown"}, segment: ${segment || "unknown"}).

RECIPIENT: ${contactName ? `${contactName}${contactDesignation ? ", " + contactDesignation : ""}` : "the relevant decision-maker (use \"[Name]\" as a placeholder)"}

RECENT NEWS / SIGNALS FOR THIS BRAND (roughly the last 2 months):
${newsBlock}

TOP IDENTIFIED OPPORTUNITY:
${topOpportunity ? `Type: ${topOpportunity.type}\nBusiness impact: ${topOpportunity.businessImpact}\nWhy this matters for Channelplay: ${topOpportunity.opportunityForChannelplay}\nRecommended service: ${topOpportunity.recommendedService}\nSuggested next action: ${topOpportunity.nextAction}` : "Not yet scored -- infer a plausible, conservative angle from the news above."}

CHANNELPLAY WEBSITE CONTENT (fetched live just now -- only reference services or case studies that actually appear in this text; do not invent client names, numbers, or case studies that aren't here):
${channelplayContext || "(site content unavailable right now -- describe Channelplay generically as a retail execution and field force outsourcing partner without citing specific case studies or client names)"}

TASK: Write the email content -- subject, hook line, 3-4 short paragraphs (2-3 sentences each, not long blocks) that (1) reference the specific news/signal, (2) connect it to a genuine business need, (3) pitch 1-2 specific Channelplay services relevant to that need, citing a real case study or capability from the website content ONLY if one is genuinely present there, (4) end with a soft call-to-action for a short call, and a sign-off.`;

    const FALLBACK_MODELS = [
      process.env.GEMINI_MODEL || "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
      "gemini-2.0-flash-lite",
    ];

    let parsed = null;
    let lastErr = null;

    for (const model of [...new Set(FALLBACK_MODELS)]) {
      try {
        const geminiResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.6,
                maxOutputTokens: 3000,
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    subject: { type: "STRING" },
                    hookLine: { type: "STRING" },
                    paragraphs: { type: "ARRAY", items: { type: "STRING" } },
                    signOff: { type: "STRING" },
                  },
                  required: ["subject", "hookLine", "paragraphs", "signOff"],
                },
              },
            }),
          }
        );

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
        const rawText = (geminiData.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
        if (!rawText) throw new Error(`Gemini (${model}) returned empty output.`);
        parsed = JSON.parse(rawText);
        if (parsed) break;
      } catch (err) {
        lastErr = err;
        console.warn(`Email generation on ${model} failed: ${err.message}`);
        if (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED")) {
          await new Promise(r => setTimeout(r, 1200));
        }
      }
    }

    if (!parsed) {
      // Fallback deterministic draft if all models encounter rate limits
      parsed = {
        subject: `Supporting ${brand}'s retail execution with Channelplay`,
        hookLine: `Hi ${contactName ? contactName.split(" ")[0] : "[Name]"}, I noticed ${brand}'s recent moves in the Indian market.`,
        paragraphs: [
          `As ${brand} expands its reach across retail and multi-brand store networks, maintaining strong visual merchandising, shelf compliance, and promoter productivity is critical to capturing market share.`,
          `At Channelplay, we specialize in end-to-end retail execution, promoter staffing, and merchandising audits across India, helping brands achieve superior in-store compliance and retail sell-through.`,
          `Would you be open to a brief 15-minute call next week to discuss how we can support ${brand}'s field sales and retail presence?`
        ],
        signOff: "Best regards,\nBikash Roy\nGroup Program Manager, Channelplay"
      };
    }

    const bodyHtml =
      `<p class="email-hook">${escapeHtmlServer(parsed.hookLine || "")}</p>` +
      (parsed.paragraphs || []).map(p => `<p>${escapeHtmlServer(p)}</p>`).join("") +
      `<p>${escapeHtmlServer(parsed.signOff || "Best regards,\nBikash Roy\nGroup Program Manager, Channelplay").replace(/\n/g, "<br>")}</p>`;

    const plainBody = [parsed.hookLine, ...(parsed.paragraphs || []), parsed.signOff].filter(Boolean).join("\n\n");

    res.status(200).json({
      subject: parsed.subject || `${brand} — Channelplay introduction`,
      bodyHtml,
      plainBody,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate email" });
  }
};

async function fetchChannelplayContext() {
  const chunks = [];
  for (const url of CHANNELPLAY_URLS) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; CDIT-Dashboard/1.0)" } });
      if (!r.ok) continue;
      const html = await r.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3500);
      if (text) chunks.push(`--- ${url} ---\n${text}`);
    } catch (e) {
      // skip this page on failure, keep going with whatever else we got
    }
  }
  return chunks.join("\n\n");
}

function escapeHtmlServer(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
