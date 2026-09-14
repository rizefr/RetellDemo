# QuickBooks collections integration

## Current implementation

The authenticated collections integration supports a read-only provider, reviewed import preview, atomic application import, source reconciliation, a server-derived overdue queue, and an operational CSV. It does not modify QuickBooks accounting records, send invoices, create charges, or launch outreach.

Endpoints under `/api/outbound/integrations/quickbooks` require the existing outbound administrator session. Mutations also require the browser CSRF guard:

- `GET /status?business_id=<uuid>` reads the configured company and checks managed connection identity when a deployment credential is present.
- `POST /preview` accepts `business_id`, reads every invoice page and exact referenced customer IDs, obtains an expiring database lease, and saves a hashed preview. The response shows counts, currency-specific totals, mappings and exclusions.
- `POST /apply` accepts `business_id`, `preview_id`, and `preview_hash`. A service-only database function validates tenant, realm, hash, expiry and prior application in one transaction.
- `GET /queue?business_id=<uuid>` returns invoices with a positive balance and more than 14 calendar days past due, alongside local pause/status/history gates, exclusions, and currency-separated account summaries.
- `GET /report.csv?business_id=<uuid>` downloads the same operational review, with formula-injection protection and monetary values in major currency units.

The existing demo business remains separate from accounting data. Import into a demo business is rejected. Company, customer and invoice mappings use explicit realm and stable provider IDs; names never establish identity. Each full synchronization preserves local contact choices, pauses, disputes, promised dates and call history. Paid records cancel follow-ups; source records missing from the next complete snapshot lose verification. Missing contact/service mappings are quarantined. Partial read failures produce no preview, and apply failures roll back every row.

## Connection and credentials

The current review verified the production realm in the signed-in QuickBooks company settings and corroborated it with an existing managed-connection GET to that exact realm. Legal/company identity and US country matched. The remaining unattended-provider blocker is a correctly scoped server credential with demonstrated access to the exact existing private connection. The staged snapshot has not been imported into the application.

QuickBooks Online is supported; Desktop is not. Before binding a company, verify its realm ID, environment, exact Composio connected-account ID and connection-owner ID. CompanyInfo.Id is not a realm ID. The reviewed user selected America/New_York for aging and review scheduling, even when a source company reports another timezone.

The OAuth scope `com.intuit.quickbooks.accounting` grants broad accounting access. Read-only is an application boundary, not an OAuth scope restriction. The provider permits only bounded Invoice/Customer queries and approved GET operations. The Composio proxy transports those reads through the explicitly bound managed account. No Payments scope or payment-processing authority is assumed.

Store a properly scoped deployment Composio credential as `QUICKBOOKS_COMPOSIO_API_KEY` in approved server secret storage. The required Composio permission areas are Connected accounts Read and Proxy execute Write. The latter authorizes transport through the proxy; this application's upstream requests remain restricted to GET. A default project key has broader access and should not be described as read-only. Verify the credential can access the exact authorized private account in its project before deployment; a connection visible to the personal CLI may belong to a different project. Personal CLI credentials beginning `uak_` are rejected. The live CLI connection does not prove unattended deployment access. Tokens remain in Composio's managed storage; the application does not implement a second token store or claim its own refresh/revocation path. Provider authorization/owner/environment failures block reads and expose redacted diagnostics. A custom OAuth flow is not enabled by this implementation.

No QuickBooks webhook receiver is active. Manual polling is the verified design boundary. Signed-webhook authenticity and replay testing become requirements if a webhook transport is later enabled.

## Payment links

A QuickBooks-origin invoice can never fall back to Stripe. Explicit Stripe/demo invoices retain their existing flow. Before returning a QuickBooks payment link, the provider re-reads the exact invoice and validates company, customer ID, balance, currency and due date. It requests `include=invoiceLink` on the existing invoice GET, without invoking invoice-send or create actions. A real read of an existing invoice returned an Intuit `InvoiceLink` on `https://connect.intuit.com/t/scs-v1-…`; the validator now supports that observed token path as well as approved customer-portal paths. Exact invoice, customer, USD balance and due date were read back; no send or create action was called. Only approved HTTPS Intuit customer-payment destinations are accepted. Internal accounting URLs remain labeled accounting links.

If a verified customer link is unavailable, the backend returns `manual_payment_followup_required`. An operator may inspect the existing invoice's Share link in QuickBooks; no automatic send, invoice duplication, or Stripe substitution is performed. Cached link previews require matching invoice/provider/realm/amount/currency, an unexpired application link, and recent verified source data.

## Schedule and spreadsheet

The selected weekly review schedule is Tuesday at 12:00 noon America/New_York, with an email reminder to a privately approved operator destination. The reminder can report connection blockers while the source remains staged. Activation still requires a tested deployed reservation/completion path and working reminder transport. Automated source synchronization remains disabled until company identity, server credentials and reviewed import are verified. Both call entry paths recheck provider balance and all server call gates immediately before calling.

The private workbook produced during review is a staged source preview. It is not a connected runtime synchronization and cannot bypass backend gates. Its authoritative source and calculated ranges are protected; sharing and formula totals are read back from Google. There is no sheet-to-accounting or sheet-to-call write path. Unknown local history remains explicitly unavailable until validated application import.

## Internal weekly reminder lifecycle

Authenticated endpoints under `/api/outbound/integrations/review-runs` provide status, configuration, claim, and completion. They never send email themselves:

- `GET /status?business_id=<uuid>` returns the configured private workbook, schedule, stage, connection blockers, and recent delivery states. Claim tokens are excluded.
- `POST /config` accepts the existing `business_id`, workbook URL, `stage`, and `enabled`. It preserves the privately approved recipient; request-supplied destinations are rejected. Live stage requires a verified live business binding.
- `POST /claim` accepts only `business_id`. A database transaction allows at most one reservation per business and New York calendar week, after Tuesday noon. Only a newly created claim returns `can_send: true`, its token, and the prepared recipient/content. The scheduler must use these returned values unchanged.
- `POST /complete` requires `business_id`, `run_id`, `claim_token`, and an outcome: `accepted`, `uncertain`, or `failed_no_send`. Accepted requires the actual provider message ID. Provider acceptance is not an inbox receipt.

A scheduler sends only after a successful new claim and completes it using provider evidence. A timeout or ambiguous provider result must be completed as uncertain without another send. Duplicate claims, accepted runs, uncertain results, failures, and expired 15-minute reservations never permit another send in that week. Late evidence may resolve an uncertain result to accepted without sending again. A later calendar week is independent.

Recipient approvals live in a private per-business database table that the application can only read. Composite foreign keys bind both settings and runs to that approved business/recipient pair. Existing production recipient restrictions remain in place. No private destination or workbook identifier is stored in public source code. The configured automation and database switch start paused/disabled.

Historical staged totals never become current balances in a reminder. When connection/source checks fail, the prepared message states the blockers and snapshot age. The reminder does not start source import, calls, customer messages, or accounting writes.

## Validation and deployment

Apply `20260914135816_outbound_quickbooks_readonly_sync.sql`, then `20260914152000_outbound_quickbooks_service_date.sql`, before dependent code. The separate service-date column is nullable for legacy rows; no historical date is inferred. New RLS tables and RPCs are restricted to the service role. Apply `20260914175000_outbound_weekly_review_runs.sql`, then `20260914181000_outbound_review_recipient_approval.sql`, before deploying the reminder and integration status routes. Provision each recipient approval and initial settings privately after explicit operator authorization.

The production rollback-only regression exercises client privilege/RLS restrictions, overlapping job leases, incorrect lease release, cross-tenant/hash rejection, idempotency, partial and full payments, rollback after a later invalid row, local contact/history preservation, and zero fixture residue. Unit tests cover exact 14/15-day boundaries and DST, invalid/missing source data, supported two-decimal currencies, duplicate/partial reads, formula injection, customer identity, payment URL isolation, expired provider authorization and managed-account binding. Contact tests cover missing versus malformed numbers, verified US formatting and extensions, foreign/unknown-region quarantine, and multiple email addresses. Provider tests assert the actual Composio REST wire format (`connected_account_id` and parameter `type`), the current v3.1 metadata/proxy routes, and raw owner/environment/company checks. Local tests do not prove an unattended provider connection.

The separate rollback-only reminder regression verifies RLS/privileges, the exact Tuesday boundary, duplicate and overlapping reservations, incorrect business/token rejection, recipient anchoring, accepted-result idempotency, conflicting provider IDs, expiry and uncertain nonretry behavior, independent weeks, and zero fixture residue. It does not send a test reminder.

Private read snapshots, provider logs and the workbook reconciliation are retained under ignored `outputs/pinnacle-review-20260914/quickbooks/`. Keep them out of public Git history. Deployment readiness and live-provider readiness are reported separately in the final evidence table.

## Official references

- [Intuit Invoice API](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice)
- [Intuit OAuth scopes](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/scopes)
- [Composio scoped project permissions](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions)
- [Composio proxy transport implementation](https://github.com/ComposioHQ/composio/blob/next/ts/packages/core/src/models/Tools.ts)
- [Google Sheets protected ranges](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets#ProtectedRange)
