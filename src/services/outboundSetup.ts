import type { SupabaseClient } from "@supabase/supabase-js";
import { env, isProduction } from "../config/env";
import { getSupabaseClient } from "./supabase";
import { outboundBusinessRuntimeSettings } from "./outboundRuntimeSettings";

export const OUTBOUND_TABLE_NAMES = [
  "outbound_businesses",
  "outbound_customers",
  "outbound_invoices",
  "outbound_call_attempts",
  "outbound_payment_links",
  "outbound_events",
  "outbound_followup_tasks",
  "outbound_demo_call_authorizations",
] as const;

export type OutboundTableName = (typeof OUTBOUND_TABLE_NAMES)[number];

export type OutboundDatabaseReadiness = {
  configured: boolean;
  tables: Record<OutboundTableName, boolean>;
  rpcDetected: boolean;
  latestPaymentEvent: { event_type: string; created_at: string } | null;
  latestRetellEvent: { event_type: string; created_at: string } | null;
  errors: string[];
};

export type OutboundSetupConfiguration = {
  appBaseUrl: string;
  deployed: boolean;
  adminTokenConfigured: boolean;
  supabaseUrlConfigured: boolean;
  supabaseServiceRoleConfigured: boolean;
  stripeSecretConfigured: boolean;
  stripeWebhookSecretConfigured: boolean;
  retellApiKeyConfigured: boolean;
  retellFromNumber: string;
  outboundRetellAgentConfigured: boolean;
  outboundRetellFlowConfigured: boolean;
  outboundRetellWebhookSecretConfigured: boolean;
  outboundSmsEnabled: boolean;
  emailProvider: "none" | "resend";
  emailProviderKeyConfigured: boolean;
  outboundPaymentEmailFromConfigured: boolean;
  outboundPaymentEmailEnabled: boolean;
  testMode: boolean;
  allowlistCount: number;
  maxBatchSize: number;
  afterHoursOverrideEnabled: boolean;
};

function emptyTableStatus(): Record<OutboundTableName, boolean> {
  return Object.fromEntries(OUTBOUND_TABLE_NAMES.map((table) => [table, false])) as Record<
    OutboundTableName,
    boolean
  >;
}

async function latestProviderEvent(client: SupabaseClient, source: "stripe" | "retell") {
  const result = await client
    .from("outbound_events")
    .select("event_type,created_at")
    .eq("source", source)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) return null;
  return {
    event_type: String(result.data.event_type),
    created_at: String(result.data.created_at),
  };
}

async function detectPaidRpc(fetchImpl: typeof fetch): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const schema = (await response.json()) as { paths?: Record<string, unknown> };
    return Boolean(schema.paths?.["/rpc/outbound_mark_invoice_paid"]);
  } catch {
    return false;
  }
}

export async function detectOutboundDatabaseReadiness(
  client = getSupabaseClient(),
  fetchImpl: typeof fetch = fetch,
): Promise<OutboundDatabaseReadiness> {
  const tables = emptyTableStatus();
  if (!client) {
    return {
      configured: false,
      tables,
      rpcDetected: false,
      latestPaymentEvent: null,
      latestRetellEvent: null,
      errors: [],
    };
  }

  const errors: string[] = [];
  await Promise.all(
    OUTBOUND_TABLE_NAMES.map(async (table) => {
      const result = await client.from(table).select("id", { count: "exact", head: true }).limit(1);
      tables[table] = !result.error;
      if (result.error) errors.push(`${table}: missing or unreachable`);
    }),
  );

  const eventsReady = tables.outbound_events;
  const [rpcDetected, latestPaymentEvent, latestRetellEvent] = await Promise.all([
    detectPaidRpc(fetchImpl),
    eventsReady ? latestProviderEvent(client, "stripe") : Promise.resolve(null),
    eventsReady ? latestProviderEvent(client, "retell") : Promise.resolve(null),
  ]);

  return {
    configured: true,
    tables,
    rpcDetected,
    latestPaymentEvent,
    latestRetellEvent,
    errors,
  };
}

export function buildOutboundSetupSummary(input: {
  detectedBaseUrl: string;
  database: OutboundDatabaseReadiness;
  configuration: OutboundSetupConfiguration;
}) {
  const configuredBaseUrl = input.configuration.appBaseUrl.replace(/\/$/, "");
  const detectedBaseUrl = input.detectedBaseUrl.replace(/\/$/, "");
  const operationalBaseUrl = configuredBaseUrl || detectedBaseUrl;
  const tablesReady = OUTBOUND_TABLE_NAMES.every((table) => input.database.tables[table]);
  const retellFromNumberCorrect = input.configuration.retellFromNumber === "+19842075346";

  return {
    checked_at: new Date().toISOString(),
    app: {
      app_base_url_configured: Boolean(configuredBaseUrl),
      configured_base_url: configuredBaseUrl || null,
      detected_base_url: detectedBaseUrl,
      base_url_matches_request: Boolean(configuredBaseUrl) && configuredBaseUrl === detectedBaseUrl,
      runtime: input.configuration.deployed ? "deployed" : "local",
      health: {
        ok: true,
        url: `${detectedBaseUrl}/health`,
      },
      admin_auth: {
        authenticated: true,
        token_configured: input.configuration.adminTokenConfigured,
      },
    },
    supabase: {
      url_configured: input.configuration.supabaseUrlConfigured,
      service_role_configured: input.configuration.supabaseServiceRoleConfigured,
      tables: input.database.tables,
      tables_ready: tablesReady,
      paid_rpc_detected: input.database.rpcDetected,
      migration_warning: tablesReady
        ? null
        : "Outbound migration is not applied or one or more outbound tables are unreachable.",
      errors: input.database.errors,
    },
    stripe: {
      secret_key_configured: input.configuration.stripeSecretConfigured,
      webhook_secret_configured: input.configuration.stripeWebhookSecretConfigured,
      webhook_url: `${operationalBaseUrl}/api/outbound/webhooks/stripe`,
      latest_payment_event: input.database.latestPaymentEvent,
    },
    retell: {
      api_key_configured: input.configuration.retellApiKeyConfigured,
      from_number: input.configuration.retellFromNumber,
      from_number_correct: retellFromNumberCorrect,
      outbound_agent_configured: input.configuration.outboundRetellAgentConfigured,
      outbound_flow_configured: input.configuration.outboundRetellFlowConfigured,
      webhook_secret_configured: input.configuration.outboundRetellWebhookSecretConfigured,
      webhook_url: `${operationalBaseUrl}/api/outbound/webhooks/retell`,
      function_urls: [
        "log-outcome",
        "create-payment-link",
        "send-payment-sms",
        "send-payment-email",
        "request-human-transfer",
        "schedule-followup",
        "schedule-callback",
      ].map((name) => `${operationalBaseUrl}/api/outbound/retell/${name}`),
      sms_mode: input.configuration.outboundSmsEnabled ? "enabled_requires_provider_verification" : "disabled_manual",
      latest_event: input.database.latestRetellEvent,
    },
    email: {
      provider: input.configuration.emailProvider,
      provider_key_configured: input.configuration.emailProviderKeyConfigured,
      from_address_configured: input.configuration.outboundPaymentEmailFromConfigured,
      sending_enabled: input.configuration.outboundPaymentEmailEnabled,
      mode:
        input.configuration.outboundPaymentEmailEnabled &&
        input.configuration.emailProvider !== "none" &&
        input.configuration.emailProviderKeyConfigured &&
        input.configuration.outboundPaymentEmailFromConfigured
          ? "enabled"
          : "disabled_manual",
    },
    call_safety: {
      test_mode: input.configuration.testMode,
      allowlist_configured: input.configuration.allowlistCount > 0,
      allowlist_count: input.configuration.allowlistCount,
      max_batch_size: input.configuration.maxBatchSize,
      calling_window: "Monday-Friday, 10:00-16:00 recipient local time",
      real_batch_available_in_ui: false,
      after_hours_test_override_enabled: input.configuration.afterHoursOverrideEnabled,
    },
    ready_for_browser_setup: Boolean(
      configuredBaseUrl &&
        input.configuration.adminTokenConfigured &&
        input.configuration.supabaseUrlConfigured &&
        input.configuration.supabaseServiceRoleConfigured,
    ),
    ready_for_single_test_call: Boolean(
      tablesReady &&
        input.database.rpcDetected &&
        input.configuration.testMode &&
        input.configuration.allowlistCount > 0 &&
        input.configuration.stripeSecretConfigured &&
        input.configuration.stripeWebhookSecretConfigured &&
        input.configuration.retellApiKeyConfigured &&
        input.configuration.outboundRetellAgentConfigured &&
        input.configuration.outboundRetellFlowConfigured &&
        input.configuration.outboundRetellWebhookSecretConfigured &&
        retellFromNumberCorrect,
    ),
  };
}

export async function getOutboundSetupStatus(detectedBaseUrl: string) {
  const database = await detectOutboundDatabaseReadiness();
  const client = getSupabaseClient();
  const businessResult = client
    ? await client.from("outbound_businesses").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle()
    : { data: null };
  const runtime = businessResult.data ? outboundBusinessRuntimeSettings(businessResult.data) : null;
  return buildOutboundSetupSummary({
    detectedBaseUrl,
    database,
    configuration: {
      appBaseUrl: env.APP_BASE_URL,
      deployed: isProduction() || Boolean(env.VERCEL_ENV),
      adminTokenConfigured: Boolean(env.OUTBOUND_ADMIN_TOKEN),
      supabaseUrlConfigured: Boolean(env.SUPABASE_URL),
      supabaseServiceRoleConfigured: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      stripeSecretConfigured: Boolean(env.STRIPE_SECRET_KEY),
      stripeWebhookSecretConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET),
      retellApiKeyConfigured: Boolean(env.RETELL_API_KEY),
      retellFromNumber: env.RETELL_FROM_NUMBER,
      outboundRetellAgentConfigured: Boolean(env.OUTBOUND_RETELL_AGENT_ID),
      outboundRetellFlowConfigured: Boolean(env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID),
      outboundRetellWebhookSecretConfigured: Boolean(env.OUTBOUND_RETELL_WEBHOOK_SECRET),
      outboundSmsEnabled: runtime?.smsEffective ?? env.OUTBOUND_RETELL_SMS_ENABLED,
      emailProvider: env.EMAIL_PROVIDER,
      emailProviderKeyConfigured: Boolean(env.EMAIL_PROVIDER_API_KEY),
      outboundPaymentEmailFromConfigured: Boolean(env.OUTBOUND_PAYMENT_EMAIL_FROM),
      outboundPaymentEmailEnabled: runtime?.emailEffective ?? env.OUTBOUND_PAYMENT_EMAIL_ENABLED,
      testMode: runtime?.testMode ?? env.OUTBOUND_TEST_MODE,
      allowlistCount: runtime?.allowlist.length ?? env.OUTBOUND_TEST_PHONE_ALLOWLIST.split(",").filter((value) => value.trim()).length,
      maxBatchSize: runtime?.maxBatchSize ?? env.OUTBOUND_MAX_BATCH_SIZE,
      afterHoursOverrideEnabled: runtime?.allowAfterHoursTestOverride ?? env.OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE,
    },
  });
}
