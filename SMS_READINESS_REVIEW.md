# Collections SMS readiness

This release prepares SMS without activating or sending it. The existing collections number is `+19842075346`. The Retell campaign status observed on September 14, 2026 was `in_review`; this stored observation is not a live approval check.

## Implemented boundaries

- `GET /api/outbound/sms/readiness?business_id=...` requires the existing collections administrator authentication. It reports stored consent/suppression counts, prepared templates, provider connection state, and activation blockers.
- `POST /api/outbound/sms/consents` requires administrator authentication and the trusted browser-origin guard. It requires an explicit SMS invoice-follow-up purpose, evidence, capture timestamp, an allowed evidence source, and an acknowledgement. The customer must belong to the supplied business both in the application query and the composite database foreign key.
- A QuickBooks phone, email permission, or voice-call permission is not accepted as SMS consent. Consent history is append-only. Recording a later opt-in does not remove a suppression.
- STOP/UNSUBSCRIBE and explicit stop-texting messages are classified as suppression requests. HELP is classified for support. START requires reconsent review and cannot silently clear a suppression. These pure policy functions do not transmit a reply.
- The prepared provider-event validator checks the raw-body signature through an injected provider verifier before parsing, enforces the verified business binding, and rejects timestamps outside the accepted window. It is exercised with fixtures, not a live provider. Unique `(business_id, provider_event_id)` storage keys prepare replay protection.
- `POST /api/outbound/sms/webhooks/provider` returns `503` for every request before any write. No provider callback is connected. No environment flag or administrator request can enable this endpoint or SMS sending in this release.
- `smsSendDecision()` always returns `allowed: false`, including when a fixture claims approval and valid consent. No provider send function is implemented.

## Storage and security review

The CLI-generated additive migration is `20260914140838_outbound_sms_readiness.sql`. Deployment must apply it before the dependent routes are treated as ready.

| Check | Review |
|---|---|
| Input and SQL injection | Pass: strict Zod schemas; Supabase query-builder values, no concatenated SQL inputs |
| Authentication | Pass: existing administrator middleware and origin guard; provider endpoint always rejects |
| Tenant boundaries | Pass in code/schema review: business-scoped queries and composite customer/business foreign keys |
| Secret exposure | Pass: no provider keys or secrets in this module, browser state, or responses |
| RLS/client grants | Pass in migration review: RLS enabled; all PUBLIC, anon, authenticated and default service-role grants revoked before minimum service-role grants |
| Consent history | Pass in migration review: service role gets select/insert, not update/delete |
| Errors and logs | Pass: routes return generic errors; audit event references consent IDs and purpose without raw evidence or phone numbers |
| Provider authenticity and replay | Prepared only: fixture validator and unique event IDs; live webhook disconnected |
| Authentication rate limiting/session lifecycle | Existing shared auth behavior; unchanged by this module |
| Live database/RLS and end-to-end delivery | Requires production migration/readback and future activation verification; not established by fixture tests |

## Activation remains a separate decision

Verify campaign approval and linked number, approved opt-in text and evidence, the provider's current signature format, STOP suppression and HELP behavior, successful delivery receipts, and explicit user activation approval. Only then implement and test the provider adapter. Do not infer approval from a saved application, an `in_review` label, a phone number, or a passing fixture.
