# Pinnacle QuickBooks Connection Checklist

## Current Boundary

QuickBooks is not connected in production. The outbound app remains in Stripe mode, QuickBooks routes remain scaffold-only, SMS remains disabled/manual, and calls still require the existing server preflight plus a deliberate single-call start.

The target future workflow is:

1. Read Customers, Invoices, and linked Payments from Pinnacle's QuickBooks Online company.
2. Preview creates, updates, skips, conflicts, paid records, and paused records before importing anything.
3. Mark an unpaid inspection invoice eligible 14 calendar days after the confirmed inspection date.
4. Keep do-not-contact, wrong-number, dispute, attorney, paid, and outreach-pause gates authoritative.
5. Queue eligible work for review. Do not enable unattended dialing until Pinnacle approves the data mapping, calling rules, one live acceptance call, monitoring, and rollback process in writing.

## Information To Collect From Pinnacle

- Legal business name and QuickBooks company/realm ID.
- Primary implementation and accounts-receivable contacts.
- QuickBooks Online administrator who can authorize the Intuit app.
- Sandbox or test company access for field-mapping validation.
- How Category 1, Category 5, Acceptance Test, and Periodic Inspection appear in QuickBooks.
- The authoritative inspection-date field. Do not assume `TxnDate` is the inspection date.
- Customer first name, last name, company, phone, and email fields used in practice.
- Invoice number, balance, due date, currency, void/credit/dispute handling, and payment linkage.
- Whether the 14-day threshold means calendar days or business days.
- Approved calling hours, timezone rules, retry limits, voicemail wording, and callback number.
- Existing suppression/do-not-contact records and the process for wrong contacts or disputed invoices.
- Preferred payment-link provider and email sender. Stripe remains active until a QuickBooks payment workflow is separately approved.

The companion client workbook is `Pinnacle_QuickBooks_Connection_Intake.xlsx`. It includes editable intake, field mapping, automation rules, security approvals, and a go-live checklist. Never put a client secret, refresh token, password, API key, or card/bank data in the workbook.

## Server-Side Environment

Configure these only in Vercel or another approved server-side secret store:

- `QUICKBOOKS_CLIENT_ID`
- `QUICKBOOKS_CLIENT_SECRET`
- `QUICKBOOKS_REDIRECT_URI=https://elixis.agency/api/outbound/quickbooks/callback`
- `QUICKBOOKS_ENVIRONMENT=sandbox` initially

The browser and Supabase business row should expose only connected/missing indicators, environment, and company/realm ID. They must never expose OAuth access tokens, refresh tokens, client secrets, or provider credentials.

## OAuth And Read-Only Policy

QuickBooks Online uses OAuth 2.0. The accounting scope provides broad access, so "read-only" must be enforced by application policy: use query/read endpoints only, keep mutation code disabled, validate signed one-time OAuth state, and store tokens server-side.

Official references:

- OAuth 2.0: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- Scopes: https://developer.intuit.com/app/developer/qbo/docs/learn/scopes
- Data queries: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
- Webhooks: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/configure-webhooks

## Field Mapping Acceptance

Before importing production records, validate representative sandbox records for:

| QuickBooks source | Outbound destination | Rule |
| --- | --- | --- |
| `Customer.Id` | `outbound_customers.external_customer_id` | Stable provider key; never match by display name alone. |
| `GivenName`, `FamilyName` | customer names | Preserve display values and generate spoken-safe values separately. |
| `CompanyName` / `DisplayName` | `account_company_name` | Required context for inbound identity corroboration. |
| `PrimaryPhone.FreeFormNumber` | `phone_number` | Normalize to E.164 or reject. |
| `PrimaryEmailAddr.Address` | `email` | Validate and retain preferred-contact overrides. |
| `Invoice.Id` | provider invoice reference | Server-side provider key. |
| `DocNumber` | `invoice_id` | Human-readable invoice number. |
| confirmed inspection date field | `inspection_date` | Required for the 14-day rule; no guessing. |
| `DueDate` | `original_due_date` | Keep separate from inspection date. |
| `Balance` | `amount_due_cents` | Convert dollars to integer cents; `Balance > 0` is necessary but not sufficient for outreach. |
| approved item/custom field | `inspection_type` | Map to the supported inspection types. |
| linked `Payment` | paid reconciliation | Mark paid only from authoritative linked data. |

QuickBooks query responses can be paginated, so the future sync must continue with bounded pages and reconcile deleted/voided/paid state. A webhook should trigger an authoritative read by entity ID rather than treating the webhook payload as the final record.

## Four Rollout Gates

1. **Sandbox connection:** OAuth state validation, token storage, and connected-status readback pass.
2. **Read-only preview:** representative Customer, Invoice, and Payment records map correctly; the operator approves create/update/skip/conflict counts.
3. **Eligibility dry run:** known invoices produce the expected result for inspection date + 14 days, payment status, customer pause, do-not-contact, timezone, and calling window.
4. **Calling acceptance:** one explicitly authorized call passes preflight, transcript/tool/outcome logging is reviewed, and Pinnacle approves limits and rollback. Only a later, separate approval may enable scheduled dialing.

## Inbound Callback Data

The inbound collections agent can search imported open invoices after the caller provides a first and last name. A name alone does not authorize disclosure. The backend requires one matching trusted corroborator: the calling phone number, account/company name, invoice number, or stored email. Ambiguous or unverified callers receive no invoice amount, date, number, inspection type, customer email, or phone.

## Decisions For The Client Meeting

- Confirm the exact business name: `Pinnacle Elevator Solutions`.
- Confirm the callback number and voicemail wording.
- Confirm the authoritative inspection-date and inspection-type fields.
- Confirm calendar versus business days for the 14-day rule.
- Confirm sandbox access and the QuickBooks administrator.
- Confirm the approved calling window and recipient timezone policy.
- Confirm that scheduled production dialing remains disabled until written acceptance.
