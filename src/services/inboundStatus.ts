import { env, isProduction } from "../config/env";
import { countTable, selectRecentRecords } from "./supabase";

const INBOUND_AGENT_ID = "agent_16b324c0e55f21c0a5f914c169";
const INBOUND_LLM_ID = "llm_e8bb285e8cb0fc562f06e2395a78";
const DEMO_PEST_KB_ID = "knowledge_base_5c6a5b20b1a9ed4f";

type AnyRecord = Record<string, any>;
type InboundToolStatus = {
  name: string;
  type: string | null;
  url: string | null;
  event_type_id: string | number | null;
  native: boolean;
};

function appBaseUrl(detectedBaseUrl: string): string {
  return (env.APP_BASE_URL || detectedBaseUrl).replace(/\/$/, "");
}

async function retellRequest<T = AnyRecord>(endpoint: string): Promise<{ ok: boolean; data: T | null; error?: string }> {
  if (!env.RETELL_API_KEY) return { ok: false, data: null, error: "RETELL_API_KEY is not configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.retellai.com${endpoint}`, {
      headers: {
        Authorization: `Bearer ${env.RETELL_API_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, data: null, error: `Retell HTTP ${response.status}` };
    return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : "Retell readback failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function publicTools(llm: AnyRecord | null): InboundToolStatus[] {
  return (llm?.general_tools ?? []).map((tool: AnyRecord) => ({
    name: tool.name,
    type: tool.type ?? null,
    url: tool.url ?? null,
    event_type_id: tool.event_type_id ?? null,
    native: !tool.url,
  }));
}

function checkItem(label: string, pass: boolean, detail: string) {
  return { label, pass, detail };
}

function callSummary(row: AnyRecord) {
  const payload = row.event_payload as AnyRecord | undefined;
  const call = payload?.call as AnyRecord | undefined;
  const analysis = call?.call_analysis as AnyRecord | undefined;
  const custom = analysis?.custom_analysis_data as AnyRecord | undefined;
  return {
    id: row.id,
    created_at: row.created_at,
    retell_call_id: row.retell_call_id,
    event_type: row.event_type,
    caller_phone: row.caller_phone,
    agent_id: row.agent_id,
    caller_name: custom?.caller_name ?? null,
    pest_issue: custom?.pest_issue ?? null,
    property_address: custom?.property_address ?? null,
    appointment_status: custom?.appointment_confirmed ? "confirmed" : custom?.appointment_requested ? "requested" : null,
    transfer_status: custom?.transfer_requested ? "requested" : null,
    outcome: custom?.call_outcome ?? null,
    sentiment: custom?.user_sentiment ?? analysis?.user_sentiment ?? null,
    summary: custom?.call_summary ?? analysis?.call_summary ?? null,
  };
}

export async function getInboundStatus(detectedBaseUrl: string) {
  const baseUrl = appBaseUrl(detectedBaseUrl);
  const [phone, agent, llm, leadCount, callEventCount, smsEventCount, bookingCount, recentCalls, recentLeads] =
    await Promise.all([
      retellRequest<AnyRecord>(`/get-phone-number/${encodeURIComponent(env.RETELL_PHONE_NUMBER)}`),
      retellRequest<AnyRecord>(`/get-agent/${INBOUND_AGENT_ID}`),
      retellRequest<AnyRecord>(`/get-retell-llm/${INBOUND_LLM_ID}`),
      countTable("leads"),
      countTable("call_events"),
      countTable("sms_events"),
      countTable("booking_requests"),
      selectRecentRecords(
        "call_events",
        "id,created_at,retell_call_id,event_type,event_payload,caller_phone,agent_id",
        20,
      ),
      selectRecentRecords(
        "leads",
        "id,created_at,caller_name,caller_phone,alternate_phone,pest_issue,property_address,property_city,property_zip,preferred_datetime,preferred_booking_method,urgency_level,status,retell_call_id,call_summary",
        20,
      ),
    ]);

  const phoneBinding = (phone.data?.inbound_agents ?? []).find((binding: AnyRecord) => binding.agent_id === INBOUND_AGENT_ID);
  const tools = publicTools(llm.data);
  const toolUrls = tools.filter((tool) => tool.url);
  const nativeCalTools = tools.filter((tool) => ["check_availability_cal", "book_appointment_cal"].includes(tool.name));
  const checks = [
    checkItem("Phone bound to inbound agent", Boolean(phoneBinding), JSON.stringify(phone.data?.inbound_agents ?? [])),
    checkItem("Webhook URL uses production backend", agent.data?.webhook_url === `${baseUrl}/retell/webhook`, agent.data?.webhook_url ?? "missing"),
    checkItem("Voice ID is Gilfoy", agent.data?.voice_id === "11labs-Gilfoy", agent.data?.voice_id ?? "missing"),
    checkItem("Spoken name is Paul", String(llm.data?.begin_message ?? "").includes("Paul"), llm.data?.begin_message ?? "missing"),
    checkItem("Model is gpt-4.1", llm.data?.model === "gpt-4.1", llm.data?.model ?? "missing"),
    checkItem("Demo Pest KB attached", (llm.data?.knowledge_base_ids ?? []).includes(DEMO_PEST_KB_ID), JSON.stringify(llm.data?.knowledge_base_ids ?? [])),
    checkItem("Native Cal.com tools attached", nativeCalTools.length === 2, nativeCalTools.map((tool) => tool.name).join(", ") || "missing"),
    checkItem("No normal SMS booking tool attached", !tools.some((tool) => tool.name === "send_booking_sms"), "send_booking_sms should remain backend-only for inbound"),
    checkItem("Supabase reachable", leadCount.reachable && callEventCount.reachable, `leads=${leadCount.count ?? "?"}, call_events=${callEventCount.count ?? "?"}`),
  ];

  return {
    checked_at: new Date().toISOString(),
    app: {
      base_url: baseUrl,
      detected_base_url: detectedBaseUrl,
      runtime: isProduction() ? "production" : "local",
      admin_token_configured: Boolean(env.INBOUND_ADMIN_TOKEN),
    },
    retell: {
      phone_number: env.RETELL_PHONE_NUMBER,
      expected_agent_id: INBOUND_AGENT_ID,
      expected_llm_id: INBOUND_LLM_ID,
      phone_binding: phone.data?.inbound_agents ?? null,
      agent: agent.data
        ? {
            agent_id: agent.data.agent_id,
            version: agent.data.version,
            is_published: agent.data.is_published,
            webhook_url: agent.data.webhook_url,
            voice_id: agent.data.voice_id,
            voice_model: agent.data.voice_model,
            voice_speed: agent.data.voice_speed,
            interruption_sensitivity: agent.data.interruption_sensitivity,
            responsiveness: agent.data.responsiveness,
            enable_dynamic_responsiveness: agent.data.enable_dynamic_responsiveness,
            enable_dynamic_voice_speed: agent.data.enable_dynamic_voice_speed,
            ambient_sound: agent.data.ambient_sound,
            ambient_sound_volume: agent.data.ambient_sound_volume,
            handbook_config: agent.data.handbook_config,
          }
        : null,
      llm: llm.data
        ? {
            llm_id: llm.data.llm_id,
            version: llm.data.version,
            model: llm.data.model,
            model_temperature: llm.data.model_temperature,
            begin_message: llm.data.begin_message,
            knowledge_base_ids: llm.data.knowledge_base_ids,
            kb_config: llm.data.kb_config,
            tools,
          }
        : null,
      readback_errors: [phone.error, agent.error, llm.error].filter(Boolean),
    },
    endpoints: {
      health: `${baseUrl}/health`,
      webhook: `${baseUrl}/retell/webhook`,
      custom_tools: [
        `${baseUrl}/tools/create-lead`,
        `${baseUrl}/tools/check-service-area`,
        `${baseUrl}/tools/transfer-call`,
        `${baseUrl}/tools/send-booking-sms`,
      ],
      native_tools: nativeCalTools.map((tool) => ({ name: tool.name, event_type_id: tool.event_type_id })),
      tool_urls: toolUrls,
    },
    supabase: {
      configured: leadCount.configured,
      tables: {
        leads: leadCount,
        call_events: callEventCount,
        sms_events: smsEventCount,
        booking_requests: bookingCount,
      },
    },
    google_sheets: {
      enabled: env.GOOGLE_SHEETS_ENABLED,
      sheet_id: env.GOOGLE_SHEET_ID || null,
      tab_name: env.GOOGLE_SHEETS_TAB_NAME,
      configured:
        Boolean(env.GOOGLE_SHEET_ID && env.GOOGLE_SHEETS_CLIENT_EMAIL && env.GOOGLE_SHEETS_PRIVATE_KEY) ||
        Boolean(env.GOOGLE_SHEETS_WEBHOOK_URL),
    },
    recent: {
      leads: recentLeads.data,
      calls: recentCalls.data.map(callSummary),
      call_events_error: recentCalls.error,
      leads_error: recentLeads.error,
    },
    checks,
    ready: checks.every((item) => item.pass),
  };
}
