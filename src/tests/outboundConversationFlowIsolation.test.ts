import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoCallRunSchema, startCallSchema } from "../schemas/outboundSchemas";
import { trustedRetellMetadata } from "../services/outboundRetell";

const invoiceId = "00000000-0000-4000-8000-000000000003";
const authorizationId = "00000000-0000-4000-8000-000000000099";

describe("outbound Conversation Flow isolation", () => {
  it("rejects agent selection fields on every production call request", () => {
    expect(demoCallRunSchema.safeParse({
      invoice_id: invoiceId,
      demo_call_authorization_id: authorizationId,
      agent_variant: "single_prompt",
    }).success).toBe(false);
    expect(startCallSchema.safeParse({
      invoice_id: invoiceId,
      agent_variant: "single_prompt",
    }).success).toBe(false);
  });

  it("does not expose the Single Prompt agent on the outbound production surface", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "web/outbound.html"), "utf8");
    const javascript = fs.readFileSync(path.resolve(process.cwd(), "public/outbound/outbound.js"), "utf8");
    const runtimeSources = [
      "src/routes/outboundApi.ts",
      "src/services/outboundCalls.ts",
      "src/services/outboundSetup.ts",
    ].map((file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8")).join("\n");

    expect(html).not.toContain("demo-agent-variant");
    expect(html).not.toContain("Single Prompt comparison");
    expect(javascript).not.toContain("single_prompt");
    expect(javascript).not.toContain("agent_variant");
    expect(runtimeSources).not.toContain("OUTBOUND_RETELL_SINGLE_PROMPT_AGENT_ID");
    expect(runtimeSources).not.toContain('"single_prompt"');
  });

  it("accepts signed metadata only from the configured Conversation Flow agent", () => {
    const call = {
      agent_id: "agent_conversation_flow",
      metadata: {
        business_id: "business-id",
        customer_id: "customer-id",
        invoice_id: "invoice-id",
        call_attempt_id: "attempt-id",
      },
    };

    expect(trustedRetellMetadata(call, "agent_conversation_flow")).toEqual({
      businessId: "business-id",
      customerId: "customer-id",
      invoiceId: "invoice-id",
      callAttemptId: "attempt-id",
      agentId: "agent_conversation_flow",
    });
    expect(trustedRetellMetadata(call, "agent_single_prompt")).toBeNull();
    expect(trustedRetellMetadata({ metadata: call.metadata }, "agent_conversation_flow")).toBeNull();
  });
});
