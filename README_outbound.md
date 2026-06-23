# Outbound AI Collections Demo

## Purpose and limits

This is a Phase 1 foundation for first-party B2B unpaid invoice follow-up, initially for elevator inspection companies. It imports fake/demo customers and invoices, provides an internal status page, creates invoice-specific exact-amount Stripe Checkout Sessions, exposes gated Retell outbound-call and function endpoints, records provider events, pauses outreach, and creates follow-up tasks.

It does not execute follow-up tasks automatically. It is not a consumer debt collector, third-party collector, medical debt workflow, financial debt workflow, payment-plan system, negotiation system, or production campaign engine. SMS and email delivery remain disabled/manual by default.

The business using it is responsible for establishing its right to contact each business customer and for legal review of calling, AI disclosure, recording, messaging, and retention requirements.

## Isolation

- Existing receptionist routes, agent IDs, Conversation Flow IDs, phone bindings, and tables remain unchanged.
- Outbound HTTP paths use `/outbound` and `/api/outbound`.
- Database tables use `public.outbound_*`.
- RLS is enabled with no `anon` or `authenticated` policies. Server routes use the Supabase service role.
- `RETELL_AGENT_ID` and `RETELL_CONVERSATION_FLOW_ID` remain receptionist-only.
- Outbound Retell resources use `OUTBOUND_RETELL_AGENT_ID` and `OUTBOUND_RETELL_CONVERSATION_FLOW_ID`.

## Current setup status (June 23, 2026)

- Vercel production is deployed and aliased at `https://elixis.agency`. `/health`, the protected `/outbound` login/admin page, and authenticated `/api/outbound/setup/status` are reachable.
- Supabase project `RetellDemo` in organization `codexworkoutw8` is configured at `https://heevsjumftsaivohqzlb.supabase.co`.
- The outbound migrations have been applied. The isolated `public.outbound_*` tables, including `outbound_demo_call_authorizations`, exist with RLS enabled and no `anon` or `authenticated` policies/grants. `outbound_mark_invoice_paid` is detected from the deployed service-role path. Call attempts store duration and structured analysis; the paid-invoice RPC uses qualified table references.
- The demo CSV was imported through the deployed protected API. The marked test invoice `ELV-TEST-OWN-NUMBER` is using the allowlisted test phone `+13475850249`.
- Stripe sandbox Checkout Session creation is working from the admin/API path. An active `checkout.session.completed` webhook targets `https://elixis.agency/api/outbound/webhooks/stripe`, and its signing secret is configured in Vercel. A sandbox completion for `ELV-2026-001` marked the invoice/session paid and persisted the Stripe event. `ELV-TEST-OWN-NUMBER` remains unpaid but is currently `manual_review`; an admin must deliberately return it to an eligible unpaid status before another call preflight can pass.
- Retell outbound agent and Conversation Flow are on the final presentation hardening track:
  - agent: `agent_4aa8074d7eabe311109ed6da89`
  - Conversation Flow: `conversation_flow_bebdceabc801`
  - target publish for this pass: V25 after the additive migration and backend deploy are verified
  - wrapped signed `{name,args,call}` tools are preserved and `args_at_root` is disabled
  - voice remains `11labs-Paul`; the presentation speed is `0.88` with a `1000 ms` first-message delay target; GPT-4.1, agent-first opening, interruption handling, and voicemail hangup are preserved unless Retell readback/simulation proves a better setting
  - Paul speaks first, repeats the applicable introduction after an early hello/interruption, uses one restrained `virtual assistant` disclosure after the service check, and states the service, natural date, and speech-safe amount after first-name confirmation
  - if asked whether he is AI or a robot, Paul answers honestly: “Yes, I’m an AI voice assistant helping Elixis Elevator Systems with service account follow-up.”
  - server-generated `amount_due_spoken`, `total_amount_due_spoken`, `invoice_id_spoken`, `open_invoice_count_spoken`, `original_due_date_spoken`, `customer_phone_spoken`, and `customer_email_spoken` prevent currency symbols, stored cents, raw dates, phone country-code prefixes, raw emails, and invoice IDs from being misread; callback tasks select a separate requested-time follow-up opening
  - voicemail handling is configured to `hangup`
- Retell V25 must be published only to the explicit existing IDs above. The setup script refuses name matching and duplicate creation. Before and after publishing, snapshot the outbound `+19842075346` binding and the receptionist `+18887809963` binding.
- Retell V25 structural terminal routing uses normal final-check and hard-terminal end nodes. Service issue, mail-check/manual instructions, email/manual fallback, callback scheduled, responsible-party update, named-contact request, and unavailable human paths route through “Is there anything else I can help you with?” and then “Have a good day. Goodbye.” Hard terminal outcomes such as stop-calling, attorney, wrong number, hostile/clear-end requests skip the final-check and end politely.
- The first real call transcript was stored. Its provider summary, confirmed payment-link outcome, 77-second duration, failed V6 `log_outcome` tool, and next action were repaired into structured analysis without claiming the link was created. Retell tools now retain signed call metadata instead of sending root-only arguments.
- Retell number `+19842075346` was inspected. It is currently assigned in Retell to the outbound agent as an inbound agent with `latest_published`. No phone-number binding API was called by this setup pass.
- Test mode is enabled, `OUTBOUND_MAX_BATCH_SIZE=1`, and `OUTBOUND_TEST_PHONE_ALLOWLIST=+13475850249`.
- SMS remains disabled/manual because outbound Retell SMS is not verified for this subscription/number. Resend delivery is verified by a controlled diagnostic email received at `elixisagency@gmail.com` from `Elixis Elevator Systems <billing@elixis.agency>`. The remaining email release check is the deployed backend path: Vercel Production must use the current Resend key, the Retell email tool must send one controlled email to `elixisagency@gmail.com`, Supabase must log `email_sent`, and `/outbound` must show the event/status.
- The after-hours self-test override is enabled in Vercel but remains unavailable unless test mode, one-item max batch, allowlisting, admin authentication, the warning checkbox, and the exact confirmation phrase all pass. Batch endpoints never accept the override.
- The browser CSV upload validates all three demo rows, and a deployed batch dry run reports zero calls placed. The single-call button remains gated by recipient-local weekday 10:00-16:00 eligibility and explicit approval.
- No call, SMS, real batch, real charge, phone binding change, or receptionist code/data mutation was performed by the setup pass.

## Presentation mode

The `/outbound` page includes a **Presentation Mode / Demo Test Number** panel for demo-day calls.

Invoice/payment status stays payment-focused:

- `unpaid`
- `payment_link_sent`
- `paid`
- `disputed`
- `manual_review`
- `cancelled`

Demo call mode is separate script context and does not change payment status:

- `first_reminder`: initial service-account check and invoice reminder
- `follow_up`: later follow-up context while the invoice can remain `unpaid`
- `callback_followup`: customer asked to be called at a specific time
- `scam_recovery`: customer previously raised legitimacy/scam concern
- `service_issue`: elevator issue is primary, payment is not pushed

`callback_scheduled` is a customer/outreach state meaning the customer asked for a specific callback time. `do_not_contact` means outreach must stop for that customer. `follow_up` is a demo/script mode or outreach context, not an invoice payment status.

The demo-number control is temporary and separate from the persistent test-phone allowlist. It requires admin auth, test mode, max batch size `1`, an E.164 number, a warning checkbox, and the exact phrase `I AUTHORIZE THIS DEMO TEST CALL`. The authorization has a TTL and can be reused during that demo session for manually started single calls. It never applies to batch calls and never bypasses normal calling hours unless the separate after-hours override is also explicitly confirmed.

The demo details editor can update the fake customer and invoice variables used by Retell: name, phone, email, business name, service description, amount, due/service date, invoice ID, demo call mode, previous call date, follow-up reason, prior concern, preferred payment method, callback details, and mailing/check instructions. These changes are sent to protected backend routes and feed real Retell dynamic variables; they are not browser-only labels.

## Supabase setup

1. Review `supabase/migrations/20260609_outbound_collections.sql`.
2. Confirm the target Supabase project is the shared receptionist project and take a database backup.
3. Apply the migration manually through the approved migration process. This repository does not apply it automatically.
4. Confirm all seven `outbound_*` tables have RLS enabled and no browser-role policies.
5. Confirm the service role can execute `outbound_mark_invoice_paid`.

Tables:

- `outbound_businesses`
- `outbound_customers`
- `outbound_invoices`
- `outbound_call_attempts`
- `outbound_payment_links`
- `outbound_events`
- `outbound_followup_tasks`

The paid-invoice RPC records the Stripe event, marks the invoice/payment session paid, and cancels pending follow-ups in one transaction. Provider event IDs, Retell call IDs, Stripe IDs, active calls, and active payment sessions have uniqueness guards.

## Environment

Copy placeholders from `.env.example` into your local secret store or Vercel environment. Never expose `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, Retell secrets, or `OUTBOUND_ADMIN_TOKEN` to browser code.

Required operational values:

```bash
APP_BASE_URL=https://your-host.example
OUTBOUND_ADMIN_TOKEN=long-random-server-secret
OUTBOUND_TEST_MODE=true
OUTBOUND_TEST_PHONE_ALLOWLIST=+1YOURNUMBER
OUTBOUND_MAX_BATCH_SIZE=3
OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE=false

RETELL_API_KEY=...
OUTBOUND_RETELL_AGENT_ID=
OUTBOUND_RETELL_CONVERSATION_FLOW_ID=
OUTBOUND_RETELL_PHONE_NUMBER_ID=
OUTBOUND_RETELL_WEBHOOK_SECRET=...
RETELL_FROM_NUMBER=+19842075346

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

EMAIL_PROVIDER=none
EMAIL_PROVIDER_API_KEY=
OUTBOUND_PAYMENT_EMAIL_FROM=
OUTBOUND_PAYMENT_EMAIL_ENABLED=false
```

For local development, set `APP_BASE_URL=http://localhost:3000`. Cookies are HttpOnly and SameSite Strict. They are Secure only in production, so local HTTP login works without weakening production cookies.

## CSV import

The template is `data/outbound_demo_customers.csv`. All phone numbers must be E.164. Amounts are parsed into integer cents.

Dry run first:

```bash
npm run outbound:import -- data/outbound_demo_customers.csv
```

After the migration is applied and the dry run is reviewed:

```bash
npm run outbound:import -- data/outbound_demo_customers.csv --commit
```

The admin page can also read a local CSV file in the browser and submit its text to the protected import route. Imports do not unpause existing customers, reopen paid invoices, or replace existing notes with blank values.

## Internal admin page

Open `/outbound`, enter `OUTBOUND_ADMIN_TOKEN`, and the backend exchanges it for an HttpOnly cookie. The token is not placed in a URL, local storage, frontend bundle, or application log.

The page provides joined customers/invoices, call history, payment sessions, and redacted event/debug tables. It shows summaries, duration, tools/errors, next actions, expandable transcripts/internal IDs, filters, last refresh time, and actions for:

- setup readiness across app, Supabase, Stripe, Retell, and call safety
- validation-first CSV upload/import
- customer phone editing for an allowlisted E.164 test number
- invoice status and notes update
- exact-amount Checkout Session creation
- read-only call-gate preflight and one gated test call
- explicit after-hours self-test confirmation when the server flag is enabled
- selected-invoice batch dry run with no call placement
- pause/resume
- business-level safety settings without exposing provider secrets
- separate customer-invoice and business-setup CSV templates
- callback task review, editing, completion, preflight, and manual one-call start
- presentation/demo mode with temporary E.164 test-number authorization
- editable demo variables that feed Retell dynamic variables
- QuickBooks future-ready payment-provider status and placeholder routes

### Business and safety settings

`/outbound` stores non-secret operational settings on `outbound_businesses`. This includes test mode, E.164 test allowlist, batch limit, the gated after-hours switch, requested email/SMS delivery, disclosure policy, Paul’s display name, callback/transfer numbers, timezone, mailing instructions, test email recipients, and callback rules.

Provider credentials remain in Vercel. A database toggle cannot make email or SMS effective unless the matching server-side capability is configured. Disabling test mode requires `ENABLE PRODUCTION OUTBOUND MODE`; raising the batch limit above one requires `INCREASE OUTBOUND BATCH LIMIT`. Both changes are audit logged. The after-hours override still requires its separate checkbox and exact per-call phrase.

The customer invoice template is available from `/api/outbound/templates/customers.csv`. The business behavior template is available from `/api/outbound/templates/business.csv`. Both downloads and imports require admin authentication. Customer imports accept `YYYY-MM-DD` or `YYYYMMDD`, preserve paid/history/note state, and report created, updated, unchanged, and warning counts.

Scripts may use `Authorization: Bearer $OUTBOUND_ADMIN_TOKEN`.

The setup panel calls protected `GET /api/outbound/setup/status`. It returns booleans, labels, expected webhook/function URLs, outbound table availability, and recent Stripe/Retell event labels. It never returns secret values. Missing tables produce an explicit migration warning.

Normal demo operation no longer requires the CSV import CLI: upload the file, validate it, then import it from `/outbound`. Keep the CLI for recovery and repeatable setup.

### Operator guide

1. Open `https://elixis.agency/outbound` and enter the server-side `OUTBOUND_ADMIN_TOKEN`. Login exchanges the token for an HttpOnly cookie; do not put the token in a URL or browser storage.
2. Review **Setup and readiness** before changing data. Green checks mean the server can reach Supabase and has the relevant provider configuration. A configured secret is not proof that a provider account, sender, or webhook is valid; verify provider status before a real test.
3. Use **Customers and invoices** to select one invoice, review the customer phone/email, service, natural due date, balance, invoice status, paused state, last call, and next task. Internal UUIDs stay collapsed unless troubleshooting.
4. Invoice states mean: `unpaid` is eligible subject to all call gates; `payment_link_sent` remains outstanding; `paid` stops follow-up; `disputed` and `manual_review` require a person; `cancelled` is inactive. Return a demo invoice to `unpaid` only after intentionally reviewing why it entered manual review.
5. Use **Call history** for the transcript, provider summary, outcome, duration, tool invocations/errors, recording link, next action, and Retell call ID. Rebuild analysis only when a completed call has a transcript but missing analysis.
6. Use **Payment sessions** to create or reuse the invoice-specific exact-amount Stripe Checkout Session. `open` can be reused until expiry, `paid` is complete, and an expired session can be replaced. Account totals never become generic payment links.
7. Use **Events and debug** to inspect redacted Retell webhooks, Stripe events, admin actions, callback scheduling, and email results. Raw provider payloads are expandable but secrets are never returned.
8. Use **Callbacks and follow-ups** to review the requested local time, timezone, reason, confirmation, and status. Edit or complete a task manually. A callback task never auto-dials.
9. Use **Settings** for the business/agent names, disclosure policy, timezone, callback/transfer numbers, mailing instructions, test mode, phone allowlist, batch limit, after-hours test switch, and requested email/SMS states. Provider secrets remain in Vercel and appear only as present/missing readiness checks.
10. Use **Presentation Mode** to authorize a temporary demo test number, choose the demo call mode, save demo variables, run the real backend preflight, and start exactly one manually approved demo call. This is separate from normal operations and does not edit invoice payment status.
11. Use **QuickBooks status** only as a future-ready setup indicator. Stripe remains the current demo default unless the business payment provider is deliberately changed.

#### One-call and callback workflow

The browser never decides call eligibility. Select one invoice or pending callback task, run **Preflight**, review the backend result, satisfy the normal window or the tightly gated after-hours self-test confirmation, then use the single-call action. The page calls the protected `/api/outbound/calls/preflight` and `/api/outbound/calls/start` routes and refreshes calls, events, customers, and callbacks after the result.

For a callback task, Paul receives `call_purpose=callback_followup` and the trusted requested time from the stored task. He opens with the requested-time follow-up script instead of the initial service-check script. The same test-mode, allowlist, calling-window, after-hours, admin, and one-item gates still apply. The system does not ask customers to call the office or rely on inbound callbacks.

#### CSV uploads

- **Customer invoice CSV** defines who to contact and the invoice/account context. Download it from **Customer template**. Required columns are `customer_id,first_name,last_name,phone_number,email,mailing_address,timezone,amount_due,original_due_date,service_description,invoice_id,business_name,status,outreach_paused,notes`.
- Optional customer columns are `last_payment_date,open_invoice_count,total_amount_due,payment_contact_preference,callback_preferred_time,payment_mailing_instructions`. Count/total values are validation hints; database-derived invoice totals remain authoritative.
- **Business setup CSV** defines how Paul behaves. Download it from **Business template**. It covers business identity, timezone, callback/transfer numbers, disclosure policy, mailing instructions, sender, and requested delivery states.
- Phones must be E.164. Dates may be `YYYY-MM-DD` or `YYYYMMDD`; the UI and Paul present them naturally. Dollar values store as cents. Validate/dry-run before import. Blank notes do not erase notes, paid invoices do not reopen, and stable business/customer/invoice IDs update rather than duplicate history.

#### Controlled email test

1. In Resend, confirm the workspace containing the production API key shows `elixis.agency` as verified and accepts `Elixis Elevator Systems <billing@elixis.agency>`.
2. Confirm Vercel reports the provider, API key, sender, and server capability as configured.
3. In business settings, enable requested email delivery and add only the controlled recipient to the test recipient allowlist.
4. Put that same address on the selected fake/test customer. The Retell email tool uses only the trusted customer and invoice from signed call metadata and the on-file address.
5. After explicit payment-link agreement, send one test through the normal email tool, confirm the `email_sent` event in **Events and debug**, then confirm delivery in the controlled inbox.

If any check fails, leave the allowlist empty. The endpoint returns `email_pending_manual`, and Paul must not claim delivery. SMS remains disabled/manual until a separate Retell SMS-capability rollout; `sms_pending_manual` is expected and the CSV/business settings already preserve the future preference.

#### QuickBooks foundation

The current demo uses Stripe for exact-amount Checkout Sessions. A business can choose `stripe`, `quickbooks`, or `manual` as its payment provider in settings, but QuickBooks is scaffold-only until a real business authorizes its QuickBooks Online company.

Configured routes:

- `GET /api/outbound/quickbooks/status`
- `GET /api/outbound/quickbooks/connect`
- `GET /api/outbound/quickbooks/callback`
- `POST /api/outbound/quickbooks/disconnect`
- `POST /api/outbound/quickbooks/invoice-link`

The connect route builds an Intuit OAuth URL when `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, and `QUICKBOOKS_REDIRECT_URI` are configured. The callback/token exchange and invoice/payment-link creation intentionally return scaffold responses until a client’s QuickBooks credentials, company authorization, token storage policy, and payment-link behavior are approved. Retell must not claim a QuickBooks link was sent unless the provider is connected and the backend returns a real link.

## Stripe setup

1. Use Stripe test-mode keys first.
2. Register `POST {{APP_BASE_URL}}/api/outbound/webhooks/stripe`.
3. Subscribe to `checkout.session.completed`.
4. Store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Generate a Checkout Session from the admin page or:

```bash
curl -X POST "$APP_BASE_URL/api/outbound/invoices/INTERNAL_UUID/create-checkout-session" \
  -H "Authorization: Bearer $OUTBOUND_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Checkout uses the database amount, exact full payment only, no discounts, no payment plans, and no verbal card collection. Session and PaymentIntent metadata include internal invoice row ID, external invoice ID, customer ID, business ID, and business name.

An unexpired unpaid session may be reused for this demo. Production policy may choose a fresh Checkout Session per payment attempt.

For local webhook testing:

```bash
stripe listen --forward-to localhost:3000/api/outbound/webhooks/stripe
stripe trigger checkout.session.completed
```

Use a real Checkout Session created by this app for full metadata/reconciliation testing.

## Retell setup

The outbound number is `+19842075346`. The implementation never binds or updates phone numbers; current assignment must be managed deliberately in Retell.

Dry-run artifact generation is the default:

```bash
npm run outbound:setup-retell
```

This writes:

- `generated/outbound-retell-setup-report.json`
- `generated/outbound-retell-conversation-flow-payload.json`
- `generated/.env.outbound.example.generated`

No provider resources are created unless this exact flag is set:

```bash
CONFIRM_CREATE_RETELL_OUTBOUND_AGENT=true npm run outbound:setup-retell
```

Confirmed mode updates and publishes only the explicit existing outbound resources through a new draft version. It reads the resources back, prints outbound IDs, and writes the setup report. It does not call a phone-number update API, bind a number, change receptionist bindings, place a call, send SMS, match by name, create duplicates, or overwrite `.env`.

For the presentation Retell flow, confirmed mode requires `OUTBOUND_RETELL_AGENT_ID=agent_4aa8074d7eabe311109ed6da89` and `OUTBOUND_RETELL_CONVERSATION_FLOW_ID=conversation_flow_bebdceabc801`, retrieves those exact resources, and refuses to match by name or create duplicates. If either ID is missing or the agent is not attached to the configured flow, the script stops.

Review `retell/outbound_collections_flow_spec.md` and `retell/outbound_collections_flow_payload.example.json`. Configure these signed wrapped-body functions:

- `POST {{APP_BASE_URL}}/api/outbound/retell/log-outcome`
- `POST {{APP_BASE_URL}}/api/outbound/retell/create-payment-link`
- `POST {{APP_BASE_URL}}/api/outbound/retell/send-payment-sms`
- `POST {{APP_BASE_URL}}/api/outbound/retell/send-payment-email`
- `POST {{APP_BASE_URL}}/api/outbound/retell/request-human-transfer`
- `POST {{APP_BASE_URL}}/api/outbound/retell/schedule-followup`
- `POST {{APP_BASE_URL}}/api/outbound/retell/schedule-callback`

The backend verifies `X-Retell-Signature` with the installed Retell SDK’s provider-supported verification helper. Current Retell docs sign webhooks/functions with `RETELL_API_KEY`; `OUTBOUND_RETELL_WEBHOOK_SECRET` is kept only as a compatibility fallback/status check. Keep wrapped requests so the signed `call.metadata` remains available. Caller-supplied customer IDs, invoice IDs, and amounts are not trusted.

Configure the agent webhook:

```text
POST {{APP_BASE_URL}}/api/outbound/webhooks/retell
```

Configure voicemail detection with action `hangup`. The setup payload also requests 30-day retention and `everything_except_pii`; verify those settings in the dashboard before testing.

Dynamic variables:

`business_name`, `agent_display_name`, `ai_disclosure_policy`, `ai_disclosure_instruction`, `customer_first_name`, `customer_last_name`, `amount_due`, `amount_due_spoken`, `original_due_date`, `original_due_date_spoken`, `original_due_date_display`, `service_description`, `invoice_id`, `invoice_id_spoken`, `payment_link`, `attempt_number`, `business_callback_number`, `human_transfer_number`, `timezone`, `open_invoice_count`, `open_invoice_count_spoken`, `total_amount_due`, `total_amount_due_spoken`, `oldest_invoice_date_spoken`, `most_recent_invoice_date_spoken`, `selected_invoice_is_most_recent`, `last_payment_date_spoken`, `call_purpose`, `demo_call_mode`, `previous_call_date_spoken`, `followup_reason`, `prior_concern_note`, `preferred_payment_method`, `customer_phone_spoken`, `customer_email`, `customer_email_display`, `customer_email_spoken`, `callback_scheduled_for_spoken`, `email_on_file`, `mailing_instructions_available`, `payment_mailing_instructions`.

The upgraded flow introduces Paul with a service-first opening, natural spoken dates, configurable `after_identity|on_request|opening` AI disclosure, elevator service-issue/manual-review handling, one helpful objection clarification, account-level invoice context, mail-check handling, and a signed `schedule-callback` tool. Callback phrases are normalized in the recipient timezone, confirmed before storage, and never auto-executed.

Presentation speech rules:

- Dates sent to Retell use `May 20, twenty twenty-six` style phrasing. Display dates can still use `May 20, 2026`.
- U.S. phone numbers sent to Retell omit “plus one” and are spoken as area code, exchange, and line number.
- Emails sent to Retell use spoken-safe text such as `elixisagency at gmail dot com`; dashboard and email bodies still use the normal display address.
- Paul uses “virtual assistant” once after identity/service check when the policy requires disclosure. If asked whether he is AI or a robot, he answers honestly.
- If asked “How are you?”, Paul replies briefly and continues the call.
- If payment is refused, Paul asks once: “May I ask the reason, so I can note it correctly for the team?” He classifies the answer and stops after one clarification.
- If the caller is no longer responsible for payments, Paul asks who handles payments now, collects name/phone/email if offered, confirms the details, logs `responsible_party_update_requested`, and creates manual follow-up. He does not transfer by default.
- If the caller asks for Mike, Sarah, or another named person, Paul logs `named_contact_requested` and creates manual follow-up instead of transferring by default.
- For scam concern, wrong amount, already paid, and last-payment questions, Paul uses only trusted account context. If the data is unavailable, he says so and offers details/team follow-up. He never invents payment history.
- Normal terminal paths use the final-check sequence. Hard terminal paths such as stop-calling, attorney, wrong number, hostile requests, or clear-end requests acknowledge, log/pause as needed, and end without the extra “anything else” question.

Set `HUMAN_TRANSFER_NUMBER` only after verifying ownership and live transfer behavior. If absent, the tool logs `human_requested` and the agent must end with a team-follow-up message.

Outbound SMS remains disabled/manual. The endpoint requires a prior `confirmed_payment_link_requested` outcome, returns `sent:false`, and logs `sms_pending_manual`. Email is provider- and business-gated, uses only the existing customer email, and logs `email_missing` or `email_pending_manual` when blocked. In test mode, the recipient must also be in the business email test allowlist. Do not enable either delivery channel casually.

## Calling gates

Every call requires:

- outstanding invoice (`unpaid` or `payment_link_sent`)
- unpaused customer
- E.164 destination
- no active call attempt
- Monday-Friday, 10:00 AM through 3:59 PM in the customer timezone
- `OUTBOUND_RETELL_AGENT_ID`
- one-time `override_agent_id`
- `RETELL_FROM_NUMBER=+19842075346`

With `OUTBOUND_TEST_MODE=true`, only `OUTBOUND_TEST_PHONE_ALLOWLIST` destinations are eligible.

Normal hours remain mandatory unless the single-call request supplies the exact after-hours acknowledgement and `OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE=true`. The override only works in test mode for one allowlisted destination with `OUTBOUND_MAX_BATCH_SIZE=1`, is audit logged before the provider call, and is never accepted by batch routes. The required phrase is `I UNDERSTAND THIS IS AN AFTER-HOURS TEST`.

Batch request modes:

- `dry_run`: checks and logs eligibility; places no calls.
- `test`: requires test mode and still enforces the allowlist.
- `real`: requires `OUTBOUND_TEST_MODE=false` and body confirmation `START_REAL_OUTBOUND_BATCH`.

All modes enforce `OUTBOUND_MAX_BATCH_SIZE`. No batch endpoint is invoked during setup or verification.

## Follow-up foundation

- Day 0: call; SMS only after agreement, currently manual.
- Day 1: no outreach.
- Day 2: second-call task and email placeholder.
- Day 7: final-reminder placeholder.
- Day 14: manual review/mailing-request note.

Weekend dates normalize to the next weekday at 10:00 AM local time. Phase 1 stores tasks but does not execute them. Paid, paused, disputed, do-not-contact, wrong-number, and attorney-represented cases stop or cancel automated follow-up.

Confirmed callback tasks store the requested UTC timestamp, customer timezone, reason, confirmation text, source call attempt/Retell call, related customer/invoice, and status. Starting a callback from `/outbound` uses the same protected preflight and single-call endpoint as every other call. It remains subject to test mode, allowlisting, invoice/customer state, weekday hours, and the separately confirmed self-test override.

## Vercel

1. Review all environment variables in the Vercel project.
2. Keep the existing receptionist variables unchanged.
3. Add outbound-specific values separately.
4. Deploy only after migration review and explicit approval. Deployment does not make provider calls or apply database migrations.
5. Verify `/health`, `/outbound`, raw webhook handling, and provider signatures on the deployed URL.

Vercel/Express raw-body routes are mounted before global JSON parsing for Stripe and Retell signatures.

## First safe test call

Do not call until the migration, deployed environment, Stripe webhook, Retell flow, Retell number outbound capability, AI/recording disclosure, and contact-right review are complete.

1. Confirm the Retell dashboard shows agent `agent_4aa8074d7eabe311109ed6da89` and flow `conversation_flow_bebdceabc801` on the latest published presentation version.
2. Confirm the current `+19842075346` assignment remains intentional. Do not change it from code; use explicit dashboard approval for any phone binding correction.
3. Open `https://elixis.agency/outbound` and confirm the setup panel is ready, test mode is enabled, the allowlist has one number, and SMS is disabled/manual.
4. Confirm invoice `ELV-TEST-OWN-NUMBER` is assigned to `+13475850249`, is not paused, and remains `unpaid` or `payment_link_sent`.
5. Select that invoice and run the batch dry run; confirm it reports `0 calls placed`.
6. During the recipient-local weekday 10:00-16:00 window, click “Check call gates” and confirm the single-call button becomes enabled.
7. Start exactly one test call only after explicit authorization.
8. Inspect the refreshed call outcome, events, notes, and follow-up status in `/outbound` and Supabase.

A small batch should remain `dry_run` until one single call, signature verification, payment webhook, pause behavior, and no-voicemail handling are all verified.

## Demo-day checklist

1. Verify `/health` and `/outbound` on `https://elixis.agency`.
2. Confirm test mode is on, max batch is `1`, SMS is disabled/manual, and email is either verified or visibly pending/manual.
3. Pick the demo invoice and set invoice payment status to `unpaid`; choose the separate demo call mode for the script you want.
4. Save demo variables: name, phone/email, service, amount, natural date, prior concern/follow-up details, and preferred payment method.
5. If using a different phone number, authorize it in **Presentation Mode** with `I AUTHORIZE THIS DEMO TEST CALL`.
6. Run preflight. If outside normal hours, use the separate after-hours self-test confirmation only for a number you control.
7. Get explicit approval for exactly one call, then start the single call from the backend-backed button.
8. After the call, refresh and show the summary, outcome, transcript, events, callback task, and payment/email state.

## Compliance notes

- Follow the configured disclosure policy and always answer honestly when asked whether the caller is AI or automated.
- Add recording disclosure where jurisdiction requires it.
- Enforce recipient-local calling windows.
- Honor do-not-contact immediately.
- No consumer debt in this version.
- No medical, financial, regulated, or third-party debt in this version.
- The business is responsible for contact rights, consent where required, and the underlying customer relationship.
- Avoid threats, harassment, pressure, shame, repeated pushing, and sensitive identity collection.
