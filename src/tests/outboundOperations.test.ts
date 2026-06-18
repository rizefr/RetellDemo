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
});
