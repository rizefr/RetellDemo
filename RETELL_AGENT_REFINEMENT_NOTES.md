# Retell Agent Refinement Notes

These notes capture the live-call fixes applied to the active inspection agent so the future service agent can reuse them without re-discovering the same edge cases.

For a complete active-flow inventory, use `RETELL_INSPECTION_FLOW_LOGIC_MAP.md`. It maps Paul's dynamic variables, tools, `/outbound` connector paths, normal and hard terminal routes, known limitations, and Retell API list-endpoint migration rules.

## Active Inspection Agent

- Agent: `Elevator Inspection Collections — Paul`
- Agent ID: `agent_4aa8074d7eabe311109ed6da89`
- Flow ID: `conversation_flow_bebdceabc801`
- Current published version: V91
- Voice: `11labs-Gilfoy`
- Spoken name: `Paul`
- Model: GPT-4.1
- Speed/start delay: `0.82`, `1550 ms`
- Disclosure: active inspection demo uses `on_request`; do not volunteer virtual-assistant wording in normal flow.
- Inbound callback agent: `agent_5ca64503754e06c338e12c743f`, flow `conversation_flow_67cfb3f644e1`, V5. It inherits the published outbound audio settings and adds signed account lookup before invoice disclosure.

## Rules To Keep

- Use backend speech-safe variables for anything read aloud. Do not let Retell infer raw dates, phone numbers, email addresses, invoice IDs, or cents.
- Use `customer_email_spoken_slow` on the first email confirmation. Example: `elixisagency@gmail.com` becomes `e l i x i s agency, at gmail, dot com`.
- If the caller asks Paul to repeat the email, says it is wrong, or sounds confused, use `customer_email_spoken_phonetic` on the second readback instead of waiting for more failures. Example: “e as in Echo, l as in Lima, i as in India...”.
- Use `customer_phone_spoken` on the first phone confirmation. If the caller asks Paul to repeat or correct the phone number, use `customer_phone_spoken_chunked`, for example “three four seven, then five eight five, then zero two four nine.” Never prefix it with “area code” or “plus one.”
- If the caller corrects an email or phone number, repeat the corrected value slowly, confirm once, log `contact_update_requested`, and do not claim delivery to the corrected value unless the backend tool explicitly returns `sent:true`.
- Use `inspection_date_spoken` in the trust-building invoice line. If a separate inspection date is unavailable, the backend may fall back to the invoice date.
- Do not repeat virtual-assistant disclosure after the caller has already confirmed email/text/payment delivery.
- Do not volunteer virtual-assistant disclosure in the normal inspection invoice flow. Use it only when the caller asks if Paul is AI/automated, when a stricter configured policy explicitly requires it, or when scam concern makes one clear disclosure useful.
- Use the short Retell pause marker after the company: “Hi, this is {{agent_display_name}} calling from {{business_name_spoken}}. - I'm calling about an overdue elevator inspection payment. Is this {{customer_first_name_spoken}}?” After confirmation, continue with inspection type, inspection date, and receipt status without repeating Paul’s name or the business name.
- If the caller says they are not the named person or this may be a wrong number, ask once whether they have the right number or email for the named first and last name. Confirm supplied contact details once and log `responsible_party_update_requested`. If they have no contact but are with the account/company, ask once for the better payment/AP contact. If they do not know the person, are not connected to the account, or decline the one contact request, log `wrong_number` and use the dedicated neutral wrong-number close. Do not loop on contact questions.
- If the caller asks personal questions like age or physical location, answer briefly as a digital assistant and steer back to whether the invoice was received.
- If the caller asks “are we done?” before an outcome has been reached, make one reasonable attempt to confirm invoice receipt/resend preference before closing. If an outcome has already been reached, close directly.
- With `11labs-Gilfoy`, avoid the exact phrase “thank you” in active script and do not say “thank you for confirming.” Prefer “Got it,” “I appreciate it,” “That helps,” or “I’ll make a note of that” where natural. A short “You're welcome” is still acceptable if the caller thanks Paul.
- If the caller asks “what invoice” or “what is this about,” answer directly with inspection type, inspection date, amount, and overdue status. Do not repeat disclosure or the secure-link explanation unless asked about payment security.
- Do not repeat generic secure-link explanations after the caller confirms the delivery method. Continue with the action.
- If payment-link creation fails before email/text delivery, do not call delivery tools and do not claim delivery. Log `payment_link_issue`, say the team will follow up with payment details, and route to final-check.
- Use the native static `create_payment_link` execution message for the payment-link bridge. It says “One moment.” and avoids the model beginning a longer phrase that can be clipped.
- Do not say a second bridge line such as “One moment while I send that” between `create_payment_link` and `send_payment_email`.
- Spoken customer and business names should use `customer_first_name_spoken`, `customer_last_name_spoken`, `business_name_spoken`, and `account_company_name_spoken` so all-caps source data does not create pitch or volume spikes.
- Spoken dates should use ordinal wording such as “May twentieth, twenty twenty-six.”
- Retell may send unused optional tool arguments as `null`; backend schemas should accept null optional strings and normalize them to blanks instead of returning 400.
- While SMS is disabled/manual, do not create a payment link before the SMS fallback tool and do not switch to email without confirming the email first.
- Separate polite goodbye from do-not-contact intent. “Bye,” “goodbye,” “no thanks,” and “that’s all” are normal endings, not opt-outs.
- Only explicit phrases like “stop calling,” “don’t call me again,” or “remove me from your call list” should trigger `do_not_contact`.
- Normal terminal paths route to the final-check node: “Is there anything else I can help you with?” Then the native end-call action says “Have a good day. Goodbye.”
- Hard terminal paths are limited to explicit do-not-contact, attorney represented, or hostile/abusive requests. Wrong-number outcomes use the separate wrong-number terminal path with the neutral close “Sorry about that. We'll review the contact information. Goodbye.”
- If payment is refused, ask one non-pushy clarification: “May I ask the reason, so I can note it correctly for the team?” Then classify and stop.
- If the caller confirms the invoice was received, ask “Do you need the secure payment link?” A bare yes must be followed by “Would you prefer text or email?” rather than inferring email from the address on file. If they say no, ask “When can I expect the payment?” A declined link is not a refusal to pay. Clarify vague non-dates such as “soon” without storing them. Route every concrete date through the dedicated expected-payment-date function node and wait for `schedule_followup`. The native End node then says “Got it. I'll expect your payment on {{expected_payment_date_spoken}}. Have a good day. Goodbye.” and ends. Never ask the caller to confirm that stored date again.
- After `send_payment_email` or a future enabled SMS tool returns `sent:true`, confirm delivery once and ask exactly “When can I expect the payment?” Do not final-check immediately after delivery. Route the answer through the same trusted expected-payment-date function node, and do not ask the question when delivery failed or remained manual/pending.
- When a caller detours into payment methods or another relevant side question, answer briefly and return once to the unresolved step. Do not restart the opening, disclosure, or invoice recap, and do not repeat a recovery question after it has been answered.
- If the caller says they are no longer responsible for payments, collect the new responsible party name, phone, and email only if they are willing. Do not transfer by default.
- If the caller asks for a named person, log `named_contact_requested` and say that person or someone from their team will follow up.
- For named-contact requests, log before promising the follow-up. This avoids call summaries that show a follow-up promise without the backing event.
- For service/inspection issues, collect a concise description, log `service_issue_reported`, create manual review/follow-up, and do not push payment unless the caller brings payment back up.
- For Retell inventory scripts, do not use deprecated SDK `client.agent.list()` or legacy `GET /list-agents`, and do not use `client.phoneNumber.list()` or legacy `GET /list-phone-numbers`. Use the local versioned helpers in `src/retell/retellList.ts`, and keep the deprecation guard test passing.
- Keep `/backend`, `/outbound`, and all production call routes fixed to the explicit Conversation Flow agent and flow IDs. Do not restore browser-selectable agent variants. Pin calls to `latest_published`, and reject signed tool/webhook traffic whose `call.agent_id` is not the configured outbound agent.
- Before publishing a prompt update, read back and preserve the active dashboard voice runtime settings. The setup script now retains model, speed, temperature, interruption, responsiveness, backchannel, start delay, and ambience values instead of replacing manual provider tuning with local defaults.
- The August 12 GPT-4.1/GPT-5.6 Luna/GPT-4.1 mini comparison used the same final prompt and kept GPT-4.1. GPT-4.1 passed 9/9; Luna passed 7/9 and was faster and cheaper but skipped required phone confirmation and failed one stop-call end; 4.1 mini passed 8/9 but missed the native expected-date goodbye. Luna V84 and 4.1 mini V85 remain unpublished comparison drafts.
- For inbound callbacks, ask for first and last name, then invoke `lookup_inbound_account`. A name alone is not verified. Require the signed calling phone plus name, or the name plus a matching account/company, invoice number, original email, or preferred email before disclosing invoice details. After verification, continue through the existing invoice-received branch without restarting the introduction.
- Keep inbound verification structural: the identity subagent transitions to a Function node that waits for `lookup_inbound_account`; transition prompts inspect the most recent trusted tool result. Permit only one safe corroboration retry. Refusal, not-found after retry, or another unverified result must reach the privacy-safe terminal path without invoice disclosure.
- Retell Playground tool mocks do not currently fill Function-node response-variable mappings. For native simulations, inject only non-sensitive account speech variables while keeping route decisions based on the mocked trusted lookup result. The production custom tool retains its response-variable mappings.
- Keep inbound and outbound provider targeting separate. Outbound call creation uses the explicit inspection agent; the signed inbound phone webhook selects the explicit callback agent stored on the business. Both directions use the same server-side tools only after trusted metadata resolves to a call attempt.
- Outbound voicemail is a provider-level static message so it can finish after voicemail detection without asking the language model to improvise or disclose invoice details. Keep it short and use the collections callback number.

## Knowledge Base Foundation

Use business-specific knowledge as context, not as authority over trusted invoice data. Backend variables always win for invoice amount, inspection date, customer email, phone, payment provider, and payment status.

Initial knowledge topics:

- Business name and description.
- Account/company name for wrong-person confirmation.
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
