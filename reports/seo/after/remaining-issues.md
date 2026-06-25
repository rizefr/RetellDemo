# Remaining Issues

## Verification Limitations

- `npm run build`, `npm run lint`, and `npm test` stalled in the Documents checkout and were stopped after 30 seconds.
- A clean `/tmp` full-check copy was created with tracked backend source plus current edited frontend files. In that copy, `npm run build`, `npm run lint`, and `npm test` passed.
- Browser screenshot capture timed out once. DOM, route, overflow, menu, iframe, link, and console checks were used instead.
- Browser CUA wheel/keyboard scroll events did not move `scrollY` on `/demo/` and `/booking/`, even though computed overflow styles no longer show the previous `overflow: hidden` root cause. This should be rechecked on the deployed site after push.

## Human Review Items

- Confirm the public founder bio is acceptable for the live site.
- Confirm `help@elixis.agency` is active and routed correctly.
- Confirm the current payment-link workflow wording matches what Elixis can provide operationally.
- Confirm whether SMS is enabled before adding stronger SMS/payment-link claims.
- Review third-party Retell iframe console warnings with Retell only if they affect the widget experience.

## Deferred Recommendations

- Add more detailed service-page FAQs later if search performance data shows demand.
- Add case studies only after real client permission and verifiable outcomes exist.
- Add analytics/conversion tracking only through provider-safe, non-secret frontend configuration.
