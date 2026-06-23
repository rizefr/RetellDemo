import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sign } from "retell-sdk";
import {
  createOutboundAdminCookie,
  isAuthorizedOutboundAdmin,
  verifyOutboundAdminCookie,
} from "../services/outboundAuth";
import { parseCompletedCheckoutSession } from "../services/outboundStripe";
import { verifyOutboundRetellSignature } from "../services/outboundRetell";
import { buildOutboundConversationFlow } from "../retell/outboundConversationFlow";

describe("outbound admin authorization", () => {
  it("supports bearer auth without exposing the token in a URL", () => {
    expect(isAuthorizedOutboundAdmin({ authorization: "Bearer test-admin", cookie: "" }, "test-admin")).toBe(true);
    expect(isAuthorizedOutboundAdmin({ authorization: "Bearer wrong", cookie: "" }, "test-admin")).toBe(false);
  });

  it("uses HttpOnly SameSite cookies and only requires Secure in production", () => {
    const local = createOutboundAdminCookie("test-admin", new Date("2026-06-09T00:00:00Z"), false);
    const production = createOutboundAdminCookie("test-admin", new Date("2026-06-09T00:00:00Z"), true);
    expect(local).toContain("HttpOnly");
    expect(local).toContain("SameSite=Strict");
    expect(local).not.toContain("Secure");
    expect(production).toContain("Secure");
    expect(verifyOutboundAdminCookie(local.split(";")[0].split("=")[1], "test-admin", new Date("2026-06-09T01:00:00Z"))).toBe(
      true,
    );
  });
});

describe("provider webhook security", () => {
  it("verifies Retell signatures using the installed provider SDK", async () => {
    const body = JSON.stringify({ event: "call_started", call: { call_id: "call_1" } });
    const signature = await sign(body, "retell-api-key-secret");
    await expect(verifyOutboundRetellSignature(body, signature, "retell-api-key-secret")).resolves.toBe(true);
    await expect(verifyOutboundRetellSignature(body, "bad", "retell-api-key-secret")).resolves.toBe(false);
    const fallbackSignature = await sign(body, "legacy-outbound-secret");
    await expect(
      verifyOutboundRetellSignature(body, fallbackSignature, "", "legacy-outbound-secret"),
    ).resolves.toBe(true);
  });

  it("rejects Stripe completion payloads whose trusted metadata or amount do not map", () => {
    const valid = {
      id: "cs_test_1",
      amount_total: 10000,
      currency: "usd",
      payment_status: "paid",
      payment_intent: "pi_test_1",
      metadata: {
        internal_invoice_id: "00000000-0000-4000-8000-000000000001",
        invoice_id: "INV-1",
        customer_id: "00000000-0000-4000-8000-000000000002",
        business_id: "00000000-0000-4000-8000-000000000003",
        business_name: "Demo Elevator Inspections",
      },
    };
    expect(parseCompletedCheckoutSession(valid, { amount_due_cents: 10000, currency: "usd" }).ok).toBe(true);
    expect(parseCompletedCheckoutSession({ ...valid, amount_total: 9999 }, { amount_due_cents: 10000, currency: "usd" }).ok).toBe(
      false,
    );
    expect(
      parseCompletedCheckoutSession({ ...valid, metadata: {} }, { amount_due_cents: 10000, currency: "usd" }).ok,
    ).toBe(false);
  });
});

describe("outbound flow guardrails", () => {
  it("uses a tool-capable subagent with required safety rules without phone binding operations", () => {
    const serialized = JSON.stringify(buildOutboundConversationFlow("https://example.com"));
    const setupScript = fs.readFileSync(
      path.resolve(process.cwd(), "src/scripts/setupOutboundRetell.ts"),
      "utf8",
    );
    const flow = buildOutboundConversationFlow("https://example.com");
    expect(flow.start_node_id).toBe("outbound_collections_agent");
    expect(flow.nodes).toHaveLength(2);
    expect(serialized).toContain('"type":"subagent"');
    expect(serialized).toContain('"tool_ids"');
    expect(serialized).toContain("Do not leave voicemail");
    expect(serialized).toContain("Do not accept card details verbally");
    expect(serialized).toContain("Never collect card details verbally");
    expect(serialized).not.toContain('"args_at_root":true');
    expect(serialized).toContain('"type":"end_call"');
    expect(serialized).toContain('"type":"transfer_call"');
    expect(serialized).toContain('"tool_id":"outbound_log_outcome"');
    expect(serialized).toContain('"tool_id":"outbound_create_payment_link"');
    expect(serialized).toContain('"tool_id":"outbound_send_payment_sms"');
    expect(serialized).toContain('"tool_id":"outbound_send_payment_email"');
    expect(serialized).toContain('"tool_id":"outbound_request_human_transfer"');
    expect(serialized).toContain('"tool_id":"outbound_schedule_followup"');
    expect(serialized).toContain('"tool_id":"outbound_schedule_callback"');
    expect(serialized).toContain("confirmed_payment_link_requested");
    expect(serialized).toContain("sms_pending_manual");
    expect(serialized).toContain("email_pending_manual");
    expect(serialized).toContain("email_missing");
    expect(serialized).toContain("Elixis Elevator Systems");
    expect(serialized).toContain("Hi, my name is Paul");
    expect(serialized).toContain("make sure your elevators are operating properly");
    expect(serialized).not.toContain("Hi, this is calling on behalf of Elixis Elevator Systems about an open invoice");
    expect(serialized).not.toContain("Thanks. I'm an AI voice assistant helping Elixis Elevator Systems");
    expect(serialized).toContain("ai_disclosure_policy");
    expect(serialized).toContain("Disclosure instruction for this call");
    expect(serialized).toContain("Do not infer or apply a different disclosure policy");
    expect(serialized).toContain("service_issue_reported");
    expect(serialized).toContain("mail_instructions_requested");
    expect(serialized).toContain('"id":"service_issue_logging_example"');
    expect(serialized).toContain('"id":"callback_propose_then_confirm_example"');
    expect(serialized).toContain('"id":"mail_check_missing_instructions_example"');
    expect(serialized).toContain('"id":"do_not_contact_terminal_example"');
    expect(serialized).toContain('"id":"email_sent_terminal_example"');
    expect(serialized).toContain('"id":"human_unavailable_terminal_example"');
    expect(serialized).toContain("your next action must be the schedule_callback tool");
    expect(serialized).toContain('"id":"outbound_terminal_end"');
    expect(serialized).toContain("all required custom tool calls for the terminal outcome are complete");
    expect(serialized).toContain("When sent is true, confirm delivery once and immediately invoke end_call");
    expect(serialized).toContain("If the person says \\\"hello\\\"");
    expect(serialized).toContain("State the service, natural due date, and selected balance before any payment tool");
    expect(serialized).toContain("amount_due_spoken");
    expect(serialized).toContain("total_amount_due_spoken");
    expect(serialized).toContain("invoice_id_spoken");
    expect(serialized).toContain("open_invoice_count_spoken");
    expect(serialized).toContain("I'm a virtual assistant helping Elixis Elevator Systems follow up on service accounts");
    expect(serialized).toContain("I'm following up at the time you requested about your elevator service account");
    expect(serialized).toContain("Do not direct them to make an inbound call");
    expect(serialized).not.toMatch(/call us back later|please call the office/i);
    expect(serialized).toContain("Payment provider: {{payment_provider}}");
    expect(serialized).toContain("QuickBooks connected: {{quickbooks_connected}}");
    expect(serialized).toContain("Only call a link a QuickBooks payment link when the backend returns a real connected-provider link");
    expect(serialized).toContain('"id":"same_turn_payment_request_example"');
    expect(serialized).toContain("The team will follow up with the secure link");
    expect(serialized).toContain("invoke end_call immediately in the same turn");
    expect(serialized).not.toContain("Demo Elevator Inspections");
    expect(serialized).toContain("tool_call_invocation");
    expect(serialized).not.toContain("phoneNumber.update");
    expect(setupScript).not.toMatch(/\.phoneNumber\.update\s*\(/);
    expect(setupScript).toContain('voice_model: "eleven_flash_v2_5"');
    expect(setupScript).toContain("voice_speed: 0.88");
    expect(setupScript).toContain("begin_message_delay_ms: 650");
  });
});
