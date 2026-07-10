import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildOutboundSetupSummary, OUTBOUND_TABLE_NAMES } from "../services/outboundSetup";

describe("outbound setup summary", () => {
  it("reports a clear migration warning when outbound tables are missing", () => {
    const summary = buildOutboundSetupSummary({
      detectedBaseUrl: "https://demo.example",
      database: {
        configured: true,
        tables: Object.fromEntries(
          OUTBOUND_TABLE_NAMES.map((table) => [table, table === "outbound_businesses"]),
        ) as Record<(typeof OUTBOUND_TABLE_NAMES)[number], boolean>,
        rpcDetected: false,
        latestPaymentEvent: null,
        latestRetellEvent: null,
        errors: ["outbound_invoices: relation does not exist"],
      },
      configuration: {
        appBaseUrl: "https://demo.example",
        deployed: true,
        adminTokenConfigured: true,
        supabaseUrlConfigured: true,
        supabaseServiceRoleConfigured: true,
        stripeSecretConfigured: true,
        stripeWebhookSecretConfigured: true,
        retellApiKeyConfigured: true,
        retellFromNumber: "+19842075346",
        outboundRetellAgentConfigured: true,
        outboundRetellFlowConfigured: true,
        outboundRetellSinglePromptAgentConfigured: false,
        outboundRetellWebhookSecretConfigured: true,
        outboundSmsEnabled: false,
        emailProvider: "none",
        emailProviderKeyConfigured: false,
        outboundPaymentEmailFromConfigured: false,
        outboundPaymentEmailEnabled: false,
        testMode: true,
        allowlistCount: 1,
        maxBatchSize: 3,
        afterHoursOverrideEnabled: false,
      },
    });

    expect(summary.supabase.tables_ready).toBe(false);
    expect(summary.supabase.migration_warning).toContain("not applied");
    expect(summary.supabase.tables.outbound_invoices).toBe(false);
  });

  it("returns status labels and URLs without any secret values", () => {
    const summary = buildOutboundSetupSummary({
      detectedBaseUrl: "https://demo.example",
      database: {
        configured: false,
        tables: Object.fromEntries(OUTBOUND_TABLE_NAMES.map((table) => [table, false])) as Record<
          (typeof OUTBOUND_TABLE_NAMES)[number],
          boolean
        >,
        rpcDetected: false,
        latestPaymentEvent: null,
        latestRetellEvent: null,
        errors: [],
      },
      configuration: {
        appBaseUrl: "https://demo.example",
        deployed: true,
        adminTokenConfigured: true,
        supabaseUrlConfigured: false,
        supabaseServiceRoleConfigured: false,
        stripeSecretConfigured: true,
        stripeWebhookSecretConfigured: true,
        retellApiKeyConfigured: true,
        retellFromNumber: "+19842075346",
        outboundRetellAgentConfigured: true,
        outboundRetellFlowConfigured: true,
        outboundRetellSinglePromptAgentConfigured: true,
        outboundRetellWebhookSecretConfigured: true,
        outboundSmsEnabled: false,
        emailProvider: "none",
        emailProviderKeyConfigured: false,
        outboundPaymentEmailFromConfigured: false,
        outboundPaymentEmailEnabled: false,
        testMode: true,
        allowlistCount: 1,
        maxBatchSize: 3,
        afterHoursOverrideEnabled: false,
      },
    });
    const serialized = JSON.stringify(summary);

    expect(summary.stripe.webhook_url).toBe("https://demo.example/api/outbound/webhooks/stripe");
    expect(summary.retell.webhook_url).toBe("https://demo.example/api/outbound/webhooks/retell");
    expect(summary.retell.single_prompt_agent_configured).toBe(true);
    expect(summary.retell.function_urls).toContain(
      "https://demo.example/api/outbound/retell/log-outcome",
    );
    expect(serialized).not.toContain("sk_test_secret_value");
    expect(serialized).not.toContain("service_role_secret_value");
  });
});

describe("outbound setup route and page", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  it("protects the setup endpoint and redacts configured secrets", async () => {
    process.env.NODE_ENV = "test";
    process.env.OUTBOUND_ADMIN_TOKEN = "setup-admin-token";
    process.env.STRIPE_SECRET_KEY = "sk_test_secret_value";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_secret_value";
    process.env.RETELL_API_KEY = "retell_secret_value";
    process.env.OUTBOUND_RETELL_WEBHOOK_SECRET = "retell_webhook_secret_value";
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    vi.resetModules();
    const { createApp } = await import("../app");

    const unauthorized = await request(createApp()).get("/api/outbound/setup/status");
    expect(unauthorized.status).toBe(401);

    const response = await request(createApp())
      .get("/api/outbound/setup/status")
      .set("Authorization", "Bearer setup-admin-token");
    expect(response.status).toBe(200);
    expect(response.body.stripe.secret_key_configured).toBe(true);
    expect(response.body.retell.api_key_configured).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("sk_test_secret_value");
    expect(JSON.stringify(response.body)).not.toContain("retell_secret_value");
  });

  it("renders the browser setup checklist and safe workflow controls", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "web/outbound.html"), "utf8");
    const script = fs.readFileSync(path.resolve(process.cwd(), "public/outbound/outbound.js"), "utf8");

    expect(html).toContain("Setup readiness");
    expect(html).toContain("Single test call controls");
    expect(html).toContain("Batch dry run");
    expect(html).toContain("Call history");
    expect(html).toContain("Payment links");
    expect(html).toContain("Events and debugging");
    expect(html).toContain("After-hours self-test override");
    expect(html).toContain('data-action="phone"');
    expect(html).toContain('data-action="call"');
    expect(html).toMatch(/data-action="call"[^>]*disabled/);
    expect(script).toContain("/api/outbound/setup/status");
    expect(script).toContain("/api/outbound/dashboard");
    expect(script).toContain("/api/outbound/calls/dry-run");
    expect(script).toContain("/api/outbound/calls/start");
    expect(script).toContain("followup_task_id");
    expect(script).toContain("/api/outbound/businesses/");
    expect(html).toContain("/api/outbound/templates/customers.csv");
    expect(script).toContain("I UNDERSTAND THIS IS AN AFTER-HOURS TEST");
    expect(script).toContain('mode: "dry_run"');
  });
});
