# Next Steps For Outbound Demo

## Current Verified Baseline

- Production domain: `https://elixis.agency`.
- Outbound Retell agent: `agent_4aa8074d7eabe311109ed6da89`.
- Outbound Conversation Flow: `conversation_flow_bebdceabc801`.
- Latest verified Retell version after the live-call/deprecation refinement: V55.
- Active product resource: `Elevator Inspection Collections — Sophia`, voice `11labs-Sloane`, spoken name `Sophia`.
- Future service copy: `agent_5dfcd21a4f06fd2a6324b3487d` with flow `conversation_flow_4a4605778462`, version V3, voice `11labs-Sloane`, spoken name `Sophia`, unbound to any phone number.
- Voice and pacing: `11labs-Sloane`, speed `0.88`, `1000 ms` first-message delay, GPT-4.1.
- GPT-5.1 was re-tested against GPT-4.1 during the wrong-person/disclosure refinement. It was available and cheaper per Retell voice-agent minute, but the tested V51 batch was slower, more verbose on scam handling, and prematurely logged outcomes before the required clarification in payment-refusal and service-issue paths. Keep GPT-4.1 unless a future Retell/model update clearly fixes those issues.
- Terminal behavior: normal terminal paths use the structural final-check/end-call sequence; hard terminal paths are limited to explicit do-not-contact, attorney, wrong number, or hostile requests and end directly. Polite goodbyes must not be classified as do-not-contact.
- Production backend email path: verified with one controlled Retell-tool-path `email_sent` event to `elixisagency@gmail.com`, and Gmail receipt was confirmed.
- Presentation Mode: temporary demo-number authorization and backend preflight have been verified without placing a call.
- SMS remains disabled/manual. QuickBooks remains scaffold-only.

## Retell Model And Voice Maintenance

Current Retell settings to preserve for the elevator demo:

- agent `agent_4aa8074d7eabe311109ed6da89`
- flow `conversation_flow_bebdceabc801`
- model GPT-4.1
- voice `11labs-Sloane`
- spoken name `Sophia`
- voice model ElevenLabs Flash v2.5
- speed `0.88`
- first-message delay `1000 ms`
- ambient sound `call-center` at moderate low volume `0.28`
- wrapped signed tools with `args_at_root` disabled

Voice maintenance rule: the setup script preserves the current dashboard voice unless `OUTBOUND_RETELL_VOICE_ID` is explicitly set for that run. Keep the inspection product on `11labs-Sloane` unless a new voice is intentionally selected and tested. Do not set a stale voice value in persistent env unless you intend every future setup publish to use it.
Retell does not expose keyboard-only audio tied exactly to custom-tool execution in the current SDK/docs. The demo uses low-volume office ambience plus short bridge lines before longer user-visible tool work so payment-link/email/callback waits do not sound like the call dropped.
Use one bridge line for a whole payment-link delivery sequence. Do not say a second “one moment” line between creating the payment link and sending email or SMS.

Retell public pricing is per minute for voice-agent LLM usage. GPT-5.1 is available in the SDK model list and is slightly cheaper than GPT-4.1 in the public standard tier, but the latest controlled Sophia comparison favored GPT-4.1 for the active demo because of tool sequencing and latency. Do not switch models by price alone; rerun the same wrong-person, invoice-detail, payment-refusal, service-issue, email, callback, and final-check simulations before publishing a model change.

## Retell API Maintenance

The repo has been migrated away from Retell deprecated legacy list APIs. Do not use SDK `client.agent.list()` or legacy `GET /list-agents`; use `listRetellVoiceAgentsV2` from `src/retell/retellList.ts`, which calls `POST /v2/list-agents`, sets `filter_criteria.channel` to `voice`, reads `items`, and paginates with `pagination_key` and `has_more`. Do not use SDK `client.phoneNumber.list()` or legacy `GET /list-phone-numbers`; use `listRetellPhoneNumbersV2`, which calls `GET /v2/list-phone-numbers` and reads paginated `items`.

Never send `pagination_key_version`. The focused test `src/tests/retellListApi.test.ts` guards source code against the deprecated strings and old SDK list methods. If Retell SDK later exposes first-class non-deprecated list helpers, replace the local helpers only after this guard still passes.

The active Sophia inspection conversation map is `RETELL_INSPECTION_FLOW_LOGIC_MAP.md`. Review it before changing Retell routes, dynamic variables, tools, or `/outbound` connector behavior.

## Live-Call Refinement Notes Through V55

- Opening is intentionally shorter: “Hello, I’m calling from {{business_name}}. Is this {{customer_first_name}}?”
- Normal calls should not volunteer virtual-assistant disclosure. Sophia answers honestly when asked whether she is AI, and may disclose when scam concern makes it helpful.
- If the caller is not the named person, Sophia asks whether this is the account/company before ending. If the company is correct, she asks for the better payment contact or AP contact and logs `responsible_party_update_requested`.
- If the caller asks what invoice or why they are getting the call, Sophia answers with inspection type, inspection date, and amount instead of restarting the opening or disclosure.
- If the caller reports a service issue or says the inspection report looks wrong, Sophia must collect one concise issue description before logging `service_issue_reported`.
- Polite “bye” remains a normal final-check ending. Explicit “stop calling,” “remove me from your call list,” and equivalent opt-out language are the do-not-contact path.
- If `create_payment_link` fails, Sophia must not call email/SMS delivery tools and must not claim the secure link was sent. She logs `payment_link_issue` and routes to manual follow-up/final-check.
- If the caller asks for a named person to call, handle the invoice, or be put on the phone, Sophia logs `named_contact_requested` before promising that person or their team will follow up.
- The V55 broad Playground suite covered 42 scenarios. Strict checks passed 39/42, and the other three were manually accepted clarifying behaviors, not blockers.

See `RETELL_AGENT_REFINEMENT_NOTES.md` before editing the future service copy. It captures the inspection-agent fixes for slow email reading, one bridge line per tool sequence, final-check/end-call routing, do-not-contact vs polite goodbye, responsible-party updates, named-contact requests, and service-agent porting notes.

## QuickBooks Future Connection

QuickBooks is scaffolded only. Do not create live QuickBooks payment links until a business authorizes its QuickBooks Online company and the token-storage policy is reviewed. Stripe remains the default provider for the elevator inspection demo.

Required env vars:

```bash
QUICKBOOKS_CLIENT_ID=
QUICKBOOKS_CLIENT_SECRET=
QUICKBOOKS_REDIRECT_URI=https://elixis.agency/api/outbound/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox
```

After receiving a client’s QuickBooks account details:

1. Create or select the Intuit app in the client-approved workspace.
2. Add the production callback URL.
3. Store client ID/secret in Vercel, not in browser settings.
4. Confirm the business wants `quickbooks_read_only` discovery/sync mode or `quickbooks_payment_link_enabled` mode.
5. Use `/api/outbound/quickbooks/connect` to start OAuth.
6. Implement token exchange/storage for the returned `code` and `realmId`.
7. Read back connection status in `/outbound`.
8. Map the client’s inspection types from QuickBooks invoice fields: Category 1, Category 5, Acceptance Test, Periodic Inspection, or their local naming.
9. Implement invoice lookup/payment-link creation for the connected realm only after explicit approval.
10. Update Retell wording so Sophia says “QuickBooks payment link” only when the backend returns a real link.

Future implementation prompt:

```text
Complete the QuickBooks Online connection for the existing outbound B2B invoice demo. Preserve Stripe as fallback, preserve all Retell safety gates, implement Intuit OAuth token exchange/storage for the approved business only, fetch or create invoice-specific QuickBooks payment links, keep no verbal card collection, and verify with QuickBooks sandbox before any production business account.
```

## Future Client Intake Checklist

For an elevator inspection company, collect:

1. Business display name and preferred outbound caller name.
2. Inspection types used in invoices: Category 1, Category 5, Acceptance Test, Periodic Inspection, and any local labels.
3. Normal first follow-up timing after inspection; the demo default is 14 days.
4. Very-overdue threshold; the demo default is 45 days.
5. Whether they send payment links through Stripe, QuickBooks, manual invoices, or another provider.
6. Sender email/domain and whether Resend or another email provider is approved.
7. SMS preference and Retell SMS subscription/number readiness, if they want text later.
8. QuickBooks company/realm access, Intuit app client ID/secret, redirect URI, sandbox vs production, desired scopes, invoice fields, and payment-link workflow.

## If Resend Or Email Fails

1. Treat a direct Resend diagnostic email to `elixisagency@gmail.com` as provider-delivery evidence only. The release check is the deployed backend/Retell email path.
2. Confirm Resend shows `elixis.agency` verified in the same workspace as the production API key.
3. Confirm Vercel has `EMAIL_PROVIDER=resend`, the current `EMAIL_PROVIDER_API_KEY`, `OUTBOUND_PAYMENT_EMAIL_FROM`, and `OUTBOUND_PAYMENT_EMAIL_ENABLED=true`.
4. If Vercel has a stale key, update the Vercel Production env var from local `.env` without printing the secret, then redeploy.
5. Confirm the business settings request email delivery and the test-recipient allowlist contains only the controlled recipient.
6. Confirm the selected customer has the controlled test email on file or as preferred email.
7. Send exactly one controlled email through the deployed backend path, then inspect Gmail, `outbound_events`, and `/outbound` for `email_sent`.
8. Test the Retell email tool path with a wrapped signed payload. If it cannot be tested without placing a real call, document the exact blocker and the strongest safe equivalent performed.
9. If provider auth fails, rotate/update only the Resend API key in Vercel and redeploy.

## If Retell Tool Calls Fail

1. Verify the published flow uses wrapped signed `{name,args,call}` custom tool requests and does not set `args_at_root`.
2. Verify Vercel receives the request and `X-Retell-Signature` validates.
3. Confirm trusted IDs are present in `call.metadata`: `business_id`, `customer_id`, `invoice_id`, and `call_attempt_id`.
4. Check `/outbound` events for redacted tool errors.
5. For terminal/end-call failures, first try structural fixes: native End Call nodes/actions, terminal routing nodes, tool-return-driven transitions, or smaller terminal subflows. Prompt wording alone is not completion.
6. Re-run Retell native simulations before another real call, especially service issue, mail check, email/manual fallback, callback scheduled, responsible-party update, named-contact request, stop-calling, and small talk.
7. Do not weaken backend validation to trust caller-supplied invoice amounts or IDs.

## Demo Number Workflow Troubleshooting

If the Presentation Mode button fails:

1. Confirm `/outbound` is authenticated with the HttpOnly admin cookie.
2. Confirm test mode is on and max batch size is `1`.
3. Confirm the entered number is E.164 and the exact phrase is `I AUTHORIZE THIS DEMO TEST CALL`.
4. Inspect the browser console and Vercel logs for `/api/outbound/demo-call/authorize-number`.
5. Confirm `outbound_demo_call_authorizations` has a non-revoked row with future `expires_at`.
6. Save demo variables, run preflight, and confirm the preflight response uses `destination_phone_number` from the temporary authorization.
7. If outside hours, separately satisfy the after-hours self-test checkbox and exact phrase. Demo-number authorization does not bypass calling-window rules.
8. Do not click start until the user explicitly approves exactly one call.

The UI should show specific failure messages for invalid E.164 phone format, missing warning checkbox, wrong phrase, expired temporary authorization, test mode off, batch size not `1`, after-hours confirmation needed, ineligible invoice, paused customer, missing Retell IDs, disabled SMS, email not ready, and QuickBooks not connected. If the page only says `failed` or `blocked`, inspect the current frontend bundle and Vercel deployment.

## Future SMS Enablement

SMS remains disabled/manual. When Retell SMS is verified for the number and subscription, run a follow-up prompt like:

```text
Enable outbound payment-link SMS for the existing B2B outbound demo. Preserve all safety gates. Verify Retell SMS capability for +19842075346, add provider readiness checks, keep SMS disabled until dashboard settings and server env both agree, send only after explicit caller preference and number confirmation, and test with one controlled allowlisted recipient.
```

Keep `OUTBOUND_RETELL_SMS_ENABLED=false` until the provider path is verified.

When SMS is enabled later, Retell must still confirm the phone number aloud using `customer_phone_spoken`, send only after explicit caller preference, and log `sms_pending_manual` instead of claiming success whenever the provider response is not `sent:true`.

## Demo Maintenance

- Keep invoice/payment status separate from demo call mode.
- Use Presentation Mode for temporary test numbers instead of mutating the persistent allowlist.
- Keep demo call mode separate from invoice/payment status.
- Use speech-safe Retell variables for phone, email, dates, invoice IDs, and amounts.
- Keep the normal final-check/end-call behavior structural in Retell, not just prose.
- Keep Stripe as the default provider until QuickBooks is fully connected.
- Keep batch campaigns disabled for demos.
