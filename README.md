# Retell Pest Control Receptionist Demo

Retell AI receptionist demo for pest-control companies. The current demo business is Elijah's Pest Control.

This README focuses on the Retell agent assets, backend tool endpoints, webhook handling, Supabase storage, SMS booking-link flow with safe simulation, future calendar adapters, tests, and setup scripts. Website-specific notes live in [`README_WEBSITE.md`](./README_WEBSITE.md).

## What It Does

- Creates a Retell Conversation Flow voice agent when the API accepts the payload.
- Falls back to a single-prompt Retell LLM agent if Conversation Flow setup fails.
- Creates an optional unbound single-prompt candidate agent for optimization/testing without changing the live phone-bound agent.
- Publishes the agent and attempts weighted phone binding with `inbound_agents` total weight 1.
- Exposes Retell tool endpoints for lead capture, service-area checks, transfer logging, simulated SMS, and future calendar booking.
- Verifies Retell webhooks with the raw request body and `X-Retell-Signature`.
- Stores leads, call events, SMS events, and booking requests in Supabase through the server-side service role key.

## What It Does Not Do

- The marketing website is documented separately in `README_WEBSITE.md`.
- No real SMS unless Retell SMS is verified with a successful booking-text test.
- No real Cal.com booking unless event type credentials are configured and tested.
- No appointment confirmation unless a booking tool returns `confirmed=true`.
- No medical, legal, chemical-exposure, pricing, warranty, or service-area guessing beyond the knowledge base.

## Environment Setup

Copy `.env.example` to `.env` and fill values there. Never commit `.env`.

Retell:

- `RETELL_API_KEY`: Retell API key from the dashboard.
- `RETELL_AGENT_ID`: Optional existing agent. The setup script creates a new agent by default and prints the new ID.
- `RETELL_CONVERSATION_FLOW_ID`: Optional existing flow. The setup script creates a fresh flow by default.
- `RETELL_PHONE_NUMBER`: Retell phone number in E.164 format, for example `+17185551234`.
- `RETELL_WEBHOOK_SECRET_OR_API_KEY`: Webhook verification secret/key. If blank, the app falls back to `RETELL_API_KEY`.
- `RETELL_TRANSFER_PHONE_NUMBER`: Human transfer destination in E.164 format.
- `RETELL_AGENT_NAME`: Use `Elijah's Pest Control Demo Receptionist` for this demo.
- `RETELL_VOICE_ID`: Voice ID from Retell dashboard. `.env` wins unless Retell rejects it.
- `RETELL_KNOWLEDGE_BASE_ID`: Exact Retell KB for the single-prompt candidate. Default: `knowledge_base_5c6a5b20b1a9ed4f` (`Demo Pest KB`).
- `RETELL_SINGLE_PROMPT_CANDIDATE_AGENT_ID`: Optional record of the latest unbound candidate agent ID. Do not put this in `RETELL_AGENT_ID` until you intentionally make it live.
- `RETELL_SINGLE_PROMPT_CANDIDATE_LLM_ID`: Optional record of the latest candidate Retell LLM ID.

URLs:

- `PUBLIC_BASE_URL`: Current HTTPS ngrok or deployment URL.
- `RETELL_WEBHOOK_URL`: Must be `${PUBLIC_BASE_URL}/retell/webhook`.
- `TOOLS_BASE_URL`: Must equal `${PUBLIC_BASE_URL}`.

Supabase:

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Server-only service role key.
- `SUPABASE_ANON_KEY`: Included for completeness; not used for server writes.
- `SUPABASE_DB_URL`: Optional Postgres connection string for `npm run setup:supabase`.

Booking and demo:

- `BOOKING_URL`: First choice booking link for SMS. If missing, setup may inspect Cal.com event types, but it will not create an event type.
- `DEFAULT_BUSINESS_NAME`: `Elijah's Pest Control`.
- `DEFAULT_BUSINESS_TIMEZONE`: `America/New_York`.

SMS:

- `SMS_MODE=retell`: Demo default.
- `RETELL_SMS_NODE_ENABLED=false`: Keep false until a Retell SMS node test proves success.
- `RETELL_OUTBOUND_SMS_ENABLED=false`: Keep false until a real Retell outbound SMS test proves the booking text was sent.
- `RETELL_SMS_CHAT_AGENT_ID`: Optional only for Retell outbound SMS API.
- `SMS_BOOKING_MESSAGE_TEMPLATE`: Booking-link SMS content.

Calendar:

- `CALENDAR_PROVIDER=none`: Demo default. Captures requests without confirming appointments.
- `CALENDAR_PROVIDER=mock`: Test-only fake slots and fake booking confirmations.
- `CALENDAR_PROVIDER=calcom`: Future real booking mode only after event type values are configured.
- `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_USERNAME`, `CALCOM_EVENT_SLUG`: Cal.com v2 credentials and event identifiers.
- `BOOKING_PLACEHOLDER_EMAIL`: Demo email used silently when Cal.com requires an attendee email. Default: `demo@example.com`.

Local-only webhook escape hatch:

- `ALLOW_UNVERIFIED_WEBHOOKS=true`: Allows unsigned webhooks only when `NODE_ENV` is not `production`. Unsafe for production.

## Local Commands

```bash
npm install
npm run build:styles
npm run dev
npm run test
npm run test:tools
npm run test:webhook
npm run build
npm start
npm run refine:retell
npm run create:single-prompt-candidate
npm run test:retell-tools
npm run test:retell-sop
```

Health check:

```bash
curl http://localhost:3000/health
```

The backend may serve static files already present in this repository, but the Retell demo does not depend on a website or dashboard.

## Supabase Setup

Option 1: Supabase SQL editor.

1. Open your Supabase project.
2. Go to SQL Editor.
3. Paste `supabase/schema.sql`.
4. Run it.
5. Confirm `leads`, `call_events`, `sms_events`, and `booking_requests` exist.

Option 2: direct DB URL.

```bash
npm run setup:supabase
```

The schema enables RLS and does not create public anon policies. Server writes use `SUPABASE_SERVICE_ROLE_KEY` only.

## Retell Setup

For production-style testing, deploy the backend to a stable HTTPS host first. The current Vercel/domain-backed backend URL is:

```txt
https://elixis.agency
```

Expose your local server:

```bash
npx ngrok http 3000
```

Set:

```bash
PUBLIC_BASE_URL=https://your-ngrok-domain.ngrok-free.app
RETELL_WEBHOOK_URL=https://your-ngrok-domain.ngrok-free.app/retell/webhook
TOOLS_BASE_URL=https://your-ngrok-domain.ngrok-free.app
```

For Vercel/domain testing, replace those with:

```bash
PUBLIC_BASE_URL=https://elixis.agency
RETELL_WEBHOOK_URL=https://elixis.agency/retell/webhook
TOOLS_BASE_URL=https://elixis.agency
```

## Deploy Backend To Vercel

This repo keeps local Express development through `npm run dev` and exposes the same Express app to Vercel through `public/server.ts`.

Deploy:

```bash
npx vercel deploy --prod --yes
```

Verify:

```bash
curl -s https://elixis.agency/health
curl -s https://elixis.agency/tools/check-service-area \
  -H 'content-type: application/json' \
  -d '{"city":"Brooklyn","state":"NY","zip_code":"11201"}'
```

After deployment passes, update only the agent or candidate that should use the new domain. For the current unbound single-prompt candidate:

```bash
CANDIDATE_BASE_URL=https://elixis.agency npm run refine:single-prompt-candidate
```

Do not update or rebind the live phone-bound agent unless that is the explicit goal.

Run:

```bash
npm run setup:retell
```

The script writes generated config files, retrieves existing Retell resources for context, creates a fresh Conversation Flow and voice agent when possible, publishes the agent, and attempts phone binding with:

```json
{
  "inbound_agents": [{ "agent_id": "agent_xxx", "agent_version": 0, "weight": 1 }]
}
```

If a Retell feature cannot be fully automated, the script prints `PARTIALLY_MANUAL`, exact dashboard steps, and a verification checklist. It does not delete old agents and does not mutate `.env`.

For live-agent refinements after a successful phone connection, use:

```bash
npm run refine:retell
```

This updates only the `.env` canonical agent and Conversation Flow, backs up the agent, flow, phone binding, and generated configs to `generated/backups/`, refreshes webhook/tool URLs from `.env`, applies only approved Retell voice/call settings, republishes, and rebinds the phone number. It does not delete duplicate agents unless `RETELL_DELETE_DUPLICATES=true` is explicitly set.

## Making Retell Voice And Setting Changes Actually Apply

Retell dashboard edits may not affect live calls until the phone-bound published version is updated. Use this checklist for every voice or call-setting change:

1. Confirm `.env` points to the phone-bound canonical `RETELL_AGENT_ID`, not an older duplicate agent.
2. Confirm `RETELL_CONVERSATION_FLOW_ID` matches the canonical agent response engine.
3. Update settings through `npm run refine:retell` or the same canonical Retell API path.
4. Publish the updated agent version.
5. Rebind the Retell phone number with weighted `inbound_agents` pointing to the new published version.
6. Read back the agent and confirm `voice_id`, voice speed, dynamic voice speed, background sound, webhook URL, and tool URLs are correct.
7. Read back the phone number and confirm it points to the new canonical agent version with `weight: 1`.
8. Place a live test call. Voice quality, intonation, background sound, and pacing cannot be fully verified by static tests.

If a dashboard change does not affect calls, the usual causes are: editing an old duplicate agent, not publishing, phone binding still pointing at an older version, generated config being stale, or webhook/tool URLs still using an old ngrok URL.

## Retell Tool URLs

Custom backend tools should point to the public backend:

- `${TOOLS_BASE_URL}/tools/create-lead`
- `${TOOLS_BASE_URL}/tools/send-booking-sms`
- `${TOOLS_BASE_URL}/tools/check-service-area`
- `${TOOLS_BASE_URL}/tools/transfer-call`

Underscore aliases are kept for backward compatibility.

The current single-prompt candidate uses Retell native Cal.com tools for `check_availability_cal` and `book_appointment_cal`, so those tools do not have webhook URLs. The backend calendar URLs still exist as diagnostics/fallback routes:

- `${TOOLS_BASE_URL}/tools/candidate/check-availability-cal`
- `${TOOLS_BASE_URL}/tools/candidate/book-appointment-cal`

The full tool and webhook registry, including curl tests and edit locations, is in `docs/tool-webhook-registry.md`.

## Transfer Debugging

The backend route `/tools/transfer-call` only logs transfer intent in Supabase. A passing curl to that route does not prove Retell placed a real phone transfer.

Real phone transfer requires the live published Conversation Flow to include a Retell `transfer_call` control tool or transfer node, and the urgent/live-person paths must invoke that Retell transfer control. After any transfer setting change:

1. Back up the current agent, Conversation Flow, phone binding, and generated configs.
2. Update the canonical phone-bound agent/flow only.
3. Publish the new agent version.
4. Rebind the Retell phone number with weighted `inbound_agents` pointing to that version.
5. Read back the phone binding, flow version, transfer destination, transfer option, and webhook/tool URLs.
6. Place a live phone call. Backend tests and Retell batch tests cannot prove that the destination phone actually rings.

Current debugging preference for this demo is a simple cold transfer using SIP INVITE with the Retell agent number shown as caller ID. If transfer still does not ring, check the Retell call log for `transfer_call`, `transfer_started`, `transfer_cancelled`, `transfer_bridged`, `transfer_destination`, and any telephony error or SIP code.

## Retell Batch Testing

Run broad Conversation Flow tests with:

```bash
npm run test:retell-sop
```

The script creates temporary Retell test-case definitions, runs the batch, saves results under `generated/retell-sop-deep-*.json`, and deletes the temporary definitions. If Retell returns `402 Trial over quota`, do not treat batch testing as complete. Use fallback checks instead: static flow readback, backend tool tests, local/public health, webhook signature rejection, Supabase write/read checks, and the live-call checklist.

For the single-prompt candidate, target the candidate LLM and version explicitly:

```bash
RETELL_TEST_LLM_ID=llm_e8bb285e8cb0fc562f06e2395a78 RETELL_TEST_LLM_VERSION=<version> npm run test:retell-sop
```

Confirm the generated results file reports `temporary_test_definitions_deleted: true`.

## Single-Prompt Candidate Agent

Use this path when you want a smaller Retell LLM prompt that relies on Retell Knowledge Base content instead of stuffing FAQs into the prompt.

```bash
npm run create:single-prompt-candidate
```

This script:

- reads and backs up the current live agent, phone binding, and Conversation Flow;
- refuses to continue if the phone binding no longer points to the live canonical agent;
- creates a new `gpt-4.1` Retell LLM using a compact pest-control prompt;
- attaches only `Demo Pest KB` / `knowledge_base_5c6a5b20b1a9ed4f` when Retell can retrieve it;
- creates and publishes `Elijah's Pest Control Single Prompt Candidate`;
- does **not** call `phoneNumber.update`;
- writes `generated/single-prompt-candidate-report.json`.

The candidate is intentionally not phone-bound. Test it with Retell batch testing or a Retell test/chat path first. Reassign the phone number only after explicit approval and after Cal.com phone booking, SMS safety, transfer, webhook, and Supabase writes pass.

To refine the existing candidate without creating another voice agent:

```bash
CANDIDATE_BASE_URL=https://elixis.agency npm run refine:single-prompt-candidate
```

This updates only `agent_16b324c0e55f21c0a5f914c169`, publishes a new unbound candidate version, updates candidate tool/webhook URLs to the provided domain, disables dynamic responsiveness, keeps fixed responsiveness at `0.95`, preserves Cimo voice speed/background settings, and writes `generated/single-prompt-candidate-report.json`. It does not mutate or rebind the live phone-bound Conversation Flow agent.

### Candidate Cal.com Behavior

The live Conversation Flow keeps `CALENDAR_PROVIDER=none`. The current single-prompt candidate uses Retell native Cal.com tools as the primary booking path:

- `check_availability_cal`: Retell native Cal.com availability tool.
- `book_appointment_cal`: Retell native Cal.com booking tool.

These native tools are configured inside Retell with the Cal.com API key and event type ID. They do not call this backend and do not have webhook URLs. Retell does not currently expose a separate “during execution feedback” webhook for these native tools in this project, so the prompt handles waiting language directly:

- Before availability: `Give me a second while I check the schedule.`
- Before booking: `Okay, give me one moment while I book that.`

The backend keeps separate diagnostic/fallback routes:

- `/tools/candidate/check-availability-cal`
- `/tools/candidate/book-appointment-cal`

These routes can use Cal.com when `CALCOM_API_KEY` plus an event identifier are available. The event identifier can come from:

- `CALCOM_EVENT_TYPE_ID`, or
- `CALCOM_USERNAME` plus `CALCOM_EVENT_SLUG`, or
- a parseable Cal.com `BOOKING_URL`, such as `https://cal.com/username/event-slug`.

The diagnostic booking route supports `dry_run: true`, which validates request shape, placeholder email handling, phone normalization, address presence, and UTC slot conversion without creating a Cal.com booking. It is not the candidate’s primary booking path while Retell native Cal.com tools are working.

Do not assign the candidate to the phone number until native Retell Cal.com booking, SMS safety, custom backend tools, Retell webhook handling, and transfer expectations have all been reviewed.

### Candidate Booking Prompt

The candidate prefers over-call booking:

> I can help book it over the phone now, or I can have the team send you the booking link. Which works better?

For phone booking it collects first name, confirms `{{user_number}}`, collects an alternate phone only if needed, pest issue, property address, and preferred day/time. Before calling `book_appointment_cal`, it must echo-verify the caller name, best number, pest issue, property address if provided, chosen date/time, appointment type if known, and any important note. It asks one confirmation question and waits. It only confirms a booked appointment when `book_appointment_cal` returns `confirmed:true`.

For text-link booking, SMS remains simulated unless separately verified. If `send_booking_sms` returns `sms_simulated:true`, the agent must say the request was saved and the team can follow up with the booking link.

To run candidate batch tests:

```bash
RETELL_TEST_LLM_ID=<candidate_llm_id> npm run test:retell-sop
```

If Retell returns `402 Trial over quota`, do not treat the batch as passed. Use static prompt checks, backend tool tests, and a manual Retell test path until quota is available.

To smoke-test the deployed candidate Cal.com routes without creating a booking:

```bash
curl -s https://elixis.agency/tools/candidate/check-availability-cal \
  -H 'content-type: application/json' \
  -d '{"preferred_date":"2026-06-04","preferred_time":"morning","timezone":"America/New_York","appointment_type":"pest_control_service","pest_issue":"ants"}'

curl -s https://elixis.agency/tools/candidate/book-appointment-cal \
  -H 'content-type: application/json' \
  -d '{"caller_name":"Demo","caller_phone":"7185550100","pest_issue":"ants","selected_datetime":"2026-06-04T11:00:00-04:00","timezone":"America/New_York","property_address":"25 Pine Street, Brooklyn, NY 11201","dry_run":true}'
```

## Manual Retell Dashboard Checklist

Current demo phone-bound agent:

```txt
agent_16b324c0e55f21c0a5f914c169
```

1. Open the live agent ID in Retell.
2. Confirm it is published.
3. Confirm the response engine is the new Conversation Flow, or the fallback Retell LLM if flow creation failed.
4. Confirm `webhook_url` equals `RETELL_WEBHOOK_URL`.
5. Confirm the phone number uses weighted `inbound_agents` with the new agent/version and `weight: 1`.
6. Confirm the custom tool URLs use the hyphenated routes above.
7. Confirm transfer and end-call tools exist.
8. Keep SMS simulated unless a real SMS node/API test proves the booking text was sent.
9. Confirm Retell native Cal.com `check_availability_cal` and `book_appointment_cal` are attached for the single-prompt agent.
10. If browser/dashboard verification is needed, check whether background sound, response eagerness, interruption sensitivity, denoising, transcription mode, silence timeout, max call duration, ring duration, and DTMF/keypad settings match the API readback.

## Google Sheets Call Log Mirror

Supabase remains the primary call and lead store. Google Sheets is an optional reporting mirror for easier review.

Target sheet:

```txt
https://docs.google.com/spreadsheets/d/1EO6ncmbNuFEOX6Bkt3ETCWb8pvkG_ZflWNexwT8MXKs/edit
```

Target tab:

```txt
Call Logs
```

The backend attempts to append call summaries for Retell `call_analyzed`, `call_ended`, `chat_analyzed`, and `chat_ended` webhooks only when Sheets is enabled and credentials are configured. Missing or failing Sheets credentials do not fail the Retell webhook.

Recommended service-account setup:

1. Create a Google Cloud service account.
2. Enable the Google Sheets API for that Google Cloud project.
3. Create a JSON key for the service account.
4. Share the Google Sheet with the service account email as an editor.
5. Add these Vercel production env vars:

```bash
GOOGLE_SHEETS_ENABLED=true
GOOGLE_SHEET_ID=1EO6ncmbNuFEOX6Bkt3ETCWb8pvkG_ZflWNexwT8MXKs
GOOGLE_SHEETS_CLIENT_EMAIL=<service-account-email>
GOOGLE_SHEETS_PRIVATE_KEY=
GOOGLE_SHEETS_TAB_NAME=Call Logs
```

Keep the real private key only in Vercel environment variables or local `.env`, never in committed files.

Apps Script fallback:

```bash
GOOGLE_SHEETS_ENABLED=true
GOOGLE_SHEETS_WEBHOOK_URL=<apps-script-web-app-url>
GOOGLE_SHEETS_WEBHOOK_SECRET=<shared-secret>
GOOGLE_SHEET_ID=1EO6ncmbNuFEOX6Bkt3ETCWb8pvkG_ZflWNexwT8MXKs
GOOGLE_SHEETS_TAB_NAME=Call Logs
```

After changing Vercel env vars, redeploy:

```bash
npx vercel deploy --prod --yes
```

Columns appended:

```txt
Timestamp, Retell Call ID, Agent ID, Agent Version, Direction, Caller Number, Caller Name,
Alternate Phone, Pest Issue, Property Address, Service Area / ZIP, Urgency, Booking Method,
Appointment Requested, Appointment Date/Time, Cal.com Booking ID, Cal.com Booking Status,
SMS Sent, SMS Simulated, Transfer Requested, Transfer Status, Call Outcome, Lead Quality,
User Sentiment, Summary, Full Transcript Link or Notes, Error / Follow-up Needed
```

## ElevenLabs Voice Model Recommendation

Current candidate voice:

```txt
voice_id=11labs-Cimo
voice_model=eleven_v3
voice_speed=1.12
```

Do not change the model automatically during live demos. Recommended evaluation order for this receptionist:

1. `eleven_flash_v2_5`: best default candidate for production phone reception when latency and cost matter most.
2. `eleven_v3`: keep using it if the more expressive Cimo delivery is worth the extra latency/cost for demos.
3. `eleven_turbo_v2_5`: generally less attractive if Flash v2.5 is available; consider only if a specific voice/account behaves better on Turbo.

Operational recommendation: keep `eleven_v3` for the immediate demo because the user already confirmed it sounds good. Test `eleven_flash_v2_5` later in a duplicate unbound candidate before switching the live phone-bound agent.

## Rollback Phone Binding

To roll the phone number back to the old Conversation Flow agent:

```bash
node --input-type=module - <<'JS'
import Retell from 'retell-sdk';
import dotenv from 'dotenv';
dotenv.config();
const client = new Retell({ apiKey: process.env.RETELL_API_KEY });
await client.phoneNumber.update(process.env.RETELL_PHONE_NUMBER, {
  inbound_agents: [{ agent_id: 'agent_1e77470887528d657c5ad62d4d', agent_version: 13, weight: 1 }],
});
console.log(await client.phoneNumber.retrieve(process.env.RETELL_PHONE_NUMBER));
JS
```

If you roll back, also update `.env` and Vercel `RETELL_AGENT_ID` to the old agent, then redeploy.

## SMS Booking Behavior

The original Conversation Flow agent prefers SMS-first booking. The single-prompt candidate prefers phone booking through Cal.com and uses text-link follow-up as the secondary path. Neither agent may claim a text was sent unless `send_booking_sms` returns `sms_sent: true`.

For the demo:

- Use `BOOKING_URL` when available.
- If `BOOKING_URL` is missing, the tool returns simulated SMS and the agent says the request was saved.
- If SMS is not configured, the backend stores a simulated SMS event in Supabase and returns `sms_simulated: true`.

For real Retell SMS:

1. Verify the Retell number is SMS-capable or use an SMS-approved Retell number.
2. Configure the Conversation Flow SMS node in Retell.
3. Run a controlled booking-text test.
4. Only then set `RETELL_SMS_NODE_ENABLED=true` or `RETELL_OUTBOUND_SMS_ENABLED=true`.
5. Confirm the tool result says `sms_sent: true` before allowing the agent to say it sent a text.

Retell's SMS node requires an SMS-enabled or SMS-approved number, and SMS node success/failure transitions must be checked in the dashboard.

## Future And Candidate On-Call Booking With Cal.com

The setup script may inspect/list Cal.com event types with `CALCOM_API_KEY`, but it does not create event types. The single-prompt candidate can use candidate-scoped Cal.com routes without changing `CALENDAR_PROVIDER=none` for the current live Conversation Flow agent.

To enable real on-call booking later:

1. Create a Cal.com account.
2. Create a pest-control appointment event type.
3. Configure appointment length, availability, buffers, and phone/location details.
4. Get the Cal.com API key and event identifier.
5. Add `CALCOM_API_KEY` and either `CALCOM_EVENT_TYPE_ID` or `CALCOM_USERNAME` plus `CALCOM_EVENT_SLUG`.
6. Add a public booking page URL to `BOOKING_URL`.
7. Keep the live Conversation Flow at `CALENDAR_PROVIDER=none` unless you are intentionally changing the live agent.
8. Test candidate `check_availability_cal`.
9. Test candidate `book_appointment_cal` with `dry_run:true`.
10. Approve and run one controlled real booking test.
11. Verify the agent never confirms an appointment unless Cal.com returns success.

Future adapters can follow the same interface for Calendly, ServiceTitan, Housecall Pro, Jobber, GoHighLevel, Google Calendar, or a custom CRM.

## Knowledge Base Format

The reusable baseline KB lives in `src/retell/knowledgeBase.ts` as `genericPestControlKnowledgeBaseTemplate`. Elijah's demo KB uses the same structure.

Required headers:

- BUSINESS INFORMATION
- LOCATION
- HOURS
- SERVICES
- COMMON PEST ISSUES
- APPOINTMENT INFORMATION
- PRICING
- SERVICE DETAILS
- CUSTOMER PREPARATION
- TRANSFER RULES
- FAQ
- NOTES

Blank fields are unknown. The agent must not infer pricing, warranties, service areas, safety details, or policies from blanks. If an answer is missing, it should transfer or capture a lead.

## How To Customize For A Real Pest Control Company

1. Fill in the KB template in `src/retell/knowledgeBase.ts`.
2. Update business name, phone, service area, hours, services, pricing, policies, booking URL, and transfer number.
3. Keep blank fields blank if unknown; do not let the agent infer them.
4. Run `npm run test`.
5. Run `npm run setup:retell`.
6. Publish and bind the Retell phone number if the API did not complete it.
7. Run a live demo call and verify lead capture, SMS wording, transfer, and webhook storage.

For client onboarding questions and setup intake, use `docs/future-client-onboarding-checklist.md`.

## Demo Call Test

1. Confirm production health: `curl https://elixis.agency/health`.
2. Confirm phone binding points to `agent_16b324c0e55f21c0a5f914c169`.
3. Call `RETELL_PHONE_NUMBER`.
4. Test these phrases:
   - "I need help with ants in my kitchen."
   - "How much is it for roaches?"
   - "There's a hornet nest by my front door and my kid got stung."
   - "Can I speak to someone?"
   - "I want to book over the phone."
   - "Do you handle raccoons?"

## Known Limitations

- SMS is simulated until a real SMS path is verified.
- Transfer logging works, but live transfer ringing still needs phone-level verification.
- Google Sheets logging is implemented but disabled until service-account or Apps Script credentials are configured in Vercel.
- No multi-tenant business config is included yet.
