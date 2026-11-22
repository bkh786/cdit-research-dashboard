// Finds the likely decision-maker(s) at a brand via Gemini + Google Search
// grounding and saves them to the Contacts tab.
//
// Honesty rules (do not remove):
//  * Individual e-mail addresses and mobile numbers are rarely public. We NEVER
//    guess an e-mail pattern or invent a number. Only values found in search
//    results are saved; a general company address is labelled as such.
//  * A LinkedIn profile URL is saved only if it appears in the real (resolved)
//    search results. Otherwise we save a LinkedIn *people-search* link so the
//    user is one click away from the right person.
//
// Body: { brand, profile, recommendedDept?, mode: "update" | "append" }

const { authorize, workspace, bridge, upsert, gemini, resolveSources, companyBlurb, handle } = require("./_lib/common");

const DEFAULT_ROLES = [
  "Head of Marketing / CMO / VP Marketing / Director Marketing",
  "Head of Trade Marketing / Retail Marketing / Channel Marketing",
  "Head of Sales / VP Sales / National Sales Head / Retail Sales Head",
  "Head of Retail Operations / Retail Execution / Customer Experience",
  "Business Head / Managing Director / Country Head (only if the above cannot be found)",
];

function linkedinProfile(url) {
  const m = String(url || "").match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/in/${m[1].replace(/\/+$/, "")}/` : "";
}

module.exports = handle(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!authorize(req, res)) return;
  const ws = workspace(req);

  const { brand, profile, recommendedDept, mode = "update" } = req.body || {};
  if (!brand) return res.status(400).json({ error: "brand is required" });
  const name = String(brand).trim();
  const co = companyBlurb(profile);
  const roles = (profile && profile.buyerRoles) ? String(profile.buyerRoles).split("|").map((s) => s.trim()).filter(Boolean) : DEFAULT_ROLES;

  const prompt = `You are a B2B sales-intelligence researcher working for ${co.company}, which sells: ${co.servicesText}.
Find the best-fit buyer at "${name}" (${co.geography} operations) for those services.
${recommendedDept ? `Preferred department: ${recommendedDept}.` : ""}

Role priority (search in this order):
${roles.map((r, i) => `${i + 1}. ${r}`).join("\n")}

How to search:
- Google: "${name}" ${co.geography} "Head of Marketing" OR "VP Sales" OR "Trade Marketing" etc.
- Verify current role via business press (ET BrandEquity, afaqs, Exchange4Media, Storyboard18, Mint, Economic Times, Indian Retailer, company press releases) and the brand's own website / newsroom.
- LinkedIn: site:linkedin.com/in "<Full Name>" "${name}"

Rules:
- Report ONLY what you actually found. If unsure write "" for that field. Never invent names, e-mails, phone numbers or LinkedIn URLs. Never guess an e-mail from a pattern.
- A person's role must be current (not a past role). If there is a recent leadership change, return the new person.
- "emailPublic" only if an individual's business e-mail is published. "generalEmail" is a general/corporate/PR/customer-care address found on the official site.
- Provide up to 2 people (best first).

Return ONLY JSON:
{ "contacts": [ {
  "name": "", "designation": "", "department": "", "linkedinUrl": "", "location": "city, state",
  "emailPublic": "", "phonePublic": "", "generalEmail": "", "generalPhone": "",
  "website": "bare domain", "evidence": "1-2 sentences: where you found this and how recent", "confidence": "High|Medium|Low"
} ] }`;

  const out = await gemini(ws, prompt, { search: true, temperature: 0.1, maxOutputTokens: 3000 });
  const resolved = await resolveSources(out.sources, 14);
  const verifiedLinkedIn = resolved.map((s) => linkedinProfile(s.url)).filter(Boolean);

  const list = (Array.isArray(out.data.contacts) ? out.data.contacts : [out.data]).filter((c) => c && (c.name || c.generalEmail || c.generalPhone)).slice(0, 2);
  if (!list.length) {
    return res.status(200).json({ ok: true, found: false, contacts: [], note: "No verifiable decision-maker found. Try again later or add one manually." });
  }

  const saved = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const parts = String(c.name || "").toLowerCase().split(/\s+/).filter((x) => x.length > 2);
    const raw = linkedinProfile(c.linkedinUrl);
    let li = "";
    let liVerified = false;
    if (raw && verifiedLinkedIn.includes(raw)) { li = raw; liVerified = true; }
    else {
      const byName = verifiedLinkedIn.find((u) => parts.some((p) => u.toLowerCase().includes(p)));
      if (byName) { li = byName; liVerified = true; }
    }
    if (!li) {
      li = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([c.name, name].filter(Boolean).join(" "))}`;
    }

    const email = c.emailPublic || c.generalEmail || "";
    const phone = c.phonePublic || c.generalPhone || "";
    const emailKind = c.emailPublic ? "direct" : c.generalEmail ? "general" : "none";
    const status = [
      c.evidence || "",
      emailKind === "general" ? "E-mail is a general company address, not the person's." : "",
      liVerified ? "LinkedIn verified via search." : "LinkedIn link is a people-search (profile not confirmed).",
      `Confidence: ${c.confidence || "Low"}. Researched ${new Date().toISOString().slice(0, 10)} — verify before outreach.`,
    ].filter(Boolean).join(" ");

    const row = {
      "Decision Maker Name": c.name || "",
      "Designation": c.designation || "",
      "Department": c.department || "",
      "LinkedIn Profile": li,
      "Official Email (public only)": email,
      "Official Contact Number (public only)": phone,
      "Company Website": c.website || "",
      "Office Location": c.location || "",
      "Research Status": status,
    };

    if (i === 0 && mode === "update") await upsert(ws, "Contacts", "Brand", name, row);
    else await bridge(ws, { action: "appendRows", sheet: "Contacts", rows: [{ Brand: name, ...row }], dedupeOn: ["Brand", "Decision Maker Name"] });
    saved.push({ ...row, Brand: name, _emailKind: emailKind, _linkedinVerified: liVerified, _confidence: c.confidence || "Low" });
  }

  res.status(200).json({ ok: true, found: true, contacts: saved, grounded: out.grounded, model: out.model });
});
