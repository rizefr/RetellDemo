# Next Steps For Outbound Demo

## QuickBooks Future Connection

QuickBooks is scaffolded only. Do not create live QuickBooks payment links until a business authorizes its QuickBooks Online company and the token-storage policy is reviewed.

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

## If Resend Or Email Fails

1. Confirm Resend shows `elixis.agency` verified in the same workspace as the production API key.
2. Confirm Vercel has `EMAIL_PROVIDER=resend`, `EMAIL_PROVIDER_API_KEY`, `OUTBOUND_PAYMENT_EMAIL_FROM`, and `OUTBOUND_PAYMENT_EMAIL_ENABLED=true`.
3. Confirm the business settings request email delivery and the test-recipient allowlist contains only the controlled recipient.
4. Confirm the selected customer has the controlled test email on file or as preferred email.
5. Retry one controlled email only; inspect `outbound_events` for `email_pending_manual`, `email_failed`, or `email_sent`.
6. If provider auth fails, rotate/update only the Resend API key in Vercel and redeploy.

## If Retell Tool Calls Fail

1. Verify the published flow uses wrapped signed `{name,args,call}` custom tool requests and does not set `args_at_root`.
2. Verify Vercel receives the request and `X-Retell-Signature` validates.
3. Confirm trusted IDs are present in `call.metadata`: `business_id`, `customer_id`, `invoice_id`, and `call_attempt_id`.
4. Check `/outbound` events for redacted tool errors.
5. Re-run Retell native simulations before another real call.
6. Do not weaken backend validation to trust caller-supplied invoice amounts or IDs.

## Future SMS Enablement

SMS remains disabled/manual. When Retell SMS is verified for the number and subscription, run a follow-up prompt like:

```text
Enable outbound payment-link SMS for the existing B2B outbound demo. Preserve all safety gates. Verify Retell SMS capability for +19842075346, add provider readiness checks, keep SMS disabled until dashboard settings and server env both agree, send only after explicit caller preference and number confirmation, and test with one controlled allowlisted recipient.
```

Keep `OUTBOUND_RETELL_SMS_ENABLED=false` until the provider path is verified.

## Demo Maintenance

- Keep invoice/payment status separate from demo call mode.
- Use Presentation Mode for temporary test numbers instead of mutating the persistent allowlist.
- Keep Stripe as the default provider until QuickBooks is fully connected.
- Keep batch campaigns disabled for demos.
