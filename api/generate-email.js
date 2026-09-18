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
    const {
      brand,
      sector,
      segment,
      topOpportunity,
      recentNews,
      contactName: rawContactName,
      contactDesignation,
      signature,
      signatureHtml: customSignatureHtml,
      senderName,
      senderDesignation,
      senderCompany,
      companyName,
      senderPhone,
      phoneNumber,
      senderEmail,
      companyWebsite
    } = req.body || {};

    if (!brand) {
      res.status(400).json({ error: "brand is required" });
      return;
    }

    const rawContact = rawContactName || "";
    const contactName = (rawContact.length > 1 && rawContact.toLowerCase() !== (brand || "").toLowerCase() && !/^(not public|pending|unknown|unverified|tbd|n\/a|none)/i.test(rawContact)) ? rawContact.trim() : "";

    const channelplayContext = await fetchChannelplayContext();

    const newsBlock = (recentNews || []).length
      ? recentNews.map(n => `- [${n.date}] ${n.headline} (${n.source}): ${n.summary}`).join("\n")
      : "No recent news items on file for this brand yet.";

    const prompt = `You are a senior B2B enterprise sales director and pitch copywriter for Channelplay (https://www.channelplay.in), India's leading retail-execution, sales-force outsourcing, visual merchandising, and tech-driven retail audit company.

Your task is to write a comprehensive, highly persuasive, well-structured, and longer outreach email tailored to ${brand} (sector: ${sector || "Consumer Electronics / Tech"}, segment: ${segment || "Retail / Consumer Products"}).

RECIPIENT:
${contactName ? `${contactName}${contactDesignation ? ", " + contactDesignation : ""}` : "the Head of Marketing / Sales / Retail Director (use \"[Name]\" as placeholder)"}

RECENT NEWS / SIGNALS FOR THIS BRAND (roughly last 2 months):
${newsBlock}

TOP IDENTIFIED OPPORTUNITY & STRATEGIC ANGLE:
${topOpportunity ? `Type: ${topOpportunity.type}\nBusiness impact: ${topOpportunity.businessImpact}\nWhy this matters for Channelplay: ${topOpportunity.opportunityForChannelplay}\nRecommended service: ${topOpportunity.recommendedService}\nSuggested next action: ${topOpportunity.nextAction}` : "Infer a strong, plausible retail execution and counter-expansion angle from the recent news and Indian retail festive/seasonal dynamics."}

LIVE CHANNELPLAY WEBSITE CONTEXT (ground your pitch in these real capabilities and services):
${channelplayContext || "Channelplay specializes in: (1) Experiential Sales Force & Promoter Outsourcing (>90% fill rate, <5.5% attrition, rapid pan-India deployment), (2) Visual Merchandising & POSM Execution across MBOs & brand stores, (3) Retail Audits & Mystery Shopping, (4) 1Channel Technology Platform for automated selfie check-in, attendance, counter sales & stock intelligence."}

CRITICAL DRAFTING INSTRUCTIONS:
1. Make the email longer and richer than a generic short pitch. It must read like an executive-level strategic advisory note.
2. Hook Line: Address the recipient warmly, greeting them specifically as "Hello <Name>" (e.g. "Hello ${contactName || "Rajiv"}," or "Hello [Name],"). Never use "Hi". Never invent single-letter initials like "Hello B,". Congratulate or reference their recent brand news, product launches, or retail expansion.
3. Market Context & In-Store Challenges (1 comprehensive paragraph): Discuss the reality of translating brand buzz/launches into retail counter conversions in India (e.g., cut-throat shelf competition in multi-brand stores, untrained third-party retail staff, promoter attrition, premium experiential demo requirements).
4. Business Synergies & Channelplay Value (1 comprehensive paragraph): Clearly articulate how Channelplay acts as an extension of ${brand}'s sales leadership to capture counter share and ensure pristine brand presence.
5. Key Capabilities & Highlights: Provide 3 to 4 specific bullet points showcasing Channelplay's proven capabilities directly relevant to ${brand} (e.g., dedicated promoters with proven >90% fill rate and low attrition, pan-India visual merchandising & POSM rollout, 1Channel mobile tech for live counter visibility, compliance audits).
6. Strategic Closing: Summarize the mutual advantage of executing this ahead of the upcoming sales/festive cycle.
7. Soft Hook: A polite, zero-pressure invitation for a 10-15 minute introductory exchange next week.`;

    const FALLBACK_MODELS = [
      process.env.GEMINI_MODEL || "gemini-2.0-flash",
      "gemini-2.5-flash-lite",
      "gemini-1.5-flash",
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
                temperature: 0.65,
                maxOutputTokens: 3500,
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    subject: { type: "STRING" },
                    hookLine: { type: "STRING" },
                    marketContext: { type: "STRING" },
                    synergiesParagraph: { type: "STRING" },
                    capabilities: {
                      type: "ARRAY",
                      items: { type: "STRING" }
                    },
                    strategicClosing: { type: "STRING" },
                    softHook: { type: "STRING" }
                  },
                  required: ["subject", "hookLine", "marketContext", "synergiesParagraph", "capabilities", "strategicClosing", "softHook"],
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
        if (parsed) {
          if (parsed.hookLine) {
            parsed.hookLine = parsed.hookLine.replace(/^Hi\s+/i, "Hello ");
            if (contactName) {
              parsed.hookLine = parsed.hookLine.replace(/^(?:Hello|Hi|Dear)\s+[^,]+,/i, `Hello ${contactName},`);
              if (!parsed.hookLine.includes(contactName)) {
                parsed.hookLine = `Hello ${contactName}, ${parsed.hookLine.replace(/^(?:Hello|Hi|Dear)\s*\[?Name\]?[,\s]*/i, "")}`;
              }
            }
          }
          break;
        }
      } catch (err) {
        lastErr = err;
        console.warn(`Email generation on ${model} failed: ${err.message}`);
        if (err.message.includes("404")) continue;
        if (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED")) {
          await new Promise(r => setTimeout(r, 1200));
        }
      }
    }

    const sName = senderName || "Bikash Roy";
    const sDesig = senderDesignation || "Business Manager - Consumer Electronics";
    const sComp = companyName || senderCompany || "Channelplay Limited";
    const sEmail = senderEmail || "bikash.roy1@channelplay.in";
    const sPhone = phoneNumber || senderPhone || "8509950431";
    const sWeb = companyWebsite || "https://www.channelplay.in";

    let signaturePlain = signature || "";
    let signatureHtml = customSignatureHtml || "";

    if (!signaturePlain) {
      signaturePlain = `Warm regards,\n\n${sName}\n${sDesig} • ${sComp}\n📧 ${sEmail} 📞 ${sPhone} 🌐 ${sWeb}\nRetail Execution • Field Force Outsourcing • Visual Merchandising • Tech Audits`;
    }

    const styledTagline = `<div class="email-signature-tagline" style="margin-top:14px;font-size:14px;line-height:1.4;border:none;"><span style="color:#0f5c1b;font-weight:700;font-style:italic;">Retail Execution</span> <span style="color:#000000;font-weight:700;">&bull;</span> <span style="color:#de691a;font-weight:700;font-style:italic;">Field Force Outsourcing</span> <span style="color:#000000;font-weight:700;">&bull;</span> <span style="color:#164e86;font-weight:700;font-style:italic;">Visual Merchandising</span> <span style="color:#000000;font-weight:700;">&bull;</span> <span style="color:#773e9b;font-weight:700;font-style:italic;">Tech Audits</span></div>`;

    if (!signatureHtml) {
      if (signature && signature.includes("<") && signature.includes(">")) {
        signatureHtml = signature;
      } else {
        signatureHtml = `
<div class="email-signature-card" style="margin-top:20px;padding-top:8px;border:none;font-family:Arial,-apple-system,sans-serif;font-size:13px;line-height:1.6;color:#1e293b;">
  <p style="margin:0 0 12px 0;color:#334155;">Warm regards,</p>
  <p style="margin:0 0 4px 0;font-weight:700;font-size:14px;color:#0f172a;">${escapeHtmlServer(sName)}</p>
  <p style="margin:0 0 8px 0;color:#475569;font-size:13px;">${escapeHtmlServer(sDesig)} &bull; <strong style="color:#0f172a;">${escapeHtmlServer(sComp)}</strong></p>
  <div style="margin:0 0 8px 0;font-size:12.5px;color:#64748b;display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
    <span>&#128231; <a href="mailto:${escapeHtmlServer(sEmail)}" style="color:#2563eb;text-decoration:underline;">${escapeHtmlServer(sEmail)}</a></span>
    <span>&#128222; <span style="color:#0f172a;">${escapeHtmlServer(sPhone)}</span></span>
    <span>&#127760; <a href="${escapeHtmlServer(sWeb)}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:underline;">${escapeHtmlServer(sWeb)}</a></span>
  </div>
  ${styledTagline}
</div>`;
      }
    }

    if (signatureHtml) {
      signatureHtml = signatureHtml
        .replace(/border-top:[^;"]+;?/gi, "border:none;")
        .replace(/border-bottom:[^;"]+;?/gi, "border:none;")
        .replace(/<hr[^>]*>/gi, "");
      signatureHtml = signatureHtml.replace(/<div[^>]*>[\s\S]*?Retail Execution[\s\S]*?Tech Audits[\s\S]*?<\/div>/i, styledTagline);
    }

    if (!parsed) {
      const recipientGreeting = contactName || "[Name]";
      parsed = {
        subject: `Partnering on ${brand}'s Retail Counter Velocity & In-Store Execution`,
        hookLine: `Hello ${recipientGreeting}, congratulations on ${brand}'s recent market initiatives and festive product rollout across the Indian market.`,
        marketContext: `As ${brand} accelerates its distribution footprint across regional multi-brand outlets (MBOs) and exclusive store touchpoints, ensuring consistent brand governance and active shopper engagement at the final moment of purchase is paramount. Many leading brands face critical hurdles around promoter retention, live demonstration compliance, and fragmented visibility across Tier-1 and Tier-2 counters.`,
        synergiesParagraph: `At Channelplay, we operate as a full-funnel retail execution partner. We bridge the gap between your above-the-line marketing investments and ground-level sell-through by deploying highly trained, technology-enabled sales promoters and managing agile visual merchandising operations. For benchmark consumer electronics and AV leaders, our dedicated programs have driven immediate uplifts in counter share while keeping attrition to industry-low levels.`,
        capabilities: [
          `Experiential Field Force & Promoter Staffing: Rapid deployment of certified, tech-savvy brand ambassadors with a proven 90%+ fill rate and 5.3% promoter attrition.`,
          `Visual Merchandising & POSM Governance: Flawless pan-India fixture deployment, display hygiene, and secondary placement audits across high-traffic retail counters.`,
          `Technology-Driven Visibility via 1Channel: Real-time counter analytics, GPS-verified attendance, selfie check-ins, and daily SKU-level sales reporting directly accessible to your leadership team.`,
          `High-Impact Product Demonstrations: Standardized customer journey scripts and experiential demo stations tailored to maximize conversion rates for premium lineups.`
        ],
        strategicClosing: `With the festive retail momentum currently underway, aligning on an agile in-store execution model can directly amplify your conversion rate across priority multi-brand counters and exclusive retail touchpoints.`,
        softHook: `Would you be open to a brief 10–15 minute introductory conversation next week to explore how we can support ${brand}'s retail execution objectives?`
      };
    }

    const bodyHtml = `
<div class="email-rich-wrap" style="font-family:Arial,-apple-system,sans-serif;font-size:13.5px;line-height:1.68;color:#1e293b;">
  <p class="email-hook" style="font-weight:700;margin-bottom:14px;color:#0f172a;font-size:14px;line-height:1.6;">${escapeHtmlServer(parsed.hookLine || "")}</p>
  <p class="email-context" style="margin-bottom:14px;color:#334155;line-height:1.68;">${escapeHtmlServer(parsed.marketContext || "")}</p>
  <p class="email-synergies" style="margin-bottom:14px;color:#334155;line-height:1.68;">${escapeHtmlServer(parsed.synergiesParagraph || "")}</p>
  
  <div class="email-capabilities-block" style="margin:18px 0 16px 0;">
    <p style="font-weight:700;font-size:13.5px;color:#0f172a;margin:0 0 8px 0;">Key Channelplay Capabilities &amp; Business Synergies:</p>
    <ul class="email-cap-list" style="margin:0;padding-left:20px;color:#334155;font-size:13px;line-height:1.65;">
      ${(parsed.capabilities || []).map(c => {
        const colonIdx = c.indexOf(":");
        if (colonIdx > 0) {
          const title = c.slice(0, colonIdx + 1).trim();
          const desc = c.slice(colonIdx + 1).trim();
          return `<li style="margin-bottom:7px;"><strong style="color:#0f172a;">${escapeHtmlServer(title)}</strong> ${escapeHtmlServer(desc)}</li>`;
        }
        return `<li style="margin-bottom:7px;">${escapeHtmlServer(c)}</li>`;
      }).join("\n      ")}
    </ul>
  </div>
  
  <p class="email-closing" style="margin-bottom:14px;color:#334155;line-height:1.68;">${escapeHtmlServer(parsed.strategicClosing || "")}</p>
  <p class="email-softhook" style="font-weight:700;margin:16px 0;color:#0f172a;font-size:13.5px;line-height:1.6;">${escapeHtmlServer(parsed.softHook || "")}</p>
  
  <div class="email-signature-wrap" style="margin-top:20px;border:none;">
    ${signatureHtml}
  </div>
</div>`;

    const plainBody = [
      parsed.hookLine,
      parsed.marketContext,
      parsed.synergiesParagraph,
      "Key Channelplay Capabilities & Business Synergies:",
      ...(parsed.capabilities || []).map(c => `• ${c}`),
      parsed.strategicClosing,
      parsed.softHook,
      signaturePlain
    ].filter(Boolean).join("\n\n");

    res.status(200).json({
      subject: parsed.subject || `Supporting ${brand}'s retail execution with Channelplay`,
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
