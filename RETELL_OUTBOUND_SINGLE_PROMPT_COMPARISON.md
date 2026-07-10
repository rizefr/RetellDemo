# Retell Outbound Single Prompt Comparison

## Purpose

This agent is a separate A/B candidate for the elevator-inspection B2B invoice demo. It lets an operator compare Retell Single Prompt behavior with the existing Conversation Flow agent while using the same backend, trusted call variables, safety gates, voice, and webhook contracts.

It is not bound to a phone number. It can be selected only from authenticated `/outbound` Presentation Mode after temporary-number authorization and backend preflight. Selecting it does not change invoice payment status.

## Current Resources

| Resource | ID | Published version | Phone binding |
| --- | --- | --- | --- |
| Single Prompt comparison agent | `agent_f5a392178f5afa39280b1489a0` | V2 | None |
| Single Prompt Retell LLM | `llm_b3f0e230981f653f0fa1195d0459` | V2 | N/A |
| Existing outbound Conversation Flow agent | `agent_4aa8074d7eabe311109ed6da89` | V67 at comparison creation | `+19842075346` |
| Existing outbound Conversation Flow | `conversation_flow_bebdceabc801` | V67 at comparison creation | Through outbound agent |
| Inbound Single Prompt style reference | `agent_16b324c0e55f21c0a5f914c169` | V32 at comparison creation | `+18887809963` |

The existing inbound and outbound resources were read-only references. No phone-number update API is used by the comparison setup script.

## Controlled Comparison

The candidate reuses the inbound agent's Single Prompt approach where appropriate:

- one comprehensive prompt rather than Conversation Flow nodes
- one question per turn and short conversational responses
- GPT-4.1 with temperature `0.2`
- strict tool calling
- agent-first opening
- no backchannel
- `11labs-Gilfoy` with ElevenLabs Flash v2.5

For a fair architecture comparison, runtime audio settings are copied from the published outbound agent, not blindly from the faster inbound receptionist:

- voice speed `0.82`
- voice temperature `1.06`
- first-message delay `1550 ms`
- `coffee-shop` ambience at `0.7`
- responsiveness `0.95`
- interruption sensitivity `0.77`
- voicemail action `hangup`

The Conversation Flow agent keeps structural nodes and edges. The candidate instead relies on one strict prompt plus native `end_call` and `transfer_call` controls. The business logic and backend gates are intended to remain equivalent.

## Webhook And Tools

Agent webhook:

`https://elixis.agency/api/outbound/webhooks/retell`

Wrapped custom tools (`args_at_root: false`):

| Tool | Endpoint |
| --- | --- |
| `log_outcome` | `/api/outbound/retell/log-outcome` |
| `create_payment_link` | `/api/outbound/retell/create-payment-link` |
| `send_payment_sms` | `/api/outbound/retell/send-payment-sms` |
| `send_payment_email` | `/api/outbound/retell/send-payment-email` |
| `request_human_transfer` | `/api/outbound/retell/request-human-transfer` |
| `schedule_followup` | `/api/outbound/retell/schedule-followup` |
| `schedule_callback` | `/api/outbound/retell/schedule-callback` |

Native controls:

- `end_polite_call`
- `end_wrong_number_call`
- `end_hard_terminal_call`
- `transfer_call`

The candidate has no pest-control knowledge base. Trusted customer, account, invoice, payment, callback, and delivery context comes from server-generated dynamic variables and signed `call.metadata`.

## Safety Behavior

- First-party B2B invoice follow-up only.
- No consumer, medical, or third-party debt positioning.
- No threats, pressure, negotiation, discounts, settlement promises, or verbal card/bank collection.
- Payment links use the existing exact-amount hosted provider path.
- Email is sent only after trusted address confirmation and `sent:true`.
- SMS remains disabled/manual. A text request records `sms_pending_manual` and does not create a payment link first.
- Wrong number, explicit opt-out, and normal polite endings use separate native end-call controls.
- Callback language is resolved by `schedule_callback` before the agent repeats a normalized time.
- Human transfer occurs only when the backend reports an available configured number.

## Setup And Update

Required server-side environment variables:

```bash
OUTBOUND_RETELL_SINGLE_PROMPT_AGENT_ID=agent_f5a392178f5afa39280b1489a0
OUTBOUND_RETELL_SINGLE_PROMPT_LLM_ID=llm_b3f0e230981f653f0fa1195d0459
```

Provider creation is dry-run by default:

```bash
npm run outbound:create-single-prompt
```

Creation requires the explicit one-time flag `CONFIRM_CREATE_RETELL_OUTBOUND_SINGLE_PROMPT_AGENT=true`. Updating an existing explicit candidate requires `CONFIRM_UPDATE_RETELL_OUTBOUND_SINGLE_PROMPT_AGENT=true`. The script verifies the current outbound and receptionist bindings before and after provider mutations, rejects duplicate-name ambiguity, accepts an explicitly configured LLM for partial-failure recovery, and never updates phone bindings.

## Safe A/B Test

1. Confirm production setup reports the Single Prompt comparison agent as configured.
2. Open authenticated `/outbound` Presentation Mode.
3. Select the same demo invoice and variables for both runs.
4. Authorize one controlled E.164 test number with the existing TTL workflow.
5. Select `Conversation Flow` or `Single Prompt comparison` under Agent architecture.
6. Run backend preflight and confirm its agent badge matches the selection.
7. Do not click Start until the user explicitly authorizes one real call.
8. Compare transcript continuity, latency, tool sequence, terminal behavior, and call summary using the same caller scenario.

Playground-only smoke command:

```bash
npm run outbound:test-single-prompt
```

The V2 smoke suite passed 8/8 scenarios with mocked tools: dynamic opening, pre-tool email confirmation, successful email sequence, SMS-disabled sequence, callback resolver, unavailable-human fallback, wrong-number ending, and explicit opt-out ending. Playground mocks do not prove live telephony audio or production endpoint execution; the existing backend paths retain their separate production verification.
