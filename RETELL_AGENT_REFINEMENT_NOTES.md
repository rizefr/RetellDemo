# Retell Agent Refinement Notes

These notes capture the live-call fixes applied to the active inspection agent so the future service agent can reuse them without re-discovering the same edge cases.

## Active Inspection Agent

- Agent: `Elevator Inspection Collections — Sophia`
- Agent ID: `agent_4aa8074d7eabe311109ed6da89`
- Flow ID: `conversation_flow_bebdceabc801`
- Voice: `11labs-Sloane`
- Spoken name: `Sophia`
- Model: GPT-4.1
- Speed/start delay: `0.88`, `1000 ms`

## Rules To Keep

- Use backend speech-safe variables for anything read aloud. Do not let Retell infer raw dates, phone numbers, email addresses, invoice IDs, or cents.
- Use `customer_email_spoken_slow` when confirming an email address. Example: `elixisagency@gmail.com` becomes `e-l-i-x-i-s agency at gmail dot com`.
- Use `inspection_date_spoken` in the trust-building invoice line. If a separate inspection date is unavailable, the backend may fall back to the invoice date.
- Do not repeat virtual-assistant disclosure after the caller has already confirmed email/text/payment delivery.
- Do not repeat generic secure-link explanations after the caller confirms the delivery method. Continue with the action.
- Use one bridge line for a payment-link delivery sequence. Say one short line such as “One moment while I pull that up,” then run the payment-link and email/text tools back-to-back.
- Do not say a second bridge line such as “One moment while I send that” between `create_payment_link` and `send_payment_email`.
- Separate polite goodbye from do-not-contact intent. “Bye,” “goodbye,” “no thanks,” and “that’s all” are normal endings, not opt-outs.
- Only explicit phrases like “stop calling,” “don’t call me again,” or “remove me from your call list” should trigger `do_not_contact`.
- Normal terminal paths route to the final-check node: “Is there anything else I can help you with?” Then the native end-call action says “Have a good day. Goodbye.”
- Hard terminal paths are limited to explicit do-not-contact, attorney represented, wrong number, or hostile/abusive requests.
- If payment is refused, ask one non-pushy clarification: “May I ask the reason, so I can note it correctly for the team?” Then classify and stop.
- If the caller says they are no longer responsible for payments, collect the new responsible party name, phone, and email only if they are willing. Do not transfer by default.
- If the caller asks for a named person, log `named_contact_requested` and say that person or someone from their team will follow up.
- For service/inspection issues, collect a concise description, log `service_issue_reported`, create manual review/follow-up, and do not push payment unless the caller brings payment back up.

## Knowledge Base Foundation

Use business-specific knowledge as context, not as authority over trusted invoice data. Backend variables always win for invoice amount, inspection date, customer email, phone, payment provider, and payment status.

Initial knowledge topics:

- Business name and description.
- Inspection types: Category 1, Category 5, Acceptance Test, Periodic Inspection.
- Why the business is calling.
- How payment links work.
- No card details are collected by phone.
- Stripe link today; QuickBooks link only when the provider is connected.
- Email/text preferences and SMS manual status.
- Callback policy.
- Mailing/check instructions only when configured.
- Common questions: who is this, what inspection, is this a scam, how do I pay, can I mail a check, can I talk to someone, when was the inspection, what if I already paid, what if the amount is wrong.

Retell docs currently support knowledge-base sources such as URLs, documents, and text snippets. Conductor was not confirmed as necessary for this single-flow inspection demo. Use the normal flow prompt/context approach unless a future Retell readback shows Conductor is available and materially useful.

## Porting To Elevator Service Collections

The service copy should reuse the same delivery, terminal, email, bridge-line, and safety rules. Change only the business script frame:

- Service companies can discuss elevator operation or service issues.
- Inspection companies should not ask whether elevators are operating properly.
- Replace inspection-date and inspection-type wording with service-date and service-type wording.
- Keep the same payment-link delivery, do-not-contact, final-check/end-call, responsible-party, named-contact, and email-reading rules.
