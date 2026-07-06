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
          account_company_name: "Test Owner Holdings",
          phone_number: "+13475850249",
          timezone: "America/New_York",
          outreach_paused: false,
        },
        business: {
          id: "00000000-0000-4000-8000-000000000001",
          business_name: "Elixis Elevator Systems",
          default_timezone: "America/New_York",
          ai_disclosure_policy: "on_request",
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
          inspection_type: "Category 1",
          days_after_inspection_first_call: "14",
          very_overdue_threshold_days: "45",
          expected_payment_date_spoken: "",
          original_due_date_spoken: "May twentieth, twenty twenty-six",
          original_due_date_display: "May 20, 2026",
          inspection_date_spoken: "May twentieth, twenty twenty-six",
          inspection_date_display: "May 20, 2026",
          amount_due_spoken: "one hundred fifty dollars",
          invoice_id_spoken: "invoice E-L-V, test",
          open_invoice_count: "1",
          open_invoice_count_spoken: "one open invoice",
          total_amount_due_spoken: "one hundred fifty dollars",
          call_purpose: "first_reminder",
          payment_provider: "stripe",
          quickbooks_connected: "false",
          manual_payment_followup_required: "false",
          ai_disclosure_instruction: expect.stringContaining("Do not mention or volunteer AI status"),
        }),
      }),
    );
    expect(insertOutboundEvent.mock.invocationCallOrder[0]).toBeLessThan(createPhoneCall.mock.invocationCallOrder[0]);
  });

  it("uses a temporary presentation demo number for one manual call without changing invoice status", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_TEST_MODE = "true";
    process.env.OUTBOUND_TEST_PHONE_ALLOWLIST = "+13475850249";
    process.env.OUTBOUND_MAX_BATCH_SIZE = "1";
    process.env.OUTBOUND_RETELL_AGENT_ID = "agent_outbound";
    process.env.RETELL_FROM_NUMBER = "+19842075346";
    const createPhoneCall = vi.fn().mockResolvedValue({ call_id: "call_demo_number", call_status: "registered" });
    const touchOutboundDemoCallAuthorization = vi.fn().mockResolvedValue({});
    const updateOutboundInvoice = vi.fn();
    vi.doMock("../services/outboundRepository", () => ({
      getOutboundInvoiceContext: vi.fn().mockResolvedValue({
        invoice: {
          id: "00000000-0000-4000-8000-000000000003",
          invoice_id: "ELV-DEMO",
          status: "unpaid",
          amount_due_cents: 15000,
          currency: "usd",
          original_due_date: "2026-05-20",
          service_description: "annual elevator inspection",
          inspection_type: "Category 5",
          demo_call_mode: "follow_up",
          previous_call_date: "2026-06-19",
          followup_reason: "customer asked for a later follow-up",
          prior_concern_note: "Customer initially asked if this was legitimate.",
          preferred_payment_method: "email",
        },
        customer: {
          id: "00000000-0000-4000-8000-000000000002",
          first_name: "Test",
          last_name: "Owner",
          account_company_name: "Test Owner Holdings",
          phone_number: "+13475850249",
          preferred_phone_number: "+15551234567",
          email: "owner@example.test",
          preferred_email: "billing@example.test",
          timezone: "America/New_York",
          outreach_paused: false,
        },
        business: {
          id: "00000000-0000-4000-8000-000000000001",
          business_name: "Hudson Lift Services",
          business_name_spoken: "Hudson Lift Services",
          agent_display_name: "Paul",
          product_type: "elevator_inspection",
          days_after_inspection_first_call: 14,
          very_overdue_threshold_days: 45,
          default_timezone: "America/New_York",
          ai_disclosure_policy: "on_request",
        },
        activeCall: null,
        paymentLink: null,
      }),
      getOutboundDemoCallAuthorization: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000099",
        business_id: "00000000-0000-4000-8000-000000000001",
        phone_number: "+15551234567",
        demo_call_mode: "follow_up",
        expires_at: "2026-06-30T00:00:00.000Z",
        revoked_at: null,
      }),
      touchOutboundDemoCallAuthorization,
      nextOutboundAttemptNumber: vi.fn().mockResolvedValue(3),
      createOutboundCallAttempt: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000004" }),
      updateOutboundCallAttempt: vi.fn().mockResolvedValue({}),
      insertOutboundEvent: vi.fn().mockResolvedValue({}),
      updateOutboundInvoice,
    }));
    vi.doMock("../retell/retellClient", () => ({
      getRetellClient: () => ({ call: { createPhoneCall } }),
    }));
    vi.resetModules();
    const { startOutboundCall } = await import("../services/outboundCalls");
    const result = await startOutboundCall(
      "00000000-0000-4000-8000-000000000003",
      undefined,
      new Date("2026-06-22T15:00:00.000Z"),
      undefined,
      "00000000-0000-4000-8000-000000000099",
    );

    expect(result.call_id).toBe("call_demo_number");
    expect(createPhoneCall).toHaveBeenCalledWith(
      expect.objectContaining({
        to_number: "+15551234567",
        retell_llm_dynamic_variables: expect.objectContaining({
          business_name: "Hudson Lift Services",
          agent_display_name: "Paul",
          inspection_type: "Category 5",
          days_after_inspection_first_call: "14",
          very_overdue_threshold_days: "45",
          call_purpose: "follow_up",
          demo_call_mode: "follow_up",
          customer_first_name_spoken: "Test",
          customer_last_name_spoken: "Owner",
          customer_phone_spoken: "five five five, one two three, four five six seven",
          customer_phone_spoken_chunked: "area code five five five, then one two three, then four five six seven",
          account_company_name: "Test Owner Holdings",
          account_company_name_spoken: "Test Owner Holdings",
          customer_email: "billing@example.test",
          customer_email_spoken: "billing at example dot test",
          customer_email_spoken_slow: "b i l l i n g, at example, dot test",
          customer_email_spoken_phonetic:
            "b as in Bravo, i as in India, l as in Lima, l as in Lima, i as in India, n as in November, g as in Golf, at example dot test",
          customer_email_display: "billing@example.test",
          original_due_date_spoken: "May twentieth, twenty twenty-six",
          inspection_date_spoken: "May twentieth, twenty twenty-six",
          previous_call_date_spoken: "June nineteenth, twenty twenty-six",
          followup_reason: "customer asked for a later follow-up",
          prior_concern_note: "Customer initially asked if this was legitimate.",
          preferred_payment_method: "email",
          ai_disclosure_policy: "on_request",
          ai_disclosure_instruction: expect.stringContaining("Do not mention or volunteer AI status"),
        }),
      }),
    );
    expect(touchOutboundDemoCallAuthorization).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000099");
    expect(updateOutboundInvoice).not.toHaveBeenCalled();
  });
});
