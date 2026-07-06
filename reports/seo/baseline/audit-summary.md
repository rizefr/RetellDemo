# Baseline SEO Audit Summary

## Current Strengths

- Public static routes are crawlable: `/`, `/collections/`, `/demo/`, and `/ai-seo/`.
- `robots.txt` allows crawling and points to `sitemap.xml`.
- Core public pages have titles, descriptions, canonical URLs, Open Graph, and Twitter metadata.
- `/booking/` is intentionally `noindex,nofollow`, which matches its role as a conversion calendar page.
- Services dropdown is present on desktop and mobile, with active states on service pages.
- The Retell iframe is configured from `public/site-config.js`.
- Phone split is preserved in source:
  - Contact: `tel:+18603851624`
  - Demo calls: `tel:+19842075346`

## Baseline Gaps

- Homepage positioning is still broad; payment outreach is not dominant enough for the new primary-offer brief.
- The hero visual is an abstract service overview rather than a product-like payment/call operations dashboard.
- The homepage lacks the requested founder/about section for Elijah Raykhman.
- The homepage lacks a practical FAQ that answers objections and can support FAQ schema.
- Footer email addresses still use older Gmail addresses instead of the requested `help@elixis.agency` and founder email `elr234@cornell.edu`.
- Payment copy mentions SMS alongside call/email/mail concepts without verified live SMS; this should be reframed as optional/future.
- Existing schema is minimal or absent in page source; Organization, WebSite, Service, and FAQPage schema can be added where visible content supports it.
- The sitemap is valid but minimal and lacks `lastmod` values.

## Baseline Risk Notes

- Do not add fake client logos, fake testimonials, fake certifications, guaranteed recovery, ranking, revenue, or legal/compliance claims.
- Do not present the website as consumer debt collection, medical debt collection, or financial debt collection.
- Do not claim live SMS payment links unless verified in backend/provider configuration.
- Do not alter backend route mounts while improving public marketing pages.
