import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoCallRunSchema, startCallSchema } from "../schemas/outboundSchemas";
import { resolveOutboundAgentVariant } from "../services/outboundAgentVariant";

const invoiceId = "00000000-0000-4000-8000-000000000003";
const authorizationId = "00000000-0000-4000-8000-000000000099";

describe("outbound comparison agent selection", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("../services/outboundCalls");
  });

  it("maps only server-known variants and reports missing candidate configuration", () => {
    expect(resolveOutboundAgentVariant("conversation_flow", {
      conversationFlowAgentId: "agent_flow",
      singlePromptAgentId: "agent_prompt",
    })).toEqual({
      variant: "conversation_flow",
      label: "Conversation Flow",
      agentId: "agent_flow",
      configured: true,
      reason: null,
    });
    expect(resolveOutboundAgentVariant("single_prompt", {
      conversationFlowAgentId: "agent_flow",
      singlePromptAgentId: "",
    })).toMatchObject({
      variant: "single_prompt",
      agentId: "",
      configured: false,
      reason: "single_prompt_agent_not_configured",
    });
  });

  it("accepts agent_variant only on demo call requests", () => {
    expect(demoCallRunSchema.parse({
      invoice_id: invoiceId,
      demo_call_authorization_id: authorizationId,
      agent_variant: "single_prompt",
    }).agent_variant).toBe("single_prompt");
    expect(demoCallRunSchema.parse({
      invoice_id: invoiceId,
      demo_call_authorization_id: authorizationId,
    }).agent_variant).toBe("conversation_flow");
    expect(startCallSchema.safeParse({ invoice_id: invoiceId, agent_variant: "single_prompt" }).success).toBe(false);
  });

  it("passes the selected variant to demo preflight while normal preflight rejects it", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "operations-admin";
    const describeOutboundCallPreflight = vi.fn().mockResolvedValue({
      eligible: true,
      reason: "eligible",
      agent_variant: "single_prompt",
      agent_label: "Single Prompt",
      agent_configured: true,
    });
    vi.doMock("../services/outboundCalls", () => ({
      inspectOutboundCallEligibility: vi.fn(),
      startOutboundCall: vi.fn(),
      outboundAllowlist: () => [],
      describeOutboundCallPreflight,
    }));
    vi.resetModules();
    const { createApp } = await import("../app");
    const app = createApp();

    const demoResponse = await request(app)
      .post("/api/outbound/demo-call/preflight")
      .set("Authorization", "Bearer operations-admin")
      .send({
        invoice_id: invoiceId,
        demo_call_authorization_id: authorizationId,
        agent_variant: "single_prompt",
      });
    const normalResponse = await request(app)
      .post("/api/outbound/calls/dry-run")
      .set("Authorization", "Bearer operations-admin")
      .send({ invoice_id: invoiceId, agent_variant: "single_prompt" });

    expect(demoResponse.status).toBe(200);
    expect(describeOutboundCallPreflight).toHaveBeenCalledWith(
      invoiceId,
      expect.any(Date),
      undefined,
      undefined,
      authorizationId,
      "single_prompt",
    );
    expect(normalResponse.status).toBe(400);
  });

  it("renders a Presentation Mode selector and submits it to preflight and start", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "web/outbound.html"), "utf8");
    const javascript = fs.readFileSync(path.resolve(process.cwd(), "public/outbound/outbound.js"), "utf8");

    expect(html).toContain('id="demo-agent-variant"');
    expect(html).toContain('value="conversation_flow"');
    expect(html).toContain('value="single_prompt"');
    expect(javascript).toContain("agent_variant: document.getElementById(\"demo-agent-variant\").value");
    expect(javascript).toContain("activeDemoPreflight.agent_variant");
  });
});
