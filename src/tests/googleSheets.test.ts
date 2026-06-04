import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { sign } from "retell-sdk";

const sampleAnalyzedPayload = {
  event: "call_analyzed",
  call: {
    call_id: "call_sheet_1",
    agent_id: "agent_16b324c0e55f21c0a5f914c169",
    agent_version: 12,
    direction: "inbound",
    from_number: "+17185550100",
    call_analysis: {
      user_sentiment: "positive",
      custom_analysis_data: {
        caller_name: "Maria",
        alternate_phone: "+19175550123",
        pest_issue: "ants in kitchen",
        property_address: "25 Pine Street, Brooklyn, NY 11201",
        service_area_or_zip: "11201",
        urgency_level: "low",
        booking_method: "phone_booking",
        appointment_requested: true,
        preferred_datetime: "2026-06-05T09:00:00-04:00",
        calcom_booking_id: "cal_test",
        calcom_booking_status: "confirmed",
        sms_sent: false,
        sms_simulated: true,
        transfer_requested: false,
        call_outcome: "real_appointment_booked",
        lead_quality_score: "5",
        call_summary: "Caller booked ant service.",
      },
    },
    transcript: "short transcript",
  },
};

describe("Google Sheets call log mirror", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("maps Retell analysis payloads to the configured call-log columns", async () => {
    vi.resetModules();
    const { buildCallLogRow, callLogColumns } = await import("../services/googleSheets");
    const row = buildCallLogRow(sampleAnalyzedPayload);

    expect(row).toHaveLength(callLogColumns.length);
    expect(row[1]).toBe("call_sheet_1");
    expect(row[2]).toBe("agent_16b324c0e55f21c0a5f914c169");
    expect(row[5]).toBe("+17185550100");
    expect(row[6]).toBe("Maria");
    expect(row[8]).toBe("ants in kitchen");
    expect(row[9]).toBe("25 Pine Street, Brooklyn, NY 11201");
    expect(row[15]).toBe("cal_test");
    expect(row[18]).toBe("true");
    expect(row[24]).toBe("Caller booked ant service.");
  });

  it("skips safely when Sheets is enabled but credentials are missing", async () => {
    vi.resetModules();
    process.env.GOOGLE_SHEETS_ENABLED = "true";
    process.env.GOOGLE_SHEET_ID = "";
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL = "";
    process.env.GOOGLE_SHEETS_PRIVATE_KEY = "";
    process.env.GOOGLE_SHEETS_WEBHOOK_URL = "";
    const { appendCallSummaryToGoogleSheets } = await import("../services/googleSheets");

    const result = await appendCallSummaryToGoogleSheets(sampleAnalyzedPayload);
    expect(result.appended).toBe(false);
    expect(result.skipped_reason).toBe("missing_credentials");
  });

  it("appends through an Apps Script webhook when configured", async () => {
    vi.resetModules();
    process.env.GOOGLE_SHEETS_ENABLED = "true";
    process.env.GOOGLE_SHEET_ID = "sheet_123";
    process.env.GOOGLE_SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/test/exec";
    process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = "secret";
    const { appendCallSummaryToGoogleSheets } = await import("../services/googleSheets");
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await appendCallSummaryToGoogleSheets(sampleAnalyzedPayload, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.appended).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://script.google.com/macros/s/test/exec",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-sheets-webhook-secret": "secret",
        }),
      }),
    );
  });

  it("keeps webhook success when the Sheets append fails", async () => {
    vi.resetModules();
    process.env.RETELL_WEBHOOK_SECRET_OR_API_KEY = "test_secret";
    process.env.ALLOW_UNVERIFIED_WEBHOOKS = "false";
    process.env.GOOGLE_SHEETS_ENABLED = "true";
    process.env.GOOGLE_SHEET_ID = "sheet_123";
    process.env.GOOGLE_SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/test/exec";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sheet unavailable")));
    const { createApp } = await import("../app");
    const rawBody = JSON.stringify(sampleAnalyzedPayload);
    const signature = await sign(rawBody, "test_secret");

    const response = await request(createApp())
      .post("/retell/webhook")
      .set("Content-Type", "application/json")
      .set("X-Retell-Signature", signature)
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
    vi.unstubAllGlobals();
  });
});
