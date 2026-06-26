# Baseline Evidence Log

## Repo Evidence

- `package.json` identifies the project as `retell-pest-control-demo` with scripts for `build`, `build:styles`, `lint`, and `test`.
- `vercel.json` uses `"buildCommand": "npm run build:styles"`.
- `src/app.ts` mounts:
  - `/retell/webhook` with raw JSON before body parser
  - `/health`
  - `/tools`
  - static `public/`
- `public/server.ts` exports the Express app for Vercel.
- No local `README_outbound.md` was present in this checkout.
- `README_WEBSITE.md` documents the frontend/backend boundary and warns not to touch `/outbound`, outbound APIs, Retell backend logic, Stripe/webhook routes, Supabase, or server-side database code for website edits.

## Live Browser Evidence

Checked with in-app Browser on `https://elixis.agency`.

| Route | Title | H1 | Horizontal overflow | Notes |
|---|---|---|---|---|
| `/` | `Elixis AI Business Systems \| Collect, Intake & Visibility` | `Put Repetitive Business Work on a Better System` | `0` | Homepage has broad service positioning. |
| `/collections/` | `Elixis Collect \| B2B Payment Follow-Up \| Elixis AI` | `Make Unpaid Invoice Follow-Up Consistent` | `0` | QuickBooks stat is attributed in visible content. |
| `/demo/` | `Elixis Intake \| AI Receptionist Demo for Service Businesses` | `See Elixis Intake Handle a Service Call` | `0` | Retell iframe source is populated. |
| `/ai-seo/` | `Elixis Visibility \| Search & AI Discovery Audit \| Elixis AI` | `Make Your Business Easier to Understand and Discover` | `0` | Contains no ranking guarantee wording. |
| `/booking/` | `Book an AI Audit \| Elixis Agency` | `Book an AI Audit` | `0` | `noindex,nofollow`; booking iframe/container present. |

## Fact Evidence

- QuickBooks / Intuit source checked via web search result: 2025 U.S. Small Business Late Payments Report says 56% of surveyed U.S. small businesses reported being owed money from unpaid invoices, averaging $17.5K per business.
- Missed-call sources in search results vary and many are marketing pages. No new missed-call statistic will be added without stronger verification.

## Inspiration Evidence

- Dark Design: observed oversized high-contrast dark hero typography, dark card grids, and restrained white-on-black composition.
- Mobbin: observed dark-framed product cards, clean navigation/search, and concise labels under UI previews.
- SAASPO: observed browser-window product frames, filters, bento-like gallery rows, and direct SaaS page pattern presentation.
