# Daily research task (paste into your scheduled Claude task)

Goal: every day, find NEW, verifiable market signals for the brands in the sheet and write them back
through the dashboard's automation endpoint. Focus services: **Visual Merchandising (VM)** and
**Sales Force Outsourcing (SFO) / Promoter Management**.

Base URL: `https://<your-vercel-domain>`  ·  Password: the dashboard password (`DASHBOARD_PASSWORD`).

## 1. Read context
- `GET /api/sheet-data?password=PW` → use `sheets["Brands Master"]` (brands to research),
  `sheets["News feed"]` (to avoid duplicates), `sheets["Workspace Settings"]` (company, services, sectors).

## 2. Research (per brand, India)
Search the last 7 days for: new/expanded stores, exclusive/experience stores, product launches,
festive/seasonal campaigns, leadership changes in sales/marketing/retail, distribution changes,
capex/growth targets, retail hiring. Only keep items you can verify with a real article URL.
Never invent headlines, dates, people or URLs; skip a brand if nothing new.

## 3. Write back (use a real browser navigation; URLs can be long)
News (duplicates are skipped automatically):
`/api/automation-write?password=PW&action=appendRows&sheet=News+feed&dedupeOn=["Brand","Headline"]&rows=[{"Brand":"","Date":"YYYY-MM-DD","Headline":"","Category":"","AI Summary":"","Source":"","URL":"","Why It Matters":""}]`

Category ∈ Retail Expansion, New Store / Experience Zone, Product Launch, Leadership Change,
Festive / Seasonal Campaign, Distribution / Channel Partnership, Manufacturing / Capex,
Funding / Financials, Marketing Campaign, Hiring / Workforce, Other.

Opportunities (only when a signal clearly creates a VM or SFO need):
`...&action=appendRows&sheet=Opportunities&dedupeOn=["Brand","Opportunity Type","Suggested Next Action"]&rows=[{"Brand":"","Opportunity Type":"","Business Impact":"","Opportunity for Channelplay":"incl. 'Why now: …'","Confidence Score (1-5)":4,"Priority Score (1-5)":4,"Recommended Service":"Visual Merchandising (VM) and/or Sales Force Outsourcing (SFO) / Promoter Management","Recommended Contact Department":"","Suggested Next Action":"","Linked News Ref":"headline"}]`

Competitor moves → sheet `Competitor Watch` (Competitor, Related Tracked Brand, Date, Category, Headline, Summary, Full Analysis, Source, URL).

## 4. Finish
Report counts added per sheet and any brand skipped. Do not message anyone.
