# Invoice Received Payment-Date Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a caller confirms receipt of an inspection invoice, ask whether they need the secure payment link; if they decline the link, obtain and persist an expected payment date before continuing the existing closing flow.

**Architecture:** Keep the active Retell Conversation Flow and seven wrapped tools. Extend the existing signed `schedule_followup` tool with an optional date phrase, resolve that phrase server-side using the trusted call timestamp and customer timezone, persist the existing `outbound_invoices.expected_payment_date` column, and schedule follow-ups from that date. Update the prompt, finetune example, and repository logic map so the branch is deterministic and visible outside Retell.

**Tech Stack:** TypeScript, Express 5, Retell Conversation Flow, Luxon, Supabase, Vitest, Vercel.

## Global Constraints

- Publish only agent `agent_4aa8074d7eabe311109ed6da89` and flow `conversation_flow_bebdceabc801`.
- Do not place a call, change phone bindings, or modify inbound receptionist `+18887809963`.
- Invoice payment status remains payment-focused; declining a payment link must not set `manual_review` by itself.
- SMS remains disabled/manual, Stripe stays active, and QuickBooks remains scaffold-only.

---

### Task 1: Add failing conversation and date-resolution tests

**Files:**
- Modify: `src/tests/outboundSecurity.test.ts`
- Modify: `src/tests/outboundRoutes.test.ts`
- Create: `src/tests/outboundExpectedPaymentDate.test.ts`

**Interfaces:**
- Consumes: existing `buildOutboundConversationFlow`, signed Retell tool envelope, and `expected_payment_date` invoice column.
- Produces: regression expectations for `resolveOutboundExpectedPaymentDate()` and the invoice-received branch.

- [ ] **Step 1: Add a prompt guard test** requiring `Do you need the secure payment link?`, `By what date should we expect payment?`, the explicit rule that a declined link is not payment refusal, and a `payment_link_declined_expected_date_example` finetune transcript.
- [ ] **Step 2: Add resolver tests** for an ISO date, `tomorrow`, a weekday, an ambiguous date, and a past date using a fixed `America/New_York` reference time.
- [ ] **Step 3: Add a signed route test** requiring `schedule-followup` to persist the resolved date, insert an `expected_payment_date_recorded` event, leave invoice status unchanged, and schedule tasks from the expected date.
- [ ] **Step 4: Run the targeted tests** and confirm they fail because the branch rule, resolver, and persistence behavior are not implemented.

### Task 2: Implement expected-payment-date persistence

**Files:**
- Create: `src/services/outboundExpectedPaymentDate.ts`
- Modify: `src/schemas/outboundSchemas.ts`
- Modify: `src/routes/outboundRetellTools.ts`
- Modify: `src/retell/outboundConversationFlow.ts`

**Interfaces:**
- Consumes: `resolveOutboundExpectedPaymentDate({ datePhrase, timezone, referenceTime })`.
- Produces: `{ ok, expectedPaymentDate, expectedPaymentDateSpoken, timezone }` or a clarification result; `schedule_followup` accepts optional `expected_payment_date_phrase`.

- [ ] **Step 1: Implement the date resolver** for exact dates, today/tomorrow, and weekdays; reject ambiguous or past dates.
- [ ] **Step 2: Extend the signed tool schema** with optional `expected_payment_date_phrase` while preserving existing callers.
- [ ] **Step 3: Persist the resolved date** with `updateOutboundInvoice`, insert the redacted operational event, and base follow-up scheduling on the expected date.
- [ ] **Step 4: Return the normalized/spoken date** for the Retell response, or `needs_clarification` with a safe agent message.
- [ ] **Step 5: Run the targeted tests** and confirm they pass.

### Task 3: Make the Retell branch deterministic and map it

**Files:**
- Modify: `src/retell/outboundConversationFlow.ts`
- Modify: `RETELL_INSPECTION_FLOW_LOGIC_MAP.md`
- Modify: `RETELL_AGENT_REFINEMENT_NOTES.md`
- Modify: `README_outbound.md`
- Modify: `NEXT_STEPS_OUTBOUND.md`

**Interfaces:**
- Consumes: updated `schedule_followup` result variables.
- Produces: a readable source-controlled flow map and deterministic Retell example.

- [ ] **Step 1: Replace the invoice-received question** with `Good to hear. Do you need the secure payment link?`.
- [ ] **Step 2: Add branch precedence:** yes enters existing text/email delivery; no asks `By what date should we expect payment?`; explicit refusal to pay still uses the one-reason classifier.
- [ ] **Step 3: Add the finetune example** showing link declined, expected date collected, signed follow-up tool called, date confirmed, and normal final-check routing.
- [ ] **Step 4: Update the logic map** with a Mermaid branch diagram plus tool, persistence, terminal, and `/outbound`/`/backend` connector paths.
- [ ] **Step 5: Update operator docs** only for the changed branch and current published version after provider readback.

### Task 4: Verify, deliver, deploy, and publish

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: the complete branch implementation.
- Produces: merged production code and a read-back Retell version with unchanged bindings.

- [ ] **Step 1: Run** `npm test`, `npm run lint`, `npm run build`, `git diff --check`, and the deprecated Retell endpoint guard.
- [ ] **Step 2: Verify production connectors** with authenticated `/api/outbound/setup/status`, `/api/outbound/dashboard`, Presentation Mode preflight, and unified `/api/backend/status`; do not invoke start-call.
- [ ] **Step 3: Commit, push, open a PR, merge after checks, and wait for Vercel production READY.**
- [ ] **Step 4: Publish the updated prompt** only to the explicit existing agent/flow IDs; preserve dashboard voice/runtime tuning and never call a phone-binding update.
- [ ] **Step 5: Run native Retell simulations** for link yes/email, link yes/SMS-disabled, link no/date supplied, link no/date ambiguous, explicit payment refusal, and final-check/end-call.
- [ ] **Step 6: Read back Retell version, tools, model/voice tuning, phone bindings, `/health`, Vercel errors, and Supabase RLS/no-browser-policy state.**
