import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { sign } from "retell-sdk";

describe("outbound admin routes", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("requires login, exchanges the token for an HttpOnly cookie, and never puts it in the page", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "route-test-admin";
    vi.resetModules();
    const { createApp } = await import("../app");
    const app = createApp();

    const blocked = await request(app).get("/outbound");
    expect(blocked.status).toBe(401);
    expect(blocked.text).toContain("Outbound collections");
    expect(blocked.text).not.toContain("route-test-admin");

    const login = await request(app).post("/api/outbound/auth/login").send({ token: "route-test-admin" });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    const page = await request(app).get("/outbound").set("Cookie", login.headers["set-cookie"]);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Customers and invoices");
  });

  it("rejects outbound data routes without cookie or bearer authentication", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "route-test-admin";
    vi.resetModules();
    const { createApp } = await import("../app");
    const response = await request(createApp()).get("/api/outbound/invoices");
    expect(response.status).toBe(401);
  });

  it("returns a dashboard payload with secret-like event fields redacted", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "route-test-admin";
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>(
        "../services/outboundRepository",
      );
      return {
        ...actual,
        listOutboundDashboardData: vi.fn().mockResolvedValue({
          invoices: [],
          calls: [],
          payment_links: [],
          events: [
            {
              id: "event-1",
              event_type: "call_analyzed",
              payload: { call: { call_id: "call-1", access_token: "private" }, signature: "private" },
            },
          ],
        }),
      };
    });
    vi.resetModules();
    const { createApp } = await import("../app");
    const response = await request(createApp())
      .get("/api/outbound/dashboard")
      .set("Authorization", "Bearer route-test-admin");

    expect(response.status).toBe(200);
    expect(response.body.events[0].payload.call.access_token).toBe("[REDACTED]");
    expect(response.body.events[0].payload.signature).toBe("[REDACTED]");
    expect(JSON.stringify(response.body)).not.toContain("private");
  });
});

describe("outbound webhook contracts", () => {
  it("contains database-level Stripe event idempotency guards", () => {
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260609_outbound_collections.sql"),
      "utf8",
    );
    expect(migration).toContain("outbound_events_provider_id_unique");
    expect(migration).toContain("where source = 'stripe' and external_event_id = p_external_event_id");
    expect(migration).toContain("outbound_mark_invoice_paid");
    expect(migration.match(/^create table if not exists public\.outbound_/gm)).toHaveLength(7);
    expect(migration).not.toMatch(/^create policy/gm);
    const hardeningMigration = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260619_outbound_demo_hardening.sql"),
      "utf8",
    );
    expect(hardeningMigration).toContain("add column if not exists duration_ms");
    expect(hardeningMigration).toContain("add column if not exists analysis jsonb");
    expect(hardeningMigration).toContain("email_pending_manual");
    expect(hardeningMigration).not.toMatch(/^create policy/gm);
    const rpcFixMigration = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260619_outbound_mark_paid_rpc_fix.sql"),
      "utf8",
    );
    expect(rpcFixMigration).toContain("where payment_link.invoice_id = v_invoice.id");
    expect(rpcFixMigration).toContain("where followup.invoice_id = v_invoice.id");
    expect(rpcFixMigration).toContain("where event.source = 'stripe'");
    expect(rpcFixMigration).not.toMatch(/^create policy/gm);
    const emailMissingMigration = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260619_outbound_email_missing_outcome.sql"),
      "utf8",
    );
    expect(emailMissingMigration).toContain("'email_missing'");
    expect(emailMissingMigration).not.toMatch(/^create policy/gm);
    const finalPresentationMigration = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260623_outbound_final_presentation_hardening.sql"),
      "utf8",
    );
    expect(finalPresentationMigration).toContain("responsible_party_name");
    expect(finalPresentationMigration).toContain("'responsible_party_update_requested'");
    expect(finalPresentationMigration).toContain("'named_contact_requested'");
    expect(finalPresentationMigration).toContain("enable row level security");
    expect(finalPresentationMigration).toContain("revoke all on public.outbound_customers from anon, authenticated");
    expect(finalPresentationMigration).not.toMatch(/^create policy/gm);
    const callbackMigration = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260620_outbound_conversation_callback_upgrade.sql"),
      "utf8",
    );
    expect(callbackMigration).toContain("ai_disclosure_policy");
    expect(callbackMigration).toContain("test_phone_allowlist");
    expect(callbackMigration).toContain("callback_confirmation_text");
    expect(callbackMigration).toContain("'callback_scheduled'");
    expect(callbackMigration).toContain("enable row level security");
    expect(callbackMigration).not.toMatch(/^create policy/gm);
  });

  it("accepts a signed Retell webhook and rejects an invalid signature", async () => {
    process.env.NODE_ENV = "test";
    process.env.RETELL_API_KEY = "retell-route-api-key";
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>(
        "../services/outboundRepository",
      );
      return {
        ...actual,
        findOutboundCallAttempt: vi.fn().mockResolvedValue(null),
        insertOutboundEvent: vi.fn().mockResolvedValue({}),
      };
    });
    vi.resetModules();
    const { createApp } = await import("../app");
    const payload = JSON.stringify({
      event: "call_started",
      call: {
        call_id: "call_outbound_test",
        metadata: {
          business_id: "00000000-0000-4000-8000-000000000001",
          customer_id: "00000000-0000-4000-8000-000000000002",
          invoice_id: "00000000-0000-4000-8000-000000000003",
        },
      },
    });
    const signature = await sign(payload, "retell-route-api-key");
    const accepted = await request(createApp())
      .post("/api/outbound/webhooks/retell")
      .set("content-type", "application/json")
      .set("x-retell-signature", signature)
      .send(payload);
    expect(accepted.status).toBe(200);
    const rejected = await request(createApp())
      .post("/api/outbound/webhooks/retell")
      .set("content-type", "application/json")
      .set("x-retell-signature", "bad")
      .send(payload);
    expect(rejected.status).toBe(401);
  });

  it("accepts signed Retell tool requests with wrapped args and trusted metadata", async () => {
    process.env.NODE_ENV = "test";
    process.env.RETELL_API_KEY = "retell-tool-api-key";
    const recordOutboundOutcome = vi.fn().mockResolvedValue({});
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>(
        "../services/outboundRepository",
      );
      return {
        ...actual,
        getOutboundInvoiceContext: vi.fn().mockResolvedValue({
          invoice: { id: "00000000-0000-4000-8000-000000000003", status: "unpaid" },
          customer: {
            id: "00000000-0000-4000-8000-000000000002",
            outreach_paused: false,
            timezone: "America/New_York",
          },
          business: { id: "00000000-0000-4000-8000-000000000001" },
        }),
        recordOutboundOutcome,
      };
    });
    vi.resetModules();
    const { createApp } = await import("../app");
    const payload = JSON.stringify({
      name: "log_outcome",
      args: {
        outcome: "wrong_number",
        notes: "Caller said this is a wrong number.",
      },
      call: {
        call_id: "call_tool_test",
        metadata: {
          business_id: "00000000-0000-4000-8000-000000000001",
          customer_id: "00000000-0000-4000-8000-000000000002",
          invoice_id: "00000000-0000-4000-8000-000000000003",
          call_attempt_id: "00000000-0000-4000-8000-000000000004",
        },
      },
    });
    const signature = await sign(payload, "retell-tool-api-key");
    const response = await request(createApp())
      .post("/api/outbound/retell/log-outcome")
      .set("content-type", "application/json")
      .set("x-retell-signature", signature)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.outcome).toBe("wrong_number");
    expect(recordOutboundOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        callAttemptId: "00000000-0000-4000-8000-000000000004",
        invoiceId: "00000000-0000-4000-8000-000000000003",
        customerId: "00000000-0000-4000-8000-000000000002",
        outcome: "wrong_number",
      }),
    );
  });

  it("stores responsible-party and named-contact updates from signed wrapped Retell outcome tools", async () => {
    process.env.NODE_ENV = "test";
    process.env.RETELL_API_KEY = "retell-tool-api-key";
    const recordOutboundOutcome = vi.fn().mockResolvedValue({ outreachPaused: false, invoiceStatus: null, followups: [] });
    const updateOutboundCustomer = vi.fn().mockResolvedValue({});
    const insertOutboundFollowups = vi.fn().mockResolvedValue([]);
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>(
        "../services/outboundRepository",
      );
      return {
        ...actual,
        getOutboundInvoiceContext: vi.fn().mockResolvedValue({
          invoice: { id: "00000000-0000-4000-8000-000000000003", status: "unpaid" },
          customer: {
            id: "00000000-0000-4000-8000-000000000002",
            outreach_paused: false,
            timezone: "America/New_York",
          },
          business: { id: "00000000-0000-4000-8000-000000000001" },
        }),
        recordOutboundOutcome,
        updateOutboundCustomer,
        insertOutboundFollowups,
      };
    });
    vi.resetModules();
    const { createApp } = await import("../app");
    const metadata = {
      business_id: "00000000-0000-4000-8000-000000000001",
      customer_id: "00000000-0000-4000-8000-000000000002",
      invoice_id: "00000000-0000-4000-8000-000000000003",
      call_attempt_id: "00000000-0000-4000-8000-000000000004",
    };
    const responsiblePayload = JSON.stringify({
      name: "log_outcome",
      args: {
        outcome: "responsible_party_update_requested",
        responsible_party_name: "Sam Lee",
        responsible_party_phone: "+13475550123",
        responsible_party_email: "sam@example.com",
        notes: "Caller said Sam handles payments now.",
      },
      call: { call_id: "call_responsible_party", metadata },
    });
    const responsibleSignature = await sign(responsiblePayload, "retell-tool-api-key");
    const responsibleResponse = await request(createApp())
      .post("/api/outbound/retell/log-outcome")
      .set("content-type", "application/json")
      .set("x-retell-signature", responsibleSignature)
      .send(responsiblePayload);

    expect(responsibleResponse.status).toBe(200);
    expect(updateOutboundCustomer).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      expect.objectContaining({
        responsible_party_name: "Sam Lee",
        responsible_party_phone: "+13475550123",
        responsible_party_email: "sam@example.com",
        contact_update_note: expect.stringContaining("Sam handles payments"),
      }),
    );
    expect(insertOutboundFollowups).toHaveBeenCalledWith(
      {
        businessId: "00000000-0000-4000-8000-000000000001",
        customerId: "00000000-0000-4000-8000-000000000002",
        invoiceId: "00000000-0000-4000-8000-000000000003",
      },
      expect.arrayContaining([expect.objectContaining({ task_type: "manual_review", reason: "responsible_party_update_requested" })]),
    );

    const namedPayload = JSON.stringify({
      name: "log_outcome",
      args: {
        outcome: "named_contact_requested",
        named_contact_name: "Mike",
        notes: "Caller asked for Mike.",
      },
      call: { call_id: "call_named_contact", metadata },
    });
    const namedSignature = await sign(namedPayload, "retell-tool-api-key");
    const namedResponse = await request(createApp())
      .post("/api/outbound/retell/log-outcome")
      .set("content-type", "application/json")
      .set("x-retell-signature", namedSignature)
      .send(namedPayload);

    expect(namedResponse.status).toBe(200);
    expect(updateOutboundCustomer).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      expect.objectContaining({
        named_contact_requested: "Mike",
        contact_update_note: "Caller asked for Mike.",
      }),
    );
    vi.doUnmock("../services/outboundRepository");
    vi.resetModules();
  });

  it("rejects signed root-only Retell tool args because trusted call metadata is absent", async () => {
    process.env.NODE_ENV = "test";
    process.env.RETELL_API_KEY = "retell-tool-api-key";
    vi.resetModules();
    const { createApp } = await import("../app");
    const payload = JSON.stringify({
      outcome: "wrong_number",
      notes: "Untrusted root-only request.",
    });
    const signature = await sign(payload, "retell-tool-api-key");
    const response = await request(createApp())
      .post("/api/outbound/retell/log-outcome")
      .set("content-type", "application/json")
      .set("x-retell-signature", signature)
      .send(payload);

    expect(response.status).toBe(422);
    const emailPayload = JSON.stringify({ name: "send_payment_email", args: {} });
    const emailSignature = await sign(emailPayload, "retell-tool-api-key");
    const emailResponse = await request(createApp())
      .post("/api/outbound/retell/send-payment-email")
      .set("content-type", "application/json")
      .set("x-retell-signature", emailSignature)
      .send(emailPayload);
    expect(emailResponse.status).toBe(422);
  });

  it("does not create or send a payment email when the trusted customer has no email", async () => {
    process.env.NODE_ENV = "test";
    process.env.RETELL_API_KEY = "retell-email-api-key";
    process.env.EMAIL_PROVIDER = "resend";
    process.env.EMAIL_PROVIDER_API_KEY = "resend-test-key";
    process.env.OUTBOUND_PAYMENT_EMAIL_FROM = "Elixis Elevator Systems <billing@elixis.agency>";
    process.env.OUTBOUND_PAYMENT_EMAIL_ENABLED = "true";
    const insertOutboundEvent = vi.fn().mockResolvedValue({});
    const createOutboundCheckoutSession = vi.fn();
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>(
        "../services/outboundRepository",
      );
      return {
        ...actual,
        getOutboundInvoiceContext: vi.fn().mockResolvedValue({
          invoice: {
            id: "00000000-0000-4000-8000-000000000003",
            invoice_id: "ELV-NO-EMAIL",
            status: "unpaid",
            service_description: "annual elevator inspection",
            amount_due_cents: 15000,
            currency: "usd",
          },
          customer: {
            id: "00000000-0000-4000-8000-000000000002",
            email: "",
            outreach_paused: false,
            timezone: "America/New_York",
          },
          business: {
            id: "00000000-0000-4000-8000-000000000001",
            business_name: "Elixis Elevator Systems",
            callback_number: "+19842075346",
          },
        }),
        hasOutboundPaymentLinkAgreement: vi.fn().mockResolvedValue(true),
        insertOutboundEvent,
      };
    });
    vi.doMock("../services/outboundStripe", () => ({ createOutboundCheckoutSession }));
    vi.resetModules();
    const { createApp } = await import("../app");
    const payload = JSON.stringify({
      name: "send_payment_email",
      args: {},
      call: {
        call_id: "call_email_missing",
        metadata: {
          business_id: "00000000-0000-4000-8000-000000000001",
          customer_id: "00000000-0000-4000-8000-000000000002",
          invoice_id: "00000000-0000-4000-8000-000000000003",
          call_attempt_id: "00000000-0000-4000-8000-000000000004",
        },
      },
    });
    const signature = await sign(payload, "retell-email-api-key");
    const response = await request(createApp())
      .post("/api/outbound/retell/send-payment-email")
      .set("content-type", "application/json")
      .set("x-retell-signature", signature)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ sent: false, status: "email_missing" });
    expect(createOutboundCheckoutSession).not.toHaveBeenCalled();
    expect(insertOutboundEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: "email_missing" }));
    vi.doUnmock("../services/outboundRepository");
    vi.doUnmock("../services/outboundStripe");
    vi.resetModules();
  });

  it("accepts a signed Stripe completion event with exact trusted metadata", async () => {
    process.env.NODE_ENV = "test";
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_route_test";
    const markPaid = vi.fn().mockResolvedValue([{ already_paid: false }]);
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>(
        "../services/outboundRepository",
      );
      return {
        ...actual,
        getOutboundInvoiceForPayment: vi.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000003",
          customer_id: "00000000-0000-4000-8000-000000000002",
          business_id: "00000000-0000-4000-8000-000000000001",
          invoice_id: "INV-ROUTE",
          amount_due_cents: 25000,
          currency: "usd",
        }),
        markOutboundInvoicePaid: markPaid,
      };
    });
    vi.resetModules();
    const { createApp } = await import("../app");
    const event = {
      id: "evt_route_test",
      object: "event",
      api_version: "2026-04-29.preview",
      created: 1,
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_route_test",
          object: "checkout.session",
          amount_total: 25000,
          currency: "usd",
          payment_status: "paid",
          payment_intent: "pi_route_test",
          metadata: {
            internal_invoice_id: "00000000-0000-4000-8000-000000000003",
            customer_id: "00000000-0000-4000-8000-000000000002",
            business_id: "00000000-0000-4000-8000-000000000001",
            invoice_id: "INV-ROUTE",
            business_name: "Demo Elevator Inspections",
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_route_test",
    });
    const response = await request(createApp())
      .post("/api/outbound/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
    expect(response.status).toBe(200);
    expect(markPaid).toHaveBeenCalledWith(expect.objectContaining({ externalEventId: "evt_route_test" }));
  });
});
