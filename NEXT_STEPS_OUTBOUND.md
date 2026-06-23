# Next Steps For Outbound Demo

## Current Verified Baseline

- Production domain: `https://elixis.agency`.
- Outbound Retell agent: `agent_4aa8074d7eabe311109ed6da89`.
- Outbound Conversation Flow: `conversation_flow_bebdceabc801`.
- Latest verified Retell version: V33; V34 is the hard-terminal acknowledgment patch when published.
- Voice and pacing: `11labs-Paul`, speed `0.88`, `1000 ms` first-message delay, GPT-4.1.
- GPT-5.1 was tested against GPT-4.1 on the same V33 Retell native scenarios. It did not clearly improve reliability and was slower in the observed batch, so GPT-4.1 remains the selected demo model.
- Terminal behavior: normal terminal paths use the structural final-check/end-call sequence; hard terminal paths log/pause as needed and end directly.
- Production backend email path: verified with one controlled Retell-tool-path `email_sent` event to `elixisagency@gmail.com`, and Gmail receipt was confirmed.
- Presentation Mode: temporary demo-number authorization and backend preflight have been verified without placing a call.
- SMS remains disabled/manual. QuickBooks remains scaffold-only.

## Retell Model And Voice Maintenance

Current Retell settings to preserve for the elevator demo:

- agent `agent_4aa8074d7eabe311109ed6da89`
- flow `conversation_flow_bebdceabc801`
- model GPT-4.1
- voice `11labs-Paul`
- voice model ElevenLabs Flash v2.5
- speed `0.88`
- first-message delay `1000 ms`
- wrapped signed tools with `args_at_root` disabled

Retell public pricing is per minute for voice-agent LLM usage. GPT-5.1 is currently cheaper per standard LLM minute than GPT-4.1, but the V33 simulation comparison did not show a demo-quality improvement. Re-test GPT-5.1 only if Retell releases a lower-latency setting or if GPT-4.1 starts missing tool/final-check behavior.

## QuickBooks Future Connection

QuickBooks is scaffolded only. Do not create live QuickBooks payment links until a business authorizes its QuickBooks Online company and the token-storage policy is reviewed. Stripe remains the default provider for the elevator demo.

Required env vars:

```bash
QUICKBOOKS_CLIENT_ID=
QUICKBOOKS_CLIENT_SECRET=
QUICKBOOKS_REDIRECT_URI=https://elixis.agency/api/outbound/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox
```

After receiving a client’s QuickBooks account details:

1. Create or select the Intuit app in the client-approved workspace.
2. Add the production callback URL.
3. Store client ID/secret in Vercel, not in browser settings.
4. Use `/api/outbound/quickbooks/connect` to start OAuth.
5. Implement token exchange/storage for the returned `code` and `realmId`.
6. Read back connection status in `/outbound`.
7. Implement invoice lookup/payment-link creation for the connected realm.
8. Update Retell wording so Paul says “QuickBooks payment link” only when the backend returns a real link.

Future implementation prompt:

```text
Complete the QuickBooks Online connection for the existing outbound B2B invoice demo. Preserve Stripe as fallback, preserve all Retell safety gates, implement Intuit OAuth token exchange/storage for the approved business only, fetch or create invoice-specific QuickBooks payment links, keep no verbal card collection, and verify with QuickBooks sandbox before any production business account.
```

## If Resend Or Email Fails

1. Treat a direct Resend diagnostic email to `elixisagency@gmail.com` as provider-delivery evidence only. The release check is the deployed backend/Retell email path.
2. Confirm Resend shows `elixis.agency` verified in the same workspace as the production API key.
3. Confirm Vercel has `EMAIL_PROVIDER=resend`, the current `EMAIL_PROVIDER_API_KEY`, `OUTBOUND_PAYMENT_EMAIL_FROM`, and `OUTBOUND_PAYMENT_EMAIL_ENABLED=true`.
4. If Vercel has a stale key, update the Vercel Production env var from local `.env` without printing the secret, then redeploy.
5. Confirm the business settings request email delivery and the test-recipient allowlist contains only the controlled recipient.
6. Confirm the selected customer has the controlled test email on file or as preferred email.
7. Send exactly one controlled email through the deployed backend path, then inspect Gmail, `outbound_events`, and `/outbound` for `email_sent`.
8. Test the Retell email tool path with a wrapped signed payload. If it cannot be tested without placing a real call, document the exact blocker and the strongest safe equivalent performed.
9. If provider auth fails, rotate/update only the Resend API key in Vercel and redeploy.

## If Retell Tool Calls Fail

1. Verify the published flow uses wrapped signed `{name,args,call}` custom tool requests and does not set `args_at_root`.
2. Verify Vercel receives the request and `X-Retell-Signature` validates.
3. Confirm trusted IDs are present in `call.metadata`: `business_id`, `customer_id`, `invoice_id`, and `call_attempt_id`.
4. Check `/outbound` events for redacted tool errors.
5. For terminal/end-call failures, first try structural fixes: native End Call nodes/actions, terminal routing nodes, tool-return-driven transitions, or smaller terminal subflows. Prompt wording alone is not completion.
6. Re-run Retell native simulations before another real call, especially service issue, mail check, email/manual fallback, callback scheduled, responsible-party update, named-contact request, stop-calling, and small talk.
7. Do not weaken backend validation to trust caller-supplied invoice amounts or IDs.

## Demo Number Workflow Troubleshooting

If the Presentation Mode button fails:

1. Confirm `/outbound` is authenticated with the HttpOnly admin cookie.
2. Confirm test mode is on and max batch size is `1`.
3. Confirm the entered number is E.164 and the exact phrase is `I AUTHORIZE THIS DEMO TEST CALL`.
4. Inspect the browser console and Vercel logs for `/api/outbound/demo-call/authorize-number`.
5. Confirm `outbound_demo_call_authorizations` has a non-revoked row with future `expires_at`.
6. Save demo variables, run preflight, and confirm the preflight response uses `destination_phone_number` from the temporary authorization.
7. If outside hours, separately satisfy the after-hours self-test checkbox and exact phrase. Demo-number authorization does not bypass calling-window rules.
8. Do not click start until the user explicitly approves exactly one call.

## Future SMS Enablement

SMS remains disabled/manual. When Retell SMS is verified for the number and subscription, run a follow-up prompt like:

```text
Enable outbound payment-link SMS for the existing B2B outbound demo. Preserve all safety gates. Verify Retell SMS capability for +19842075346, add provider readiness checks, keep SMS disabled until dashboard settings and server env both agree, send only after explicit caller preference and number confirmation, and test with one controlled allowlisted recipient.
```

Keep `OUTBOUND_RETELL_SMS_ENABLED=false` until the provider path is verified.

When SMS is enabled later, Retell must still confirm the phone number aloud using `customer_phone_spoken`, send only after explicit caller preference, and log `sms_pending_manual` instead of claiming success whenever the provider response is not `sent:true`.

## Demo Maintenance

- Keep invoice/payment status separate from demo call mode.
- Use Presentation Mode for temporary test numbers instead of mutating the persistent allowlist.
- Keep demo call mode separate from invoice/payment status.
- Use speech-safe Retell variables for phone, email, dates, invoice IDs, and amounts.
- Keep the normal final-check/end-call behavior structural in Retell, not just prose.
- Keep Stripe as the default provider until QuickBooks is fully connected.
- Keep batch campaigns disabled for demos.
