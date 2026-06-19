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
