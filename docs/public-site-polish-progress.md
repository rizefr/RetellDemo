# Public Site Polish Progress

## Checkpoint 2026-06-25

### Current State

- Worktree: `/Users/elithing3/Documents/Demo Retell AI/retell-agency-site-general`
- Branch: `main`
- Latest deployed/local commit at start of this pass: `1cc32d3` (`Upgrade Elixis marketing site positioning`)
- Stack: static HTML/CSS/JS in `public/`, Tailwind v4 source CSS in `web/styles.css`, Express/Vercel serving through `src/app.ts` and `public/server.ts`
- Public routes from sitemap/nav: `/`, `/collections/`, `/demo/`, `/ai-seo/`, `/booking/`
- Backend protected routes confirmed in source: `/outbound`, `/api/outbound/*`, `/api/outbound/webhooks/stripe`, `/api/outbound/webhooks/retell`, `/retell/webhook`, `/health`
- `AGENTS.md`: not found under the repo or parent checkout search

### Required Boundaries

- Do not edit backend/admin/provider logic, `/outbound`, `/api/outbound/*`, Retell/Stripe/Supabase routes, `.env`, `.vercel`, or `node_modules`.
- Keep Elixis Collect/payment outreach primary and Elixis Intake/receptionist secondary.
- Preserve founder/About content, Retell demo iframe, Cal booking iframe, and phone split.

### Inspiration Notes

- Dark Design: visible examples included `108(TM) - Software`, `Ponder - Software`, and `Framer - Affiliated`. Useful pattern: dark editorial hero, restrained card borders, high-contrast labels, software/product preview cards.
- Mobbin: Business-filter examples included Mercury, Ramp, Sana, Duna, General Intelligence Company, Giga, Slash, Sequence, and Runway. Useful pattern: product screenshots framed as proof, concise descriptors, finance/AI cards with clear business problem language.
- SAASPO: examples included Billow, Minerva, Granola, Cartesia, Framer, Qount, Taito, Fun, and Kira. Stack taxonomy visible: Webflow, Next.js, Gatsby.js, Framer, WordPress. Useful pattern: browser-window product frames, filters by page type/industry/style/assets/stack, bento-like SaaS sections.

### Current Gaps Found Before Editing

- Service subpages currently use `Approach` in the top nav where the goal requires canonical `Founder` nav everywhere.
- `/booking/` has a lighter standalone header rather than the same canonical header/footer/mobile nav pattern.
- Need breakpoint audit at 1440, 1024, 768, and 390 px for all public routes.
- Need semantic status color pass for manual/problem, automated/resolved, neutral/info, and review/caution states without relying on color alone.
- Need AI Audit copy to more clearly address fit, cost, start-small implementation, control, integrations, staff support, and customer reaction objections.

### Next Actions

1. Run route/breakpoint baseline QA on production/current site. Completed.
2. Normalize header/footer/mobile nav across all public routes. Completed for `/collections/`, `/demo/`, `/ai-seo/`, and `/booking/`.
3. Tighten layout symmetry, Sample AR Workflow card, semantic colors, and AI Audit copy. Completed in `web/styles.css`, `public/index.html`, and `public/booking/index.html`.
4. Rebuild CSS and run verification. Completed in clean `/tmp/elixis-site-polish` copy because the Documents checkout blocks on broad git/build operations.
5. Commit, push, verify GitHub-triggered Vercel production deployment and live routes. Pending.

### Fixes Applied In This Pass

- Replaced old `Approach` nav links on service pages with `How it works` and `Founder` anchors that match the homepage.
- Kept the Services dropdown visible on every public route and preserved current service options with `aria-current="page"` on service pages.
- Added the shared footer to `/demo/` and `/booking/`.
- Replaced the one-off `/booking/` header with the shared site header/mobile menu and moved booking page CSS into `web/styles.css`.
- Expanded `/booking/` from a calendar-only page into an AI Audit page with three audit scope cards and four practical objection cards.
- Added semantic status roles to the homepage Sample AR Workflow: confirmed, approved, ready, and review states use distinct text and restrained semantic color.
- Tightened the mobile payment dashboard spacing and preserved real page scrolling.

### Verification Evidence

- Clean copy path: `/tmp/elixis-site-polish`.
- `npm ci`: passed; npm reported existing audit advisories.
- `npm run build`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 15 files and 109 tests.
- `node --check public/site.js`: passed.
- `git diff --check`: passed.
- Local browser QA at `http://localhost:4177`: `/`, `/collections/`, `/demo/`, `/ai-seo/`, `/booking/` returned 200 at desktop and mobile widths.
- Local browser QA: no horizontal overflow, one H1 per page, shared footer present on all public routes, mobile menu opens, Services dropdown options remain visible.
- Local browser QA: `/demo/` Retell iframe is present and Call Demo Agent uses `tel:+19842075346`; `/booking/` Cal embed is present.
- Local smoke checks: `/health` returned 200, `/outbound` returned 401 protected page, `/api/outbound/setup/status` returned 401 JSON.
- `/demo/` logs third-party Retell/LC tracking console errors from the embedded iframe/script; no owned page errors were detected.
