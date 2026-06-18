# Outbound AI Collections Demo

## Purpose and limits

This is a Phase 1 foundation for first-party B2B unpaid invoice follow-up, initially for elevator inspection companies. It imports fake/demo customers and invoices, provides an internal status page, creates invoice-specific exact-amount Stripe Checkout Sessions, exposes gated Retell outbound-call and function endpoints, records provider events, pauses outreach, and creates follow-up tasks.

It does not execute follow-up tasks automatically. It is not a consumer debt collector, third-party collector, medical debt workflow, financial debt workflow, payment-plan system, negotiation system, email sender, or production campaign engine.

The business using it is responsible for establishing its right to contact each business customer and for legal review of calling, AI disclosure, recording, messaging, and retention requirements.

## Isolation

- Existing receptionist routes, agent IDs, Conversation Flow IDs, phone bindings, and tables remain unchanged.
- Outbound HTTP paths use `/outbound` and `/api/outbound`.
- Database tables use `public.outbound_*`.
- RLS is enabled with no `anon` or `authenticated` policies. Server routes use the Supabase service role.
- `RETELL_AGENT_ID` and `RETELL_CONVERSATION_FLOW_ID` remain receptionist-only.
- Outbound Retell resources use `OUTBOUND_RETELL_AGENT_ID` and `OUTBOUND_RETELL_CONVERSATION_FLOW_ID`.

## Current setup status (June 18, 2026)

- Vercel production is deployed and aliased at `https://elixis.agency`. `/health`, the protected `/outbound` login/admin page, and authenticated `/api/outbound/setup/status` are reachable.
- Supabase project `RetellDemo` in organization `codexworkoutw8` is configured at `https://heevsjumftsaivohqzlb.supabase.co`.
- The outbound migration has been applied. All seven `public.outbound_*` tables exist, RLS is enabled, no `anon` or `authenticated` policies/grants are present, and `outbound_mark_invoice_paid` is detected from the deployed service-role path.
- The demo CSV was imported through the deployed protected API. The marked test invoice `ELV-TEST-OWN-NUMBER` is using the allowlisted test phone `+13475850249`.
- Stripe sandbox Checkout Session creation is working from the admin/API path for the demo invoice. An active `checkout.session.completed` webhook targets `https://elixis.agency/api/outbound/webhooks/stripe`, and its signing secret is configured in Vercel.
- Retell outbound agent and Conversation Flow were hardened and published:
  - agent: `agent_4aa8074d7eabe311109ed6da89`, published version `3`
  - Conversation Flow: `conversation_flow_bebdceabc801`, version `3`
  - the flow now uses one tool-capable Subagent Node with five custom tools using `args_at_root: true`
  - the agent speaks first, repeats the complete introduction after an early hello/interruption, names Elixis Elevator Systems, and states the invoice service/date/amount after first-name confirmation
  - voicemail handling is configured to `hangup`
- The earlier Retell tool failures were HTTP 404 responses caused by a website deployment that omitted the uncommitted outbound routes. The merged Express/Vercel deployment restored those routes. A signed production `create_payment_link` tool smoke test using trusted call metadata now returns 200 and creates an exact-amount Stripe test Checkout Session.
- Retell number `+19842075346` was inspected. It is currently assigned in Retell to the outbound agent as an inbound agent with `latest_published`. No phone-number binding API was called by this setup pass.
- Test mode is enabled, `OUTBOUND_MAX_BATCH_SIZE=1`, and `OUTBOUND_TEST_PHONE_ALLOWLIST=+13475850249`.
- SMS remains disabled/manual because outbound Retell SMS is not verified for this subscription/number.
- The browser CSV upload validates all three demo rows, and a deployed batch dry run reports zero calls placed. The single-call button remains gated by recipient-local weekday 10:00-16:00 eligibility and explicit approval.
- No call, SMS, real batch, real charge, phone binding change, or receptionist code/data mutation was performed by the setup pass.

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

The page lists customer, phone, invoice, amount, invoice/payment status, last call, next follow-up, notes, pause state, and actions for:

- setup readiness across app, Supabase, Stripe, Retell, and call safety
- validation-first CSV upload/import
- customer phone editing for an allowlisted E.164 test number
- invoice status and notes update
- exact-amount Checkout Session creation
- read-only call-gate preflight and one gated test call
- selected-invoice batch dry run with no call placement
- pause/resume

Scripts may use `Authorization: Bearer $OUTBOUND_ADMIN_TOKEN`.

The setup panel calls protected `GET /api/outbound/setup/status`. It returns booleans, labels, expected webhook/function URLs, outbound table availability, and recent Stripe/Retell event labels. It never returns secret values. Missing tables produce an explicit migration warning.

Normal demo operation no longer requires the CSV import CLI: upload the file, validate it, then import it from `/outbound`. Keep the CLI for recovery and repeatable setup.

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

Confirmed mode creates and publishes a new unbound Conversation Flow and agent, or updates the matching unbound outbound resources through a new draft version. It reads the resources back, prints outbound IDs, and writes the setup report. It does not call a phone-number update API, bind a number, change receptionist bindings, place a call, or send SMS. Copy IDs manually into the secret manager; the script never overwrites `.env`.

Review `retell/outbound_collections_flow_spec.md` and `retell/outbound_collections_flow_payload.example.json`. Configure these signed wrapped-body functions:

- `POST {{APP_BASE_URL}}/api/outbound/retell/log-outcome`
- `POST {{APP_BASE_URL}}/api/outbound/retell/create-payment-link`
- `POST {{APP_BASE_URL}}/api/outbound/retell/send-payment-sms`
- `POST {{APP_BASE_URL}}/api/outbound/retell/request-human-transfer`
- `POST {{APP_BASE_URL}}/api/outbound/retell/schedule-followup`

The backend verifies `X-Retell-Signature` with the installed Retell SDK’s provider-supported verification helper. Current Retell docs sign webhooks/functions with `RETELL_API_KEY`; `OUTBOUND_RETELL_WEBHOOK_SECRET` is kept only as a compatibility fallback/status check. Keep wrapped requests so the signed `call.metadata` remains available. Caller-supplied customer IDs, invoice IDs, and amounts are not trusted.

Configure the agent webhook:

```text
POST {{APP_BASE_URL}}/api/outbound/webhooks/retell
```

Configure voicemail detection with action `hangup`. The setup payload also requests 30-day retention and `everything_except_pii`; verify those settings in the dashboard before testing.

Dynamic variables:

`business_name`, `customer_first_name`, `customer_last_name`, `amount_due`, `original_due_date`, `service_description`, `invoice_id`, `payment_link`, `attempt_number`, `business_callback_number`, `human_transfer_number`, `timezone`.

Set `HUMAN_TRANSFER_NUMBER` only after verifying ownership and live transfer behavior. If absent, the tool logs `human_requested` and the agent must end with a team-follow-up message.

Outbound SMS remains disabled/manual. The endpoint requires a prior `confirmed_payment_link_requested` outcome, returns `sent:false`, and logs `sms_pending_manual`. Do not enable live SMS until the number is SMS-capable and an outbound chat agent is verified.

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

## Vercel

1. Review all environment variables in the Vercel project.
2. Keep the existing receptionist variables unchanged.
3. Add outbound-specific values separately.
4. Deploy only after migration review and explicit approval. Deployment does not make provider calls or apply database migrations.
5. Verify `/health`, `/outbound`, raw webhook handling, and provider signatures on the deployed URL.

Vercel/Express raw-body routes are mounted before global JSON parsing for Stripe and Retell signatures.

## First safe test call

Do not call until the migration, deployed environment, Stripe webhook, Retell flow, Retell number outbound capability, AI/recording disclosure, and contact-right review are complete.

1. Confirm the Retell dashboard shows agent `agent_4aa8074d7eabe311109ed6da89` on published version `3` and flow `conversation_flow_bebdceabc801` on version `3`.
2. Confirm the current `+19842075346` assignment remains intentional. Do not change it from code; use explicit dashboard approval for any phone binding correction.
3. Open `https://elixis.agency/outbound` and confirm the setup panel is ready, test mode is enabled, the allowlist has one number, and SMS is disabled/manual.
4. Confirm invoice `ELV-TEST-OWN-NUMBER` is assigned to `+13475850249`, is not paused, and remains `unpaid` or `payment_link_sent`.
5. Select that invoice and run the batch dry run; confirm it reports `0 calls placed`.
6. During the recipient-local weekday 10:00-16:00 window, click “Check call gates” and confirm the single-call button becomes enabled.
7. Start exactly one test call only after explicit authorization.
8. Inspect the refreshed call outcome, events, notes, and follow-up status in `/outbound` and Supabase.

A small batch should remain `dry_run` until one single call, signature verification, payment webhook, pause behavior, and no-voicemail handling are all verified.

## Compliance notes

- Disclose AI status naturally after identifying the business.
- Add recording disclosure where jurisdiction requires it.
- Enforce recipient-local calling windows.
- Honor do-not-contact immediately.
- No consumer debt in this version.
- No medical, financial, regulated, or third-party debt in this version.
- The business is responsible for contact rights, consent where required, and the underlying customer relationship.
- Avoid threats, harassment, pressure, shame, repeated pushing, and sensitive identity collection.
