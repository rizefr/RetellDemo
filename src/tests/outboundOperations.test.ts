import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

describe("outbound browser operation safety", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("../services/outboundCalls");
    vi.doUnmock("../services/outboundRepository");
    vi.doUnmock("../retell/retellClient");
  });

  it("returns a blocked single-call preflight without placing a call", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "operations-admin";
    const startOutboundCall = vi.fn();
    vi.doMock("../services/outboundCalls", () => ({
      inspectOutboundCallEligibility: vi.fn().mockResolvedValue({
        eligible: false,
        reason: "outside_calling_window",
        context: {
          invoice: { id: "00000000-0000-4000-8000-000000000003", status: "unpaid" },
          customer: {
            id: "00000000-0000-4000-8000-000000000002",
            first_name: "Test",
            last_name: "Owner",
            phone_number: "+12025550199",
            timezone: "America/Los_Angeles",
            outreach_paused: false,
          },
          business: { id: "00000000-0000-4000-8000-000000000001" },
          activeCall: null,
          paymentLink: null,
        },
      }),
      startOutboundCall,
      outboundAllowlist: () => ["+12025550199"],
      describeOutboundCallPreflight: vi.fn().mockResolvedValue({
        eligible: false,
        reason: "outside_calling_window",
        timezone: "America/Los_Angeles",
        recipient_local_time: "2026-06-12T08:00:00.000-07:00",
        within_calling_window: false,
        test_mode: true,
        allowlisted: true,
      }),
    }));
    vi.resetModules();
    const { createApp } = await import("../app");

    const response = await request(createApp())
      .post("/api/outbound/calls/dry-run")
      .set("Authorization", "Bearer operations-admin")
      .send({ invoice_id: "00000000-0000-4000-8000-000000000003" });

    expect(response.status).toBe(200);
    expect(response.body.eligible).toBe(false);
    expect(response.body.reason).toBe("outside_calling_window");
    expect(startOutboundCall).not.toHaveBeenCalled();
  });

  it("never calls Retell when batch mode is dry_run", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "operations-admin";
    process.env.OUTBOUND_TEST_MODE = "true";
    const startOutboundCall = vi.fn();
    vi.doMock("../services/outboundCalls", () => ({
      inspectOutboundCallEligibility: vi.fn().mockResolvedValue({
        eligible: true,
        reason: "eligible",
        context: {
          invoice: { id: "00000000-0000-4000-8000-000000000003" },
          customer: { id: "00000000-0000-4000-8000-000000000002" },
          business: { id: "00000000-0000-4000-8000-000000000001" },
        },
      }),
      startOutboundCall,
      outboundAllowlist: () => ["+12025550199"],
      describeOutboundCallPreflight: vi.fn(),
    }));
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>(
        "../services/outboundRepository",
      );
      return { ...actual, insertOutboundEvent: vi.fn().mockResolvedValue({}) };
    });
    vi.resetModules();
    const { createApp } = await import("../app");

    const response = await request(createApp())
      .post("/api/outbound/calls/start-batch")
      .set("Authorization", "Bearer operations-admin")
      .send({
        mode: "dry_run",
        invoice_ids: ["00000000-0000-4000-8000-000000000003"],
      });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("dry_run");
    expect(response.body.results[0].called).toBe(false);
    expect(startOutboundCall).not.toHaveBeenCalled();
  });

  it("rejects after-hours override fields on every batch request", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "operations-admin";
    process.env.OUTBOUND_TEST_MODE = "true";
    process.env.OUTBOUND_MAX_BATCH_SIZE = "1";
    vi.resetModules();
    const { createApp } = await import("../app");
    const response = await request(createApp())
      .post("/api/outbound/calls/start-batch")
      .set("Authorization", "Bearer operations-admin")
      .send({
        mode: "dry_run",
        invoice_ids: ["00000000-0000-4000-8000-000000000003"],
        after_hours_override: {
          acknowledged: true,
          confirmation: "I UNDERSTAND THIS IS AN AFTER-HOURS TEST",
          reason: "self_test",
        },
      });

    expect(response.status).toBe(400);
  });

  it("logs a fully gated after-hours self-test override before placing one call", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_TEST_MODE = "true";
    process.env.OUTBOUND_TEST_PHONE_ALLOWLIST = "+13475850249";
    process.env.OUTBOUND_MAX_BATCH_SIZE = "1";
    process.env.OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE = "true";
    process.env.OUTBOUND_RETELL_AGENT_ID = "agent_outbound";
    process.env.RETELL_FROM_NUMBER = "+19842075346";
    const insertOutboundEvent = vi.fn().mockResolvedValue({});
    const createPhoneCall = vi.fn().mockResolvedValue({ call_id: "call_after_hours", call_status: "registered" });
    vi.doMock("../services/outboundRepository", () => ({
      getOutboundInvoiceContext: vi.fn().mockResolvedValue({
        invoice: {
          id: "00000000-0000-4000-8000-000000000003",
          invoice_id: "ELV-TEST",
          status: "unpaid",
          amount_due_cents: 15000,
          currency: "usd",
          original_due_date: "2026-05-20",
          service_description: "annual elevator inspection",
        },
        customer: {
          id: "00000000-0000-4000-8000-000000000002",
          first_name: "Test",
          last_name: "Owner",
          phone_number: "+13475850249",
          timezone: "America/New_York",
          outreach_paused: false,
        },
        business: {
          id: "00000000-0000-4000-8000-000000000001",
          business_name: "Elixis Elevator Systems",
          default_timezone: "America/New_York",
        },
        activeCall: null,
        paymentLink: null,
      }),
      nextOutboundAttemptNumber: vi.fn().mockResolvedValue(2),
      createOutboundCallAttempt: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000004" }),
      updateOutboundCallAttempt: vi.fn().mockResolvedValue({}),
      insertOutboundEvent,
    }));
    vi.doMock("../retell/retellClient", () => ({
      getRetellClient: () => ({ call: { createPhoneCall } }),
    }));
    vi.resetModules();
    const { startOutboundCall } = await import("../services/outboundCalls");
    const result = await startOutboundCall(
      "00000000-0000-4000-8000-000000000003",
      {
        acknowledged: true,
        confirmation: "I UNDERSTAND THIS IS AN AFTER-HOURS TEST",
        reason: "self_test",
      },
      new Date("2026-06-21T02:00:00.000Z"),
    );

    expect(result.after_hours_override_used).toBe(true);
    expect(insertOutboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "after_hours_test_override_authorized", source: "admin" }),
    );
    expect(createPhoneCall).toHaveBeenCalledTimes(1);
    expect(createPhoneCall).toHaveBeenCalledWith(
      expect.objectContaining({
        retell_llm_dynamic_variables: expect.objectContaining({
          agent_display_name: "Paul",
          original_due_date_spoken: "May 20, 2026",
          open_invoice_count: "1",
        }),
      }),
    );
    expect(insertOutboundEvent.mock.invocationCallOrder[0]).toBeLessThan(createPhoneCall.mock.invocationCallOrder[0]);
  });
});
