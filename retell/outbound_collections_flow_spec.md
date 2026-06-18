# Outbound Collections Conversation Flow

This flow is a separate Retell Conversation Flow for first-party B2B unpaid invoice follow-up. The demo business is `Elixis Elevator Systems`. It must not replace or bind over the receptionist agent.

## Dynamic variables

- `business_name`
- `customer_first_name`
- `customer_last_name`
- `amount_due`
- `original_due_date`
- `service_description`
- `invoice_id`
- `payment_link`
- `attempt_number`
- `business_callback_number`
- `human_transfer_number`
- `timezone`

## Runtime design

The published flow uses one tool-capable Subagent Node. The smaller design proved more reliable than the original 30-node graph while retaining the same required branches in its global prompt and examples.

- `start_speaker` is `agent`; the agent gives the complete Elixis introduction first.
- If the person says hello or interrupts the opening, the agent repeats the complete introduction once.
- If the person gives a neutral closing such as "okay, thank you" without agreeing to a payment link, the agent logs `manual_review`, does not offer the link again, and ends cleanly.
- Every final closing sentence is followed immediately by the native `end_call` tool in the same turn; the agent never waits for another reply or restarts the introduction after logging an outcome.
- Invoice service, date, and balance are stated only after first-name confirmation.
- Every terminal objection calls `log_outcome` before the native `end_call` tool.
- The native transfer tool is used only after `request_human_transfer` confirms a configured destination.
- Custom tools use `args_at_root: true`; the backend accepts both root arguments and the documented `args` wrapper while retaining the signed `call` object.

## Function URLs

Configure the functions with wrapped Retell request bodies so the backend receives the signed `call` object and derives IDs from trusted metadata.

- `POST {{APP_BASE_URL}}/api/outbound/retell/log-outcome`
- `POST {{APP_BASE_URL}}/api/outbound/retell/create-payment-link`
- `POST {{APP_BASE_URL}}/api/outbound/retell/send-payment-sms`
- `POST {{APP_BASE_URL}}/api/outbound/retell/request-human-transfer`
- `POST {{APP_BASE_URL}}/api/outbound/retell/schedule-followup`

Payment-link agreement and callback-request branches route through the scheduling function before ending. The function stores the baseline Day 2, Day 7, and Day 14 tasks only; it does not execute outreach.

Retell signs the raw request body with the Retell API key. The backend verifies `X-Retell-Signature` with the installed SDK before parsing JSON. `OUTBOUND_RETELL_WEBHOOK_SECRET` remains a compatibility fallback only.

## Agent safety

- B2B first-party invoice demo only.
- No consumer, medical, financial, third-party, or regulated debt.
- No voicemail. Agent voicemail action is `hangup`.
- Confirm first name only; never ask for DOB, ZIP, SSN, or sensitive identifiers.
- No verbal card collection, payment plans, discounts, settlement, or negotiation.
- No threats, harassment, pressure, shame, or repeated pushing after refusal.
- Broken links, failed SMS, disputes, proof requests, inability to pay, and already-paid claims go to review.
- Default objection ending: "Okay, I'll note that and have the team review it. They'll follow up with the right details. Thanks."

## Provider setup behavior

`npm run outbound:setup-retell` writes a dry-run report and payload by default. It creates and publishes an unbound agent/flow only when `CONFIRM_CREATE_RETELL_OUTBOUND_AGENT=true`. The script contains no phone binding call.
