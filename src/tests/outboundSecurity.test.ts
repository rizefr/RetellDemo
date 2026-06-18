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
    expect(flow.nodes).toHaveLength(1);
    expect(serialized).toContain('"type":"subagent"');
    expect(serialized).toContain('"tool_ids"');
    expect(serialized).toContain("Do not leave voicemail");
    expect(serialized).toContain("Do not accept card details verbally");
    expect(serialized).toContain("Never collect card details verbally");
    expect(serialized).toContain('"args_at_root":true');
    expect(serialized).toContain('"type":"end_call"');
    expect(serialized).toContain('"type":"transfer_call"');
    expect(serialized).toContain('"tool_id":"outbound_log_outcome"');
    expect(serialized).toContain('"tool_id":"outbound_create_payment_link"');
    expect(serialized).toContain('"tool_id":"outbound_send_payment_sms"');
    expect(serialized).toContain('"tool_id":"outbound_request_human_transfer"');
    expect(serialized).toContain('"tool_id":"outbound_schedule_followup"');
    expect(serialized).toContain("confirmed_payment_link_requested");
    expect(serialized).toContain("sms_pending_manual");
    expect(serialized).toContain("Elixis Elevator Systems");
    expect(serialized).toContain("about an open invoice");
    expect(serialized).toContain("If the person says \\\"hello\\\"");
    expect(serialized).toContain("This is for the {{service_description}} invoice dated {{original_due_date}}");
    expect(serialized).toContain("The team will follow up with the secure link");
    expect(serialized).toContain("Neutral close without payment-link agreement");
    expect(serialized).toContain("do not ask again");
    expect(serialized).toContain("invoke end_call immediately in the same turn");
    expect(serialized).not.toContain("Demo Elevator Inspections");
    expect(serialized).toContain("tool_call_invocation");
    expect(serialized).not.toContain("phoneNumber.update");
    expect(setupScript).not.toMatch(/\.phoneNumber\.update\s*\(/);
    expect(setupScript).toContain('voice_model: "eleven_flash_v2_5"');
    expect(setupScript).toContain("begin_message_delay_ms: 250");
  });
});
