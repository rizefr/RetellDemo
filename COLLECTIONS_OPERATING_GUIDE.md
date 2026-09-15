# Collections operating guide

The collections workspace separates demonstration data from verified accounting records. The accounting source supplies invoice identity, balances, credits, customer identity and due dates. Inspection dates remain separate. The application prepares a review queue; it does not automatically authorize customer contact.

## Connection and accounting boundaries

A connection can use the existing managed consumer integration or a supported project integration. The selected mode is explicit, and every provider read is pinned to the verified account and company. Another available credential or account never becomes a fallback. Credentials stay in approved server storage or the managed connector.

The QuickBooks accounting permission is broad. This application's behavior is restricted to approved reads; it does not describe that permission as a read-only scope. It does not create or send accounting invoices, collect charges, or modify source records. A revoked, expired, mismatched or incomplete connection blocks synchronization and exposes a redacted diagnostic.

A refresh reads open invoices and checks previously imported invoice identities separately, so an absent record cannot be mistaken for payment. Invalid or ambiguous mappings remain excluded for review. Import applies a reviewed, unexpired preview atomically and preserves local preferences, pauses, disputes, payment promises and contact history. Partial provider responses cannot become a completed preview.

Existing QuickBooks invoices use genuine provider-returned customer payment links after source and balance validation. Missing links require a clearly labeled manual follow-up. QuickBooks invoices never silently switch to Stripe; explicitly selected demonstration or Stripe invoices keep their own provider.

## Source refresh and spreadsheet refresh

The overdue view includes invoices with a positive remaining balance and strictly more than fourteen calendar days past their due date, in the configured business timezone. Currencies remain separate. The spreadsheet is a private, protected operational view of validated application records; its cells cannot change accounting balances or bypass backend contact controls.

Source and spreadsheet freshness are separate. A database import can succeed while a spreadsheet update fails. The dashboard and internal reminder must then report the spreadsheet as stale, retain the last verified refresh time and identify the failed step. They must not describe an old spreadsheet as current.

One business-level review job spans preview, application import, spreadsheet update and readback. Every step uses the exact job identity and token. Manual refreshes are blocked while another job owns the lease. Spreadsheet completion must match the applied source run, record counts and totals for each currency.

A timed-out remote write can finish late. Therefore failed or expired review jobs hold replacement work until an operator verifies the old provider work has ended and acknowledges that the spreadsheet requires a fresh verified refresh. The scheduled worker never reconciles its own hold. Reconciliation keeps the spreadsheet stale and cannot revive an expired token.

## Contact controls

New businesses are locked against outbound calls by default. Existing explicitly enabled demonstrations retain their state. Missing or unknown lock state blocks calling. Demonstration imports cannot modify a Live accounting business. Temporary test-number authorization, after-hours confirmation and batch routes do not bypass a business lock.

Before a manually approved call, the backend rechecks the current invoice balance, source freshness, contact validity, suppression, disputes, pauses, active attempts and applicable timing controls. Payment status remains separate from call purpose and contact outcome. A successful refresh alone never enables customer calls, email or SMS.

A payment email requires confirmation of the exact recipient during the current call and a valid link for the correct invoice and provider. The interface reports a successful send only after provider acceptance and records the resulting event. Branded content uses an authenticated sender; branding does not authorize another domain's identity.

If a Retell call request has an uncertain result, or the provider accepts it before the local record can be saved, the existing call reservation remains held for reconciliation. The application disables automatic SDK retries for call creation. An operator must check Retell and the stored attempt before releasing the hold; an uncertain result is never permission to place another call.

SMS remains disabled until provider approval, consent requirements, suppression handling and explicit activation are satisfied. A source phone number is not evidence of consent.

## Caller behavior and model choice

GPT-4.1 was retained because critical confirmation and tool-order behavior outweighed cheaper alternatives' apparent aggregate scores. The shorter prompt was tested on the same model and scenarios. A polite-goodbye evaluator disagreement remains documented; matching text alone is not proof of voice pacing, pitch or telephone audio quality. Stable voice tuning was preserved. A reduction in prompt characters does not establish token or billed-minute savings.

The flow confirms the correct account before invoice disclosure, offers a payment link after invoice receipt, asks once for an expected payment date after delivery or refusal, respects refusal, and closes through the native end-call path. A polite goodbye is not an opt-out. Wrong-person recovery, disputes, already-paid claims, callbacks and explicit suppression remain distinct outcomes.

## Weekly internal reminder and controlled demonstration

The configured weekly refresh prepares an internal review only. An internal email is sent only after a new per-business, per-week reservation authorizes it, using the exact approved recipient and prepared content. Accepted, uncertain, failed and expired reservations are not automatically retried. Provider acceptance and inbox receipt are distinct evidence.

For a controlled demonstration, first verify the selected workspace, connection, source and spreadsheet timestamps, exclusions and contact locks. Preview the mapped template, inspect the timeline and demonstrate saved presentation fields. Any live customer contact, campaign, SMS activation or financial write still requires its separate authorization. A successful technical deployment is not approval for unattended customer outreach.
