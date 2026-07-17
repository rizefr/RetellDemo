# Next Steps For Outbound Demo

## Current Verified Baseline

- Production domain: `https://elixis.agency`.
- Outbound Retell agent: `agent_4aa8074d7eabe311109ed6da89`.
- Outbound Conversation Flow: `conversation_flow_bebdceabc801`.
- Current published Conversation Flow: V71.
- Separate Single Prompt comparison: agent `agent_f5a392178f5afa39280b1489a0`, LLM `llm_b3f0e230981f653f0fa1195d0459`, V2, unbound. Use `RETELL_OUTBOUND_SINGLE_PROMPT_COMPARISON.md` for the safe A/B workflow.
- Active product resource: `Elevator Inspection Collections — Paul`, voice `11labs-Gilfoy`, spoken name `Paul`.
- Future service copy: `agent_5dfcd21a4f06fd2a6324b3487d` with flow `conversation_flow_4a4605778462`, version V3, voice `11labs-Sloane`, spoken name `Sophia`, unbound to any phone number. It remains separate and was not changed by the active Paul inspection pass.
- Voice and pacing: `11labs-Gilfoy`, speed `0.82`, `1550 ms` first-message delay, GPT-4.1.
- GPT-5.1 was re-tested against GPT-4.1 during the wrong-person/disclosure refinement. It was available and cheaper per Retell voice-agent minute, but the tested V51 batch was slower, more verbose on scam handling, and prematurely logged outcomes before the required clarification in payment-refusal and service-issue paths. Keep GPT-4.1 unless a future Retell/model update clearly fixes those issues.
- Terminal behavior: normal terminal paths use the structural final-check/end-call sequence. Explicit do-not-contact, attorney, and hostile requests use the hard-terminal route. Wrong-number outcomes use a separate wrong-number terminal route with the neutral close “Sorry about that. We'll review the contact information. Goodbye.” Polite goodbyes must not be classified as do-not-contact.
- Production backend email path: verified with one controlled Retell-tool-path `email_sent` event to `elixisagency@gmail.com`, and Gmail receipt was confirmed.
- Presentation Mode: temporary demo-number authorization and backend preflight have been verified without placing a call.
- SMS remains disabled/manual. QuickBooks remains scaffold-only.

## Retell Model And Voice Maintenance

Current Retell settings to preserve for the elevator demo:

- agent `agent_4aa8074d7eabe311109ed6da89`
- flow `conversation_flow_bebdceabc801`
- model GPT-4.1
- voice `11labs-Gilfoy`
- spoken name `Paul`
- voice model ElevenLabs Flash v2.5 (`eleven_flash_v2_5`)
- speed `0.82`
- first-message delay `1550 ms`
- ambient sound `coffee-shop` at volume `0.7` from current provider readback
- wrapped signed tools with `args_at_root` disabled

Voice maintenance rule: the setup script preserves the current dashboard voice unless `OUTBOUND_RETELL_VOICE_ID` is explicitly set for that run. The current inspection voice is `11labs-Gilfoy`; use `OUTBOUND_RETELL_VOICE_ID=11labs-Sloane` only for an intentional Sloane rollback. Do not set a stale voice value in persistent env unless you intend every future setup publish to use it.
Retell does not expose keyboard-only audio tied exactly to custom-tool execution in the current SDK/docs. The demo uses low-volume office ambience plus short bridge lines before longer user-visible tool work so payment-link/email/callback waits do not sound like the call dropped.
Use the native static `create_payment_link` execution message for the payment-link bridge; it says “One moment.” Do not add a separate assistant bridge line or a second “one moment” between creating the payment link and sending email or SMS.

Retell public pricing is per minute for voice-agent LLM usage. GPT-5.1 is available in the SDK model list and is slightly cheaper than GPT-4.1 in the public standard tier, but the latest controlled Paul comparison favored GPT-4.1 for the active demo because of tool sequencing and latency. Do not switch models by price alone; rerun the same wrong-person, invoice-detail, payment-refusal, service-issue, email, callback, and final-check simulations before publishing a model change.

Retell docs and SDK types currently expose multiple ElevenLabs model IDs, including Flash, Turbo, Multilingual, and v3 variants. The active Paul inspection demo stays on `eleven_flash_v2_5` unless a native simulation comparison shows another Gilfoy-compatible model is clearly more natural at the first line without harming latency, interruption handling, or tool reliability.

## Retell API Maintenance

The repo has been migrated away from Retell deprecated legacy list APIs. Do not use SDK `client.agent.list()` or legacy `GET /list-agents`; use `listRetellVoiceAgentsV2` from `src/retell/retellList.ts`, which calls `POST /v2/list-agents`, sets `filter_criteria.channel` to `{ type: "string", op: "eq", value: "voice" }`, reads `items`, and paginates with `pagination_key` and `has_more`. Do not use SDK `client.phoneNumber.list()` or legacy `GET /list-phone-numbers`; use `listRetellPhoneNumbersV2`, which calls `GET /v2/list-phone-numbers` and reads paginated `items`.

Never send `pagination_key_version`. The focused test `src/tests/retellListApi.test.ts` guards source code against the deprecated strings and old SDK list methods. If Retell SDK later exposes first-class non-deprecated list helpers, replace the local helpers only after this guard still passes.

The active Paul inspection conversation map is `RETELL_INSPECTION_FLOW_LOGIC_MAP.md`. Review it before changing Retell routes, dynamic variables, tools, or `/outbound` connector behavior.

## Single Prompt Comparison Maintenance

- Keep `agent_f5a392178f5afa39280b1489a0` unbound. It is Playground-only and is not selectable through `/backend`, `/outbound`, or production call routes.
- Production calls are fixed to `agent_4aa8074d7eabe311109ed6da89` / `conversation_flow_bebdceabc801` at `latest_published`. Signed webhook and tool traffic from any other Retell agent ID is rejected.
- Published V71 is live. It includes outcome-specific native same-node fallbacks for wrong-number and hard-terminal endings when Retell selects an end action before completing the dedicated node transition.
- Keep the received-invoice branch explicit: ask whether the caller needs the payment link; after a bare yes, ask text or email instead of inferring a method. If not, ask by what date payment should be expected. Pass even vague date phrases to `schedule_followup` so it can request clarification; persist only the backend-resolved date without changing invoice status. Treat an explicit refusal to pay as a separate branch that asks one reason.
- Retell SDK `5.31.1` is the current compatibility pin. Before upgrading to `5.32+`, verify Retell's supported replacement for the removed `sign`/`verify` helpers and rerun the raw-body webhook signature suite.
- Keep its LLM `llm_b3f0e230981f653f0fa1195d0459` explicit in server environment settings. Never discover-and-update it by name.
- Use the same demo variables and caller scenario when comparing it with the V71 Conversation Flow agent.
- Run `npm run outbound:test-single-prompt` before any live A/B call. Its tool results are mocked and do not prove production delivery.
- Do not add the pest-control knowledge base. Trusted outbound invoice/customer data comes from call variables and signed metadata.
- Read `RETELL_OUTBOUND_SINGLE_PROMPT_COMPARISON.md` for exact tools, current V2 settings, update guards, and the no-call preflight workflow.

## Live-Call Refinement Notes Through V55

- Opening is intentionally shorter with a Retell short-pause marker: “Hello, I’m calling from {{business_name}}. - Is this {{customer_first_name}}?”
- Normal calls should not volunteer virtual-assistant disclosure. Paul answers honestly when asked whether he is AI, and may disclose when scam concern makes it helpful.
- If the caller is not the named person, Paul first asks whether this is not the right number for the named person, then asks whether the caller is with the account/company before ending. If the company is correct, he asks for the better payment contact or AP contact and logs `responsible_party_update_requested`.
- If the caller asks what invoice or why they are getting the call, Paul answers with inspection type, inspection date, and amount instead of restarting the opening or disclosure.
- If the caller reports a service issue or says the inspection report looks wrong, Paul must collect one concise issue description before logging `service_issue_reported`.
- Polite “bye” remains a normal final-check ending. Explicit “stop calling,” “remove me from your call list,” and equivalent opt-out language are the do-not-contact path.
- If `create_payment_link` fails, Paul must not call email/SMS delivery tools and must not claim the secure link was sent. He logs `payment_link_issue` and routes to manual follow-up/final-check.
- If the caller asks for a named person to call, handle the invoice, or be put on the phone, Paul logs `named_contact_requested` before promising that person or their team will follow up.
- The V55 broad Playground suite covered 42 scenarios. Strict checks passed 39/42, and the other three were manually accepted clarifying behaviors, not blockers.

## V63 Gilfoy/Paul Opening Polish (Historical)

- V63 used `11labs-Gilfoy` at speed `0.82` with a `1550 ms` first-message delay and `call-center` ambient volume `1.0`. Current V71 readback keeps the speed/delay but uses `coffee-shop` ambience at `0.7`.
- The speed choice is based on the live V56 call where the caller asked Paul to slow down: the opening measured materially faster than the first full response after the request. V63 introduced speed `0.82`, a longer first-message delay, a short Retell pause marker between the business name and name-confirmation question, and separate wrong-number versus explicit-opt-out handling.
- First email confirmation uses `customer_email_spoken_slow`, now formatted with spaced tokens such as “e l i x i s agency, at gmail, dot com.”
- If the caller asks to repeat the email, says it is wrong, or sounds confused, the second readback uses `customer_email_spoken_phonetic` immediately, for example “e as in Echo, l as in Lima...”.
- First phone confirmation uses `customer_phone_spoken`; repeat/correction uses `customer_phone_spoken_chunked`.
- If the caller asks to repeat or correct the phone number, Paul uses `customer_phone_spoken_chunked`, for example “area code three four seven, then five eight five, then zero two four nine.”
- If the caller gives a corrected email or phone number, Paul confirms it once, logs `contact_update_requested`, and only claims delivery if the backend tool explicitly returns `sent:true`.
- Names spoken by Retell now use `business_name_spoken`, `account_company_name_spoken`, `customer_first_name_spoken`, and `customer_last_name_spoken` to avoid all-caps delivery such as `YELENA`.
- Spoken dates use ordinal phrasing, for example `May twentieth, twenty twenty-six`.
- Retell `log_outcome` optional string arguments tolerate `null` values from the model, preventing 400 responses on unused responsible-party or named-contact fields.
- `create_payment_link` has `speak_during_execution=true` with a static “One moment.” message, so the bridge is complete and not dependent on the model beginning a sentence before tool execution.
- While SMS is disabled, Paul does not create a Stripe payment link before the manual SMS fallback. If the caller switches from text to email, he confirms the email before the email tool path.
- Personal or irrelevant questions are answered briefly and honestly, then Paul steers back to invoice receipt/payment status. For example, he says he is a digital assistant and does not have an age or physical office location.
- If the caller asks “are we done?” before the invoice/follow-up outcome is addressed, Paul makes one reasonable attempt to finish the invoice receipt question before closing. If an outcome has already been reached, he can close directly.

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
10. Update Retell wording so Paul says “QuickBooks payment link” only when the backend returns a real link.

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
