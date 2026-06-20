import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { sign } from "retell-sdk";

describe("outbound upgrade routes", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("../services/outboundRepository");
  });

  it("serves protected customer and business CSV templates", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "upgrade-admin";
    vi.resetModules();
    const { createApp } = await import("../app");
    const customer = await request(createApp())
      .get("/api/outbound/templates/customers.csv")
      .set("Authorization", "Bearer upgrade-admin");
    const business = await request(createApp())
      .get("/api/outbound/templates/business.csv")
      .set("Authorization", "Bearer upgrade-admin");
    expect(customer.status).toBe(200);
    expect(customer.headers["content-disposition"]).toContain("outbound-customer-invoices-template.csv");
    expect(customer.text).toContain("callback_preferred_time");
    expect(business.status).toBe(200);
    expect(business.text).toContain("ai_disclosure_policy");
  });

  it("requires the production-mode confirmation and redacts provider secrets from settings responses", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "upgrade-admin";
    process.env.EMAIL_PROVIDER = "resend";
    process.env.EMAIL_PROVIDER_API_KEY = "secret-provider-key";
    process.env.OUTBOUND_PAYMENT_EMAIL_ENABLED = "true";
    process.env.OUTBOUND_PAYMENT_EMAIL_FROM = "Elixis Elevator Systems <billing@elixis.agency>";
    const update = vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      business_name: "Elixis Elevator Systems",
      test_mode: false,
      email_from: "Elixis Elevator Systems <billing@elixis.agency>",
      payment_email_enabled: false,
    });
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>("../services/outboundRepository");
      return {
        ...actual,
        getOutboundBusinessSettings: vi.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000001",
          business_name: "Elixis Elevator Systems",
          test_mode: true,
          test_phone_allowlist: ["+13475850249"],
          max_batch_size: 1,
          payment_email_enabled: false,
          email_from: "Elixis Elevator Systems <billing@elixis.agency>",
        }),
        updateOutboundBusinessSettings: update,
        insertOutboundEvent: vi.fn().mockResolvedValue({}),
      };
    });
    vi.resetModules();
    const { createApp } = await import("../app");
    const rejected = await request(createApp())
      .patch("/api/outbound/businesses/00000000-0000-4000-8000-000000000001/settings")
      .set("Authorization", "Bearer upgrade-admin")
      .send({ test_mode: false });
    expect(rejected.status).toBe(400);
    const accepted = await request(createApp())
      .patch("/api/outbound/businesses/00000000-0000-4000-8000-000000000001/settings")
      .set("Authorization", "Bearer upgrade-admin")
      .send({ test_mode: false, production_mode_confirmation: "ENABLE PRODUCTION OUTBOUND MODE" });
    expect(accepted.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.any(String), { test_mode: false });
    expect(JSON.stringify(accepted.body)).not.toContain("secret-provider-key");
  });

  it("proposes then stores a signed callback using trusted call metadata", async () => {
    process.env.NODE_ENV = "test";
    process.env.RETELL_API_KEY = "callback-signing-key";
    const createOutboundCallbackTask = vi.fn().mockResolvedValue({ id: "callback-task-1" });
    const recordOutboundOutcome = vi.fn().mockResolvedValue({});
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>("../services/outboundRepository");
      return {
        ...actual,
        getOutboundInvoiceContext: vi.fn().mockResolvedValue({
          invoice: { id: "00000000-0000-4000-8000-000000000003", status: "unpaid" },
          customer: { id: "00000000-0000-4000-8000-000000000002", timezone: "America/New_York", outreach_paused: false },
          business: { id: "00000000-0000-4000-8000-000000000001", default_timezone: "America/New_York" },
        }),
        createOutboundCallbackTask,
        recordOutboundOutcome,
        insertOutboundEvent: vi.fn().mockResolvedValue({}),
      };
    });
    vi.resetModules();
    const { createApp } = await import("../app");
    const body = (confirmed: boolean) => JSON.stringify({
      name: "schedule_callback",
      args: {
        date_phrase: "tomorrow",
        time_phrase: "afternoon",
        reason: "customer requested a later call",
        confirmation_text: confirmed ? "Callback tomorrow at 2 PM confirmed." : "",
        confirmed,
      },
      call: {
        call_id: "call-callback-1",
        start_timestamp: Date.parse("2026-06-22T15:00:00.000Z"),
        metadata: {
          business_id: "00000000-0000-4000-8000-000000000001",
          customer_id: "00000000-0000-4000-8000-000000000002",
          invoice_id: "00000000-0000-4000-8000-000000000003",
          call_attempt_id: "00000000-0000-4000-8000-000000000004",
        },
      },
    });
    const proposalBody = body(false);
    const proposal = await request(createApp())
      .post("/api/outbound/retell/schedule-callback")
      .set("content-type", "application/json")
      .set("x-retell-signature", await sign(proposalBody, "callback-signing-key"))
      .send(proposalBody);
    expect(proposal.status).toBe(200);
    expect(proposal.body).toMatchObject({ scheduled: false, needs_confirmation: true });
    expect(createOutboundCallbackTask).not.toHaveBeenCalled();

    const confirmedBody = body(true);
    const confirmed = await request(createApp())
      .post("/api/outbound/retell/schedule-callback")
      .set("content-type", "application/json")
      .set("x-retell-signature", await sign(confirmedBody, "callback-signing-key"))
      .send(confirmedBody);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ scheduled: true, needs_confirmation: false });
    expect(createOutboundCallbackTask).toHaveBeenCalledTimes(1);
    expect(recordOutboundOutcome).toHaveBeenCalledWith(expect.objectContaining({ outcome: "callback_scheduled" }));
  });
});

describe("callback repository idempotency", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns an existing callback task when Retell retries the confirmed tool", async () => {
    const existingTask = { id: "callback-task-existing", task_type: "callback" };
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existingTask, error: null }),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };
    vi.doMock("../services/supabase", () => ({
      getSupabaseClient: () => ({ from: vi.fn().mockReturnValue(builder) }),
    }));
    const { createOutboundCallbackTask } = await import("../services/outboundRepository");

    const result = await createOutboundCallbackTask({
      businessId: "00000000-0000-4000-8000-000000000001",
      customerId: "00000000-0000-4000-8000-000000000002",
      invoiceId: "00000000-0000-4000-8000-000000000003",
      scheduledFor: "2026-06-23T18:00:00.000Z",
      timezone: "America/New_York",
      reason: "customer requested a later call",
      confirmationText: "Callback Tuesday at 2 PM confirmed.",
    });

    expect(result).toEqual(existingTask);
    expect(builder.insert).not.toHaveBeenCalled();
  });
});
