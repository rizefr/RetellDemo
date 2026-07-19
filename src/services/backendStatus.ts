import { env, isProduction } from "../config/env";
import { getInboundStatus } from "./inboundStatus";
import { getOutboundSetupStatus } from "./outboundSetup";

type StatusResult<T> = {
  available: boolean;
  data: T | null;
  error: string | null;
};

function appBaseUrl(detectedBaseUrl: string): string {
  return (env.APP_BASE_URL || env.PRODUCTION_BASE_URL || detectedBaseUrl).replace(/\/$/, "");
}

async function readStatus<T>(reader: () => Promise<T>): Promise<StatusResult<T>> {
  try {
    return { available: true, data: await reader(), error: null };
  } catch (error) {
    return {
      available: false,
      data: null,
      error: error instanceof Error ? error.message : "Status check failed",
    };
  }
}

function state(pass: boolean, configured = true): "ready" | "warning" | "unavailable" {
  if (!configured) return "unavailable";
  return pass ? "ready" : "warning";
}

function tableSummary(table: any) {
  return {
    configured: Boolean(table?.configured),
    reachable: Boolean(table?.reachable),
    count: typeof table?.count === "number" ? table.count : null,
    error: table?.error ?? null,
  };
}

function sanitizeOutboundStatus(data: any) {
  if (!data) return null;
  return {
    checked_at: data.checked_at,
    ready_for_browser_setup: Boolean(data.ready_for_browser_setup),
    ready_for_single_test_call: Boolean(data.ready_for_single_test_call),
    supabase: {
      url_configured: Boolean(data.supabase?.url_configured),
      service_role_configured: Boolean(data.supabase?.service_role_configured),
      tables_ready: Boolean(data.supabase?.tables_ready),
      paid_rpc_detected: Boolean(data.supabase?.paid_rpc_detected),
      migration_warning: data.supabase?.migration_warning ?? null,
      errors: data.supabase?.errors ?? [],
    },
    stripe: {
      secret_key_configured: Boolean(data.stripe?.secret_key_configured),
      webhook_secret_configured: Boolean(data.stripe?.webhook_secret_configured),
      webhook_url: data.stripe?.webhook_url ?? null,
      latest_payment_event: data.stripe?.latest_payment_event ?? null,
    },
    retell: {
      api_key_configured: Boolean(data.retell?.api_key_configured),
      from_number: data.retell?.from_number ?? null,
      from_number_correct: Boolean(data.retell?.from_number_correct),
      outbound_agent_configured: Boolean(data.retell?.outbound_agent_configured),
      outbound_flow_configured: Boolean(data.retell?.outbound_flow_configured),
      webhook_secret_configured: Boolean(data.retell?.webhook_secret_configured),
      webhook_url: data.retell?.webhook_url ?? null,
      function_urls: data.retell?.function_urls ?? [],
      sms_mode: data.retell?.sms_mode ?? "disabled_manual",
      latest_event: data.retell?.latest_event ?? null,
    },
    call_safety: {
      test_mode: Boolean(data.call_safety?.test_mode),
      allowlist_configured: Boolean(data.call_safety?.allowlist_configured),
      allowlist_count: Number(data.call_safety?.allowlist_count ?? 0),
      max_batch_size: Number(data.call_safety?.max_batch_size ?? 0),
      calling_window: data.call_safety?.calling_window ?? null,
      real_batch_available_in_ui: Boolean(data.call_safety?.real_batch_available_in_ui),
    },
  };
}

function sanitizeInboundStatus(data: any) {
  if (!data) return null;
  return {
    checked_at: data.checked_at,
    ready: Boolean(data.ready),
    app: {
      base_url: data.app?.base_url ?? null,
      runtime: data.app?.runtime ?? null,
      admin_token_configured: Boolean(data.app?.admin_token_configured),
    },
    retell: {
      phone_number: data.retell?.phone_number ?? null,
      expected_agent_id: data.retell?.expected_agent_id ?? null,
      expected_llm_id: data.retell?.expected_llm_id ?? null,
      phone_binding: Boolean(data.retell?.phone_binding),
      agent: data.retell?.agent
        ? {
            agent_id: data.retell.agent.agent_id,
            version: data.retell.agent.version,
            is_published: data.retell.agent.is_published,
            webhook_url: data.retell.agent.webhook_url,
          }
        : null,
      readback_errors: data.retell?.readback_errors ?? [],
    },
    endpoints: {
      health: data.endpoints?.health ?? null,
      webhook: data.endpoints?.webhook ?? null,
      custom_tools: data.endpoints?.custom_tools ?? [],
      native_tools: data.endpoints?.native_tools ?? [],
    },
    supabase: {
      configured: Boolean(data.supabase?.configured),
      tables: {
        leads: tableSummary(data.supabase?.tables?.leads),
        call_events: tableSummary(data.supabase?.tables?.call_events),
        sms_events: tableSummary(data.supabase?.tables?.sms_events),
        booking_requests: tableSummary(data.supabase?.tables?.booking_requests),
      },
    },
    recent: {
      leads: data.recent?.leads ?? [],
      calls: data.recent?.calls ?? [],
      raw_call_event_count: Number(data.recent?.raw_call_event_count ?? 0),
      hidden_blank_call_event_count: Number(data.recent?.hidden_blank_call_event_count ?? 0),
      call_events_error: data.recent?.call_events_error ?? null,
      leads_error: data.recent?.leads_error ?? null,
    },
    checks: data.checks ?? [],
  };
}

export function getBackendNavigation() {
  return {
    sections: [
      { id: "overview", label: "Overview", href: "#overview" },
      { id: "outbound", label: "Outbound Collections", href: "#outbound" },
      { id: "inbound", label: "Inbound Receptionist", href: "#inbound" },
      { id: "landing-pages", label: "Landing Pages", href: "#landing-pages" },
      { id: "settings", label: "Settings / Setup", href: "#settings" },
      { id: "docs", label: "Docs / Runbooks", href: "#docs" },
    ],
    legacy: [
      { id: "outbound", label: "Legacy outbound dashboard", href: "/outbound" },
      { id: "inbound", label: "Legacy inbound dashboard", href: "/inbound" },
    ],
    docs: [
      { label: "Unified backend README", href: "/backend/docs/README_backend.md" },
      { label: "Outbound runbook", href: "/backend/docs/README_outbound.md" },
      { label: "Inbound runbook", href: "/backend/docs/README_INBOUND.md" },
      { label: "Website notes", href: "/backend/docs/README_WEBSITE.md" },
    ],
  };
}

export async function getBackendStatus(detectedBaseUrl: string) {
  const baseUrl = appBaseUrl(detectedBaseUrl);
  const [outbound, inbound] = await Promise.all([
    readStatus(() => getOutboundSetupStatus(detectedBaseUrl)),
    readStatus(() => getInboundStatus(detectedBaseUrl)),
  ]);

  const outboundData = outbound.data as any;
  const inboundData = inbound.data as any;
  const outboundSupabaseReady = Boolean(outboundData?.supabase?.tables_ready);
  const inboundSupabaseReady = Boolean(
    inboundData?.supabase?.tables?.leads?.reachable && inboundData?.supabase?.tables?.call_events?.reachable,
  );
  const stripeConfigured = Boolean(
    outboundData?.stripe?.secret_key_configured && outboundData?.stripe?.webhook_secret_configured,
  );
  const outboundRetellReady = Boolean(
    outboundData?.retell?.api_key_configured &&
      outboundData?.retell?.outbound_agent_configured &&
      outboundData?.retell?.outbound_flow_configured,
  );
  const inboundRetellReady = Boolean(inboundData?.ready);
  const quickBooksConfigured = Boolean(
    env.QUICKBOOKS_CLIENT_ID && env.QUICKBOOKS_CLIENT_SECRET && env.QUICKBOOKS_REDIRECT_URI,
  );

  return {
    checked_at: new Date().toISOString(),
    app: {
      base_url: baseUrl,
      detected_base_url: detectedBaseUrl.replace(/\/$/, ""),
      runtime: isProduction() || Boolean(env.VERCEL_ENV) ? "production" : "local",
      environment: env.VERCEL_ENV || env.NODE_ENV,
      routes: {
        backend: `${baseUrl}/backend`,
        outbound: `${baseUrl}/outbound`,
        inbound: `${baseUrl}/inbound`,
        health: `${baseUrl}/health`,
      },
    },
    auth: {
      backend_uses: "OUTBOUND_ADMIN_TOKEN",
      outbound_token_configured: Boolean(env.OUTBOUND_ADMIN_TOKEN),
      inbound_token_configured: Boolean(env.INBOUND_ADMIN_TOKEN),
      cookie: "HttpOnly SameSite=Strict",
    },
    overview: {
      outbound: {
        available: outbound.available,
        state: state(Boolean(outboundData?.ready_for_single_test_call), outbound.available),
        message: outbound.available
          ? outboundData?.ready_for_single_test_call
            ? "Ready for one gated test call."
            : "Setup or call gates need review."
          : "Outbound status unavailable.",
        error: outbound.error,
      },
      inbound: {
        available: inbound.available,
        state: state(Boolean(inboundData?.ready), inbound.available),
        message: inbound.available
          ? inboundData?.ready
            ? "Inbound receptionist readback is ready."
            : "Inbound readback has items to review."
          : "Inbound status unavailable.",
        error: inbound.error,
      },
    },
    integrations: {
      retell: {
        state: state(outboundRetellReady || inboundRetellReady, outbound.available || inbound.available),
        outbound_ready: outboundRetellReady,
        inbound_ready: inboundRetellReady,
        inbound_phone_number: inboundData?.retell?.phone_number ?? null,
        outbound_from_number: outboundData?.retell?.from_number ?? null,
        sms_mode: outboundData?.retell?.sms_mode ?? "disabled_manual",
      },
      supabase: {
        state: state(outboundSupabaseReady || inboundSupabaseReady, outbound.available || inbound.available),
        outbound_tables_ready: outboundSupabaseReady,
        inbound_tables_ready: inboundSupabaseReady,
      },
      stripe: {
        state: state(stripeConfigured, outbound.available),
        configured: stripeConfigured,
        latest_payment_event: outboundData?.stripe?.latest_payment_event ?? null,
      },
      email: {
        state: env.OUTBOUND_PAYMENT_EMAIL_ENABLED ? "warning" : "unavailable",
        provider: env.EMAIL_PROVIDER,
        outbound_payment_email_enabled: env.OUTBOUND_PAYMENT_EMAIL_ENABLED,
        message: env.OUTBOUND_PAYMENT_EMAIL_ENABLED
          ? "Email provider is enabled; verify provider logs before use."
          : "Email sending remains disabled/manual.",
      },
      sms: {
        state: outboundData?.retell?.sms_mode === "disabled_manual" ? "unavailable" : "warning",
        outbound_mode: outboundData?.retell?.sms_mode ?? "disabled_manual",
        inbound_normal_flow: "disabled",
      },
      quickbooks: {
        state: quickBooksConfigured ? "warning" : "unavailable",
        configured: quickBooksConfigured,
        environment: env.QUICKBOOKS_ENVIRONMENT,
        message: quickBooksConfigured ? "Credentials present; integration remains scaffold/status only." : "Scaffold only.",
      },
    },
    outbound: {
      ...outbound,
      data: sanitizeOutboundStatus(outboundData),
    },
    inbound: {
      ...inbound,
      data: sanitizeInboundStatus(inboundData),
    },
    navigation: getBackendNavigation(),
  };
}
