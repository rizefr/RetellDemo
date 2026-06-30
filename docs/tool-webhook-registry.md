# Tool And Webhook Registry

Production backend URL: `https://elixis.agency`

This registry separates Retell native tools from custom backend webhooks. Retell native tools do not have webhook URLs in this backend; they are configured inside Retell and verified by Retell readback plus live/batch testing.

Current phone-bound inbound agent: `agent_16b324c0e55f21c0a5f914c169`, version `26` via `latest_published`.

The inbound LLM does not attach `send_booking_sms`; SMS remains a backend route for future/other-agent use only.

## Retell Native Tools

| Tool | Type | URL | Configuration | Status | Test method |
| --- | --- | --- | --- | --- | --- |
| `check_availability_cal` | Retell native Cal.com | none | Cal.com event type `5842786`, timezone `America/New_York`, API key set in Retell | NATIVE-RETELL | Retell readback and candidate batch tests. User reported native availability works. |
| `book_appointment_cal` | Retell native Cal.com | none | Cal.com event type `5842786`, timezone `America/New_York`, API key set in Retell | NATIVE-RETELL | Retell readback and candidate batch tests. User reported native bookings appeared in Cal.com. |
| `transfer_call` | Retell native transfer | none | Cold transfer to configured E.164 destination | MANUAL | Requires live phone-level test. Backend logging does not prove the phone transfer rang. |
| `end_call` | Retell native end call | none | Retell control tool | NATIVE-RETELL | Batch/live conversation close checks. |

Native Cal.com tools do not expose a backend “during execution feedback” webhook. The candidate prompt handles this by saying `Give me a second while I check the schedule.` before availability and `Okay, give me one moment while I book that.` before booking.

## Custom Backend Tools

| Tool | Method | Production URL | Expected success shape | Safe failure wording | Status |
| --- | --- | --- | --- | --- | --- |
| `create_lead` | POST | `https://elixis.agency/tools/create-lead` | `{ success, persisted, lead_id, caller_phone, alternate_phone, message_for_agent }` | Continue politely and offer transfer/follow-up. | PASS |
| `send_booking_sms` | POST | `https://elixis.agency/tools/send-booking-sms` | Simulated mode returns `{ success:true, sms_sent:false, sms_simulated:true, message_for_agent }` | Backend-only for inbound; Paul should save a follow-up request instead of offering SMS booking. | PASS / NOT ATTACHED TO INBOUND |
| `check_service_area` | POST | `https://elixis.agency/tools/check-service-area` | `{ status:"in_area"|"maybe"|"outside_area", message_for_agent }` | Capture the lead and say the team can confirm coverage. | PASS |
| `log_transfer_request` | POST | `https://elixis.agency/tools/transfer-call` | `{ success, transfer_number_configured, message_for_agent }` | Capture callback/follow-up if Retell transfer fails. | PASS |
| diagnostic `check_availability_cal` | POST | `https://elixis.agency/tools/candidate/check-availability-cal` | `{ success, enabled, provider, available, slots, message_for_agent }` | Use native Retell Cal.com tools as primary; this route is diagnostic/fallback only. | PASS |
| diagnostic `book_appointment_cal` | POST | `https://elixis.agency/tools/candidate/book-appointment-cal` | Dry run returns `{ success:true, confirmed:false, dry_run:true, request_summary, message_for_agent }` | Do not confirm an appointment unless a real booking returns `confirmed:true`. | PASS DRY-RUN |

## Retell Webhook

| Webhook | Method | Production URL | Expected result |
| --- | --- | --- | --- |
| Retell events | POST | `https://elixis.agency/retell/webhook` | Valid signed Retell events are stored in `call_events`. Invalid signatures return `401`. |
| Google Sheets mirror | internal side effect | none | For `call_analyzed` / `call_ended`, Supabase remains primary and Google Sheets is attempted only when credentials are configured. Missing/failing Sheets credentials do not fail the Retell webhook. |

The webhook route must keep using the raw request body for `X-Retell-Signature` verification.

Google Sheet target: `1EO6ncmbNuFEOX6Bkt3ETCWb8pvkG_ZflWNexwT8MXKs`, tab `Call Logs`.

## Curl Tests

Health:

```bash
curl -s https://elixis.agency/health
```

Create lead:

```bash
curl -s -X POST https://elixis.agency/tools/create-lead \
  -H 'content-type: application/json' \
  -d '{
    "caller_name":"Codex Audit",
    "caller_phone":"+17185550100",
    "alternate_phone":"+19175550123",
    "pest_issue":"ants in kitchen",
    "urgency_level":"low",
    "preferred_booking_method":"phone_booking",
    "property_address":"25 Pine Street, Brooklyn, NY 11201",
    "property_city":"Brooklyn",
    "property_state":"NY",
    "property_zip":"11201",
    "preferred_datetime":"tomorrow morning",
    "call_summary":"Production endpoint audit lead.",
    "source":"codex_endpoint_audit"
  }'
```

Simulated SMS:

```bash
curl -s -X POST https://elixis.agency/tools/send-booking-sms \
  -H 'content-type: application/json' \
  -d '{
    "caller_name":"Codex Audit",
    "caller_phone":"+17185550100",
    "pest_issue":"ants in kitchen",
    "booking_url":"https://cal.com/retell-demo-eli1/pestapptdemo",
    "business_name":"Elijah'\''s Pest Control"
  }'
```

Service area:

```bash
curl -s -X POST https://elixis.agency/tools/check-service-area \
  -H 'content-type: application/json' \
  -d '{"city":"Brooklyn","state":"NY","zip_code":"11201"}'
```

Transfer logging:

```bash
curl -s -X POST https://elixis.agency/tools/transfer-call \
  -H 'content-type: application/json' \
  -d '{
    "reason":"live person request audit",
    "caller_name":"Codex Audit",
    "caller_phone":"+17185550100",
    "pest_issue":"ants",
    "urgency_level":"high",
    "retell_call_id":"codex_transfer_audit"
  }'
```

Candidate diagnostic availability:

```bash
curl -s -X POST https://elixis.agency/tools/candidate/check-availability-cal \
  -H 'content-type: application/json' \
  -d '{
    "preferred_date":"2026-06-05",
    "preferred_time":"morning",
    "timezone":"America/New_York",
    "appointment_type":"pest_control_service",
    "pest_issue":"ants"
  }'
```

Candidate diagnostic dry-run booking:

```bash
curl -s -X POST https://elixis.agency/tools/candidate/book-appointment-cal \
  -H 'content-type: application/json' \
  -d '{
    "caller_name":"Codex Audit",
    "caller_phone":"+17185550100",
    "email":"demo@example.com",
    "pest_issue":"ants",
    "selected_datetime":"2026-06-05T09:00:00-04:00",
    "timezone":"America/New_York",
    "notes":"Dry-run audit only. Do not create booking.",
    "property_address":"25 Pine Street, Brooklyn, NY 11201",
    "dry_run":true
  }'
```

Invalid webhook signature:

```bash
curl -i -X POST https://elixis.agency/retell/webhook \
  -H 'content-type: application/json' \
  -H 'X-Retell-Signature: invalid' \
  -d '{"event":"codex_invalid_signature"}'
```

## Where To Edit

- Backend route behavior: `src/routes/tools.ts`, `src/services/*`, `src/schemas/toolSchemas.ts`.
- Retell custom tool definitions: `src/retell/tools.ts`.
- Candidate prompt: `src/retell/singlePromptCandidatePrompt.ts`.
- Candidate Retell publish/update path: `src/scripts/refineSinglePromptCandidate.ts`.
- Vercel/domain environment variables: Vercel project settings.
- Local examples: `.env.example`; do not commit `.env`.
