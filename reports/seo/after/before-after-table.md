# Before / After Table

| Area | Before | After | Files Changed | Verification | Status |
|---|---|---|---|---|---|
| Homepage positioning | Broad Elixis AI business systems homepage; payment follow-up was one service among several. | AI Payment Outreach / Elixis Collect is the primary offer; AI Receptionist / Elixis Intake is the secondary offer. | `public/index.html`, `README_WEBSITE.md` | Browser route QA, metadata scan | Complete |
| Hero visual | Abstract service overview console. | Product-like sample AR dashboard with invoice, call notes, payment next step, and guardrails. | `public/index.html`, `web/styles.css`, `public/styles.css` | Local Browser route QA, zero horizontal overflow | Complete |
| Conversion path | AI Audit CTA present but less specific. | Consultation/AI Audit CTA tied to payment outreach first, receptionist second, custom workflows when useful. | `public/index.html` | Link scan found `/booking/` CTAs | Complete |
| Trust and safety | General guardrail messaging. | Added B2B first-party focus, no verbal card collection, dispute/human review, approved-channel language. | `public/index.html`, `public/collections/index.html` | Copy scan found safe disclaimers, no unsupported positive guarantees | Complete |
| Founder/about | Missing from homepage. | Added Elijah Raykhman founder section using user-provided facts only. | `public/index.html` | Browser route QA found founder email links | Complete |
| FAQ | Missing from homepage. | Added 8 practical FAQ items and supported FAQPage schema. | `public/index.html` | Browser route QA found 8 FAQ details and schema | Complete |
| Contact emails | Footer used older Gmail addresses. | Footer uses `help@elixis.agency` and `elr234@cornell.edu`; founder card uses Cornell email. | `public/index.html`, `public/collections/index.html`, `public/ai-seo/index.html`, `README_WEBSITE.md` | Source scan found no old Gmail links in public HTML | Complete |
| SMS claims | Payment copy mentioned SMS alongside call/email/mail concepts. | SMS reframed as optional and only when enabled/approved. | `public/index.html`, `public/collections/index.html`, `README_WEBSITE.md` | Copy scan | Complete |
| Schema | Homepage/subpages had limited or no structured data. | Added Organization, WebSite, Service, and FAQPage schema where visible content supports it. | `public/index.html`, `public/collections/index.html`, `public/demo/index.html`, `public/ai-seo/index.html` | Browser route QA counted schema scripts | Complete |
| Sitemap | Valid but minimal sitemap. | Added `lastmod` values for public indexable pages. | `public/sitemap.xml` | `xmllint --noout public/sitemap.xml` passed | Complete |
| Backend safety | Backend routes existed in same repo. | No backend files intentionally changed; production `/health`, `/outbound`, and `/api/outbound/setup/status` smoke checks preserved expected statuses. | None in backend | Curl smoke checks | Complete |
| Full local tests | Requested commands existed. | Documents checkout stalls, so a clean `/tmp` copy was used. `npm run build`, `npm run lint`, and `npm test` all passed there. | N/A | Build exit 0, lint exit 0, 4 test files / 36 tests passed | Complete |
