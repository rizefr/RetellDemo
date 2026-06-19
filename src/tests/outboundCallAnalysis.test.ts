import { describe, expect, it } from "vitest";
import {
  buildOutboundCallAnalysis,
  buildOutboundCallAttemptPatch,
  redactOutboundEventPayload,
} from "../services/outboundCallAnalysis";

const explicitPaymentRequestCall = {
  call_id: "call_test",
  call_status: "ended",
  duration_ms: 76877,
  transcript:
    "Agent: Am I speaking with Test?\nUser: Yes. This is Test.\nAgent: Would you like a secure payment link?\nUser: Yes, please.",
  call_analysis: {
    call_summary:
      "The customer confirmed their identity and requested a secure payment link for the annual elevator inspection invoice.",
    custom_analysis_data: {
      identity_confirmed: true,
      payment_link_requested: true,
      delivery_preference: "none",
      human_requested: false,
      objection_type: "none",
      next_action: "prepare_payment_link",
    },
  },
  transcript_with_tool_calls: [
    {
      role: "tool_call_invocation",
      name: "log_outcome",
      arguments:
        '{"outcome":"confirmed_payment_link_requested","notes":"Caller requested the secure link."}',
      tool_call_id: "tool_1",
    },
    {
      role: "tool_call_result",
      tool_call_id: "tool_1",
      successful: false,
      content: "Axios Error: Request failed with status code 400",
    },
    { role: "tool_call_invocation", name: "end_call", arguments: "{}", tool_call_id: "tool_2" },
  ],
};

describe("outbound call analysis", () => {
  it("prefers Retell's summary and recovers only explicit logged outcomes", () => {
    const result = buildOutboundCallAnalysis(explicitPaymentRequestCall, {
      serviceDescription: "annual elevator inspection",
      invoiceNumber: "ELV-TEST-OWN-NUMBER",
    });

    expect(result.summary).toContain("requested a secure payment link");
    expect(result.outcome).toBe("confirmed_payment_link_requested");
    expect(result.analysis).toMatchObject({
      identity_confirmed: true,
      payment_link_requested: true,
      payment_link_created: false,
      email_requested: false,
      sms_requested: false,
      human_requested: false,
      next_action: "prepare_payment_link",
    });
    expect(result.analysis.tools_invoked).toEqual([
      { name: "log_outcome", successful: false },
      { name: "end_call", successful: null },
    ]);
    expect(result.analysis.tool_errors).toEqual([
      {
        name: "log_outcome",
        code: "http_400",
        message: "Request failed with status code 400",
      },
    ]);
  });

  it("uses a factual deterministic fallback and never invents an outcome", () => {
    const result = buildOutboundCallAnalysis(
      {
        call_id: "call_no_analysis",
        transcript: "Agent: Hello.\nUser: Goodbye.",
        transcript_with_tool_calls: [],
      },
      { serviceDescription: "annual elevator inspection", invoiceNumber: "INV-1" },
    );

    expect(result.summary).toBe("No clear summary available from transcript.");
    expect(result.outcome).toBeNull();
    expect(result.analysis.identity_confirmed).toBeNull();
  });

  it("does not let later call_ended payloads erase analyzed fields", () => {
    const analyzedPatch = buildOutboundCallAttemptPatch(explicitPaymentRequestCall, {
      serviceDescription: "annual elevator inspection",
      invoiceNumber: "INV-1",
    });
    const endedPatch = buildOutboundCallAttemptPatch(
      { call_id: "call_test", call_status: "ended", end_timestamp: 1781889818727 },
      { serviceDescription: "annual elevator inspection", invoiceNumber: "INV-1" },
    );

    expect(analyzedPatch.summary).toBeTruthy();
    expect(analyzedPatch.analysis).toBeTruthy();
    expect(endedPatch).not.toHaveProperty("summary");
    expect(endedPatch).not.toHaveProperty("analysis");
    expect(endedPatch.status).toBe("ended");
  });

  it("redacts secret-like event fields while retaining useful debug context", () => {
    expect(
      redactOutboundEventPayload({
        event: "call_analyzed",
        authorization: "Bearer secret",
        call: {
          call_id: "call_1",
          access_token: "secret-token",
          metadata: { invoice_id: "invoice-row" },
        },
      }),
    ).toEqual({
      event: "call_analyzed",
      authorization: "[REDACTED]",
      call: {
        call_id: "call_1",
        access_token: "[REDACTED]",
        metadata: { invoice_id: "invoice-row" },
      },
    });
  });
});
