# SEO Setup Notes

## Site

- Brand: Elixis Agency / Elixis AI
- URL: https://elixis.agency
- Target audience: U.S. service businesses, local operators, B2B companies, and teams with unpaid invoices, customer-call gaps, or repetitive workflows.
- Primary conversion: book an AI Audit at `/booking/`.
- Primary offer for this pass: AI Payment Outreach / Elixis Collect.
- Secondary offer for this pass: AI Receptionist / Elixis Intake.

## Detected Stack

- Static HTML pages in `public/`.
- Shared vanilla JavaScript in `public/site.js`.
- Public non-secret configuration in `public/site-config.js`.
- Tailwind CSS v4 source and custom CSS in `web/styles.css`, compiled to `public/styles.css`.
- Express backend serves static `public/` files and backend routes from `src/app.ts`.
- Vercel build command in `vercel.json`: `npm run build:styles`.

## Safety Scope

Frontend-safe files for this pass: `public/`, `web/styles.css`, `README_WEBSITE.md`, and `reports/seo/`.

Backend and provider systems intentionally out of scope:

- `src/`
- `supabase/`
- `.env`
- Retell setup/refinement scripts
- Retell webhook logic
- Stripe/webhook logic if present
- Vercel provider env vars
- phone bindings and Retell agents

## Baseline Tool Notes

- In-app Browser live checks succeeded for `/`, `/collections/`, `/demo/`, `/ai-seo/`, and `/booking/`.
- Full local `git status` and branch switching were slow/hung in this Documents checkout; narrower tracked/staged checks returned clean before source edits.
- Context7 Vercel lookup did not return within 60 seconds and was stopped; deployment verification will use the Vercel connector and live HTTP checks.
- Arc inspiration sources reviewed: Dark Design, Mobbin, and SAASPO.
