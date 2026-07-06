# Unified Backend

`/backend` is the unified internal dashboard for the Elixis Agency demo backend. It combines operational status for the existing outbound collections dashboard and inbound receptionist dashboard without removing either legacy route.

## What it combines

- `/outbound`: first-party B2B elevator inspection invoice follow-up dashboard.
- `/inbound`: Elijah's Pest Control inbound receptionist status dashboard.
- `/backend`: shared authenticated shell with Overview, Outbound Collections, Inbound Receptionist, Settings / Setup, and Docs / Runbooks sections.

The old `/outbound` and `/inbound` routes remain compatibility routes.

## Login

`/backend` uses the same admin token as `/outbound`: `OUTBOUND_ADMIN_TOKEN`.

On successful login, the backend sets HttpOnly SameSite cookies for the unified backend and the legacy outbound dashboard. The token is not placed in a URL, local storage, frontend JavaScript bundle, or API response.

If `/inbound` still uses `INBOUND_ADMIN_TOKEN`, that old route keeps its original login behavior. The unified `/backend` can still show inbound read-only status through server-side backend routes after the outbound admin token login.

## Sidebar sections

- Overview: base URL, auth/session state, outbound status, inbound status, provider readiness, latest event summaries when available.
- Outbound Collections: embeds the existing `/outbound` dashboard so setup, CSV import, preflight, invoice/customer edits, payment links, call history, dry runs, and gated test-call controls remain intact.
- Inbound Receptionist: read-only inbound agent, phone, Retell, Supabase, webhook/tool, recent call, and recent lead status.
- Settings / Setup: redacted environment readiness and route map.
- Docs / Runbooks: links to this file and the existing inbound/outbound runbooks.

## API ownership

Existing APIs remain the source of truth:

- `/api/outbound/*` owns outbound customers, invoices, setup status, payment links, call gates, Retell tools, Retell webhooks, and Stripe webhooks.
- `/api/inbound/*` owns inbound status and legacy inbound auth behavior.
- `/api/backend/*` owns only unified backend login/session/navigation/status.

## Future outbound updates

Future outbound UI changes should target `/backend` first while preserving `/outbound` compatibility. If a control already exists in `/outbound`, keep its API behavior in `/api/outbound/*` and surface it in the `/backend` Outbound tab.

## Future inbound updates

Future inbound UI changes should target `/backend` first while preserving `/inbound` compatibility. Do not change the inbound Retell agent, LLM, Cal.com tools, or phone binding from dashboard code unless that capability is explicitly added later.

## Deployment notes

The Express app serves `/backend` through `src/routes/backendPage.ts` and static assets through `/backend-assets`. Vercel continues to use `public/server.ts`, which imports the same Express app.

After deployment, verify:

- `GET /health`
- `GET /backend`
- backend login with `OUTBOUND_ADMIN_TOKEN`
- Outbound tab and embedded `/outbound`
- Inbound tab status
- legacy `/outbound`
- legacy `/inbound`
- public website routes

## Safety notes

- No secrets are returned to frontend code.
- Service-role, Stripe, Retell, admin-token, and webhook secrets must stay server-side only.
- Do not break Retell webhooks, Stripe webhooks, Supabase writes, or public marketing routes.
- Do not change Retell phone bindings from the dashboard unless an explicitly reviewed feature is added.
- Do not place calls, send SMS, send email, or create Stripe charges during dashboard verification.
