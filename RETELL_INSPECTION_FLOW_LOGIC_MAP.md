# Retell Inspection Flow Logic Map

This map documents the active outbound elevator-inspection collections flow so future debugging can start from the real system shape instead of rediscovering it.

## Active Resources

- Product: Elevator Inspection Collections - Paul
- Agent ID: `agent_4aa8074d7eabe311109ed6da89`
- Conversation Flow ID: `conversation_flow_bebdceabc801`
- Current published version: V70. Read back Retell before any future publish.
- Model: GPT-4.1
- Voice: `11labs-Gilfoy`
- Spoken agent name: `Paul`
- Speed: `0.82`
- First-message delay: `1550 ms`
- Ambient sound: `coffee-shop`, volume `0.7` from current provider readback
- Outbound phone: `+19842075346`
- Receptionist phone: `+18887809963`, separate inbound resource, do not edit from outbound work.

Publishing must target the explicit IDs above. The outbound setup script refuses name-based matching and duplicate creation. Production call creation pins the explicit agent to `latest_published`; `/backend` and `/outbound` do not accept an agent architecture override.

## Dynamic Variable Sources

Dynamic variables are built in `src/services/outboundCalls.ts` from trusted Supabase invoice, customer, business, account-summary, follow-up, and temporary demo-authorization records immediately before `call.createPhoneCall`.

| Variable | Source | Notes |
| --- | --- | --- |
| `business_name` | `outbound_businesses.business_name` | Default fallback exists only for empty development cases. Normal calls should have a business name. |
| `business_name_spoken` | `business_name` through `formatOutboundNameSpoken` | Avoids all-caps or awkward source spelling in the opening. |
| `account_company_name` | `outbound_customers.account_company_name` | Falls back to "the business account connected with this number". Used for wrong-person company confirmation. |
| `account_company_name_spoken` | `account_company_name` through `formatOutboundNameSpoken` | Used for wrong-person/company confirmation. |
| `agent_display_name` | `outbound_businesses.agent_display_name` | Defaults to Paul. |
| `customer_first_name`, `customer_last_name` | `outbound_customers` | Identity confirmation uses first name only. |
| `customer_first_name_spoken`, `customer_last_name_spoken` | customer names through `formatOutboundNameSpoken` | Prevents all-caps names such as `YELENA` from being shouted or pitched oddly. |
| `customer_phone_spoken` | effective destination phone | Formatted by `formatOutboundPhoneSpoken`; raw E.164 is not spoken directly. |
| `customer_phone_spoken_chunked` | effective destination phone | Used on repeat/correction, for example “area code three four seven, then five eight five, then zero two four nine.” |
| `customer_email_display` | preferred email, then customer email | Normal display value. |
| `customer_email_spoken`, `customer_email_spoken_slow` | preferred email, then customer email | Speech-safe first email confirmation. |
| `customer_email_spoken_phonetic` | preferred email, then customer email | Used on the second email repeat/confusion/correction path, for example “e as in Echo, l as in Lima...”. |
| `inspection_type` | invoice inspection type, then business default | Supports Category 1, Category 5, Acceptance Test, Periodic Inspection. |
| `inspection_date_spoken`, `inspection_date_display` | invoice inspection date, then original due date | Date is never invented. |
| `original_due_date_spoken`, `original_due_date_display` | invoice original due date | Natural date formatting. |
| `amount_due`, `amount_due_spoken` | selected invoice amount/currency | `amount_due_spoken` is the only value to read aloud. |
| `invoice_id`, `invoice_id_spoken` | selected invoice external ID | Read spoken form only when asked. |
| `open_invoice_count_spoken`, `total_amount_due_spoken` | account summary | Derived from unpaid/payment-link-sent records. |
| `last_payment_date_spoken` | paid invoices, then imported fallback | Blank if no trusted history exists. |
| `expected_payment_date_spoken` | invoice expected payment date | Used after payment-date capture. |
| `call_purpose`, `demo_call_mode` | follow-up task or invoice/demo authorization | Script mode is separate from invoice payment status. |
| `payment_provider` | business setting | Stripe is current default. QuickBooks remains scaffold-only. |
| `quickbooks_connected`, `manual_payment_followup_required` | business QuickBooks status/provider setting | Prevents claiming unsupported QuickBooks payment links. |
| `sms_effective` | server runtime business settings | False while Retell SMS remains disabled/manual; prevents creating payment links for a text path that cannot send automatically. |
| `mailing_instructions_available`, `payment_mailing_instructions` | business setting | Only stated if configured. |
| `callback_scheduled_for_spoken` | selected callback follow-up task | Used by callback-follow-up calls. |

## Custom Tools

All custom tools are wrapped Retell requests signed by Retell. Backend endpoints verify the raw-body signature, require `call.agent_id` to equal `agent_4aa8074d7eabe311109ed6da89`, and trust IDs from `call.metadata`, not caller-spoken data.

| Tool | Endpoint | Required trusted metadata | Success behavior | Failure/manual behavior |
| --- | --- | --- | --- | --- |
| `log_outcome` | `/api/outbound/retell/log-outcome` | `business_id`, `customer_id`, `invoice_id`, `call_attempt_id` | Records outcome, notes, responsible-party data, named-contact data, customer pause when applicable. | Agent must not say an outcome was noted until the tool succeeds when the path requires logging. |
| `create_payment_link` | `/api/outbound/retell/create-payment-link` | same | Creates or reuses exact-amount Stripe Checkout Session for the selected invoice. | If unavailable, agent logs `payment_link_issue`, does not call email/SMS delivery tools, falls back to manual follow-up, and does not claim a link exists. |
| `send_payment_email` | `/api/outbound/retell/send-payment-email` | same | Sends to trusted on-file/preferred email only when provider, business setting, and test allowlist gates pass; returns `sent:true`. | Returns pending/manual or failed; agent must not claim sent. |
| `send_payment_sms` | `/api/outbound/retell/send-payment-sms` | same | Future path only. | Current expected result is `sms_pending_manual`; agent must not claim a text was sent. |
| `request_human_transfer` | `/api/outbound/retell/request-human-transfer` | same | Allows transfer only when configured transfer number exists. | Logs human request and routes to manual follow-up/final-check. |
| `schedule_followup` | `/api/outbound/retell/schedule-followup` | same | Stores baseline/manual-review follow-up tasks. | Does not execute calls, texts, or emails. |
| `schedule_callback` | `/api/outbound/retell/schedule-callback` | same | Resolves relative/exact callback requests, requires confirmation, then stores callback task. | If ambiguous, past, weekend, or outside-window, returns clarification text. |

## Conversation Branches

### Opening

Default opening: `Hello, I'm calling from {{business_name_spoken}}. - Is this {{customer_first_name_spoken}}?`

After identity confirmation, Paul states his name, business, inspection type, inspection date, and overdue context. He does not volunteer virtual-assistant disclosure in the normal path.

### Wrong Person

If the caller is not the named person, Paul first asks whether this is not the right number for the named person, then asks whether the caller is with `{{account_company_name_spoken}}`. If account/company context is not available, he asks whether someone else handles elevator inspection invoices. If yes, he asks for the better payment/AP contact, collects details if offered, confirms once, logs `responsible_party_update_requested`, creates manual-review context through outcome policy, and routes to final-check. If not the company/account, he logs `wrong_number` and hard-ends.

### Invoice Received

Paul says `Good to hear. Would you like to take care of it now?` He does not repeat the inspection type, date, amount, or secure-link explanation unless the caller asks for invoice/payment details. If payment is declined, he asks one reason and classifies it without pressure. If a date is given, he notes/stores it.

### Invoice Not Received

Paul offers resend by email or text. Email can send through the backend provider after confirmation. Text remains manual and logs `sms_pending_manual`. After resend preference, Paul asks when payment is expected after review.

### Invoice Detail Questions

For "what invoice", "what inspection", "why am I getting this call", Paul answers with inspection type, inspection date, amount, and overdue status. Invoice ID is spoken only if asked.

### Payment Preference

After explicit agreement, Paul asks text or email before creating a payment link, confirms the spoken-safe contact value, then creates/reuses the exact Stripe link only for delivery paths that can use it. For email, he sends through the backend only after on-file email confirmation. For SMS-disabled text, he logs the confirmed request and calls the SMS fallback tool without creating a Stripe payment link first; the expected result is manual/pending. If the caller switches from text to email, Paul confirms the email before sending. `create_payment_link` has a native static execution message of `One moment.` so the bridge line is complete even if the model moves directly into tool execution. If payment-link creation fails, he logs `payment_link_issue`, does not call email/SMS delivery tools, and says the team will follow up.

`log_outcome` accepts optional unused string fields as `null` from Retell and normalizes them to blanks. This prevents a model-generated payload like `responsible_party_name:null` from causing a 400 when the outcome is unrelated to responsible-party updates.

### Payment Refusal

Paul asks once: "May I ask the reason, so I can note it correctly for the team?" Then he classifies the answer as dispute, already paid, unable to pay, responsible-party update, proof requested, scam concern, callback scheduled, or manual review. No repeated pressure.

### Scam Concern

Paul uses only trusted account context. He can disclose he is a virtual/AI assistant connected to business records, states no card details are collected by phone, and offers email/text details or callback.

### Already Paid / Wrong Amount / Dispute / Proof

Paul does not argue. He uses last-payment/open-invoice context only when available, logs the appropriate outcome, and routes to manual follow-up/final-check.

### Responsible Party Changed

Paul asks who handles payments now, collects name/phone/email if the caller is willing, confirms once, logs `responsible_party_update_requested`, and final-checks. He does not transfer by default.

### Named Contact

If a named person is requested, Paul logs `named_contact_requested`, says that person or someone from the team will reach out, and final-checks. He does not transfer unless the configured transfer path is explicitly available and requested.

### Callback Request

Paul asks what day/time works, then calls `schedule_callback` with `confirmed:false` before speaking a normalized time. After caller confirmation, he calls `schedule_callback` with `confirmed:true`, logs `callback_scheduled`, and final-checks. The tool stores a task only; it does not auto-call.

### Mail Check

Paul logs `mail_check_requested`. He states mailing instructions only if configured. If missing, he logs `mail_instructions_requested`, says the team will follow up with the right details, and final-checks.

### Stop Calling

Only explicit opt-out phrases trigger `do_not_contact`. Polite "bye", "goodbye", "no thanks", and "that's all" are normal endings, not do-not-contact.

### AI Question

When asked if he is AI/automated/robot, Paul answers honestly: he is an AI voice assistant connected to business account records for invoice follow-up.

### Short Call / No Answer

Voicemail is configured to hang up. Webhook analysis fallback generates a concise summary for short calls; `call_ended` must not overwrite a valid summary with null.

## Terminal Behavior

Normal terminal outcomes route to `outbound_normal_terminal_final_check` after required tools are complete. Paul asks exactly: "Is there anything else I can help you with?" If there is no further need, the native end-call action says: "Have a good day. Goodbye."

Normal final-check outcomes include service issue, mail check, missing mail instructions, email pending/manual/failed/missing, callback scheduled, responsible-party update, named-contact request, contact update, manual review after one clarification, and unavailable human transfer.

Explicit do-not-contact, attorney represented, and hostile/abusive outcomes route to `outbound_hard_terminal_end` and do not ask final-check. The native end-call action says: "Understood. We'll stop calling this number. Goodbye." Wrong-number outcomes route to `outbound_wrong_number_terminal_end`, log `wrong_number`, do not ask final-check, and close with: "Sorry about that. We'll review the contact information. Goodbye."

## Known Limitations

- SMS is disabled/manual. Text requests log `sms_pending_manual`.
- QuickBooks is scaffold-only. Paul must not claim a QuickBooks link unless the backend returns a real connected-provider link.
- Retell exposes ambient call-center sound and bridge-line behavior, not a dedicated keyboard-only tool-wait sound tied to custom-tool execution.
- No broad batch campaign is supported for demos. Presentation Mode uses temporary demo-number authorization and single-call preflight/start only.

## `/outbound` Connector Map

- Login: `/api/outbound/auth/login` exchanges `OUTBOUND_ADMIN_TOKEN` for an HttpOnly admin cookie.
- Setup status: `/api/outbound/setup/status` returns non-secret readiness for Supabase, Stripe, Retell, email, SMS, and QuickBooks.
- Dashboard: `/api/outbound/dashboard` returns bounded customer/invoice, call, payment, event, follow-up, settings, and demo authorization data with redacted payloads.
- Demo variables: `/api/outbound/demo-details` persists demo customer, account, invoice, business, call-mode, expected-payment, callback, and provider context. These feed Retell dynamic variables through `startOutboundCall`.
- Demo number authorization: `/api/outbound/demo-call/authorize-number` creates TTL/session-based test number authorization. It requires admin auth, test mode, max batch size 1, E.164 phone, warning checkbox/phrase in the browser, and the exact confirmation phrase.
- Demo preflight: `/api/outbound/demo-call/preflight` uses the real `describeOutboundCallPreflight` path and temporary demo number if provided. It does not start a call.
- Normal preflight/dry run: `/api/outbound/calls/dry-run` also uses `describeOutboundCallPreflight`.
- Start: `/api/outbound/calls/start` and `/api/outbound/demo-call/start` call the real `startOutboundCall` service. Do not invoke without explicit user approval for a real call.
- Retell call creation: `startOutboundCall` sends `override_agent_id`, signed metadata, and `retell_llm_dynamic_variables` to Retell.
- Events: admin actions, tool results, Retell webhooks, Stripe webhooks, email outcomes, demo authorization, and call-start/preflight outcomes are persisted in `outbound_events`.

## Retell API Migration Note

Repository code must not call deprecated SDK `client.agent.list()` or legacy `GET /list-agents`, and must not call `client.phoneNumber.list()` or legacy `GET /list-phone-numbers`. Use `src/retell/retellList.ts` helpers instead:

- `listRetellVoiceAgentsV2`: `POST /v2/list-agents`, `filter_criteria.channel = { type: "string", op: "eq", value: "voice" }`, reads `items`, `has_more`, and `pagination_key`.
- `listRetellPhoneNumbersV2`: `GET /v2/list-phone-numbers`, reads `items`, `has_more`, and `pagination_key`.

Do not send or depend on `pagination_key_version`.
