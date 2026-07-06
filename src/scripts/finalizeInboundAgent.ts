import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { buildSinglePromptCandidatePrompt, DEMO_PEST_KB_ID } from "../retell/singlePromptCandidatePrompt";
import { buildCustomToolDefinitions, buildNativeCalComTools, buildRetellControlTools } from "../retell/tools";

type AnyRecord = Record<string, any>;

const INBOUND_AGENT_ID = "agent_16b324c0e55f21c0a5f914c169";
const INBOUND_LLM_ID = "llm_e8bb285e8cb0fc562f06e2395a78";
const OLD_CONVERSATION_FLOW_AGENT_ID = "agent_1e77470887528d657c5ad62d4d";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function baseUrl() {
  const value = process.env.INBOUND_BASE_URL || env.APP_BASE_URL || env.PUBLIC_BASE_URL;
  if (!value || !/^https:\/\//.test(value)) {
    throw new Error("Set APP_BASE_URL or INBOUND_BASE_URL to the production HTTPS backend URL.");
  }
  return value.replace(/\/$/, "");
}

function retellHeaders() {
  if (!env.RETELL_API_KEY) throw new Error("RETELL_API_KEY is required.");
  return {
    Authorization: `Bearer ${env.RETELL_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function redact(value: string) {
  let output = value;
  for (const secret of [env.RETELL_API_KEY, env.CALCOM_API_KEY, env.RETELL_WEBHOOK_SECRET_OR_API_KEY].filter(Boolean)) {
    output = output.replaceAll(secret, "<redacted>");
  }
  return output;
}

async function retellRequest<T = AnyRecord>(method: string, endpoint: string, body?: unknown): Promise<T> {
  console.error(`[retell] ${method} ${endpoint.split("?")[0]}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`https://api.retellai.com${endpoint}`, {
      method,
      headers: retellHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${endpoint} failed HTTP ${response.status}: ${redact(text.slice(0, 800))}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function backup(stamp: string, name: string, value: unknown) {
  const outputPath = path.resolve("generated", "backups", `${stamp}-${name}.json`);
  await writeJson(outputPath, value);
  return outputPath;
}

function uniquePostCallAnalysisData(existing: unknown) {
  const fallback = [
    { type: "string", name: "caller_name", description: "Caller first name or full name.", required: false },
    { type: "string", name: "caller_phone", description: "Best callback phone number.", required: false },
    { type: "string", name: "alternate_phone", description: "Alternate callback number if provided.", required: false },
    { type: "string", name: "pest_issue", description: "Pest issue discussed.", required: false },
    { type: "string", name: "property_address", description: "Service property address if provided.", required: false },
    { type: "string", name: "preferred_datetime", description: "Requested or confirmed appointment time.", required: false },
    {
      type: "enum",
      name: "urgency_level",
      description: "Urgency level.",
      choices: ["low", "medium", "high", "emergency", "unknown"],
      required: false,
    },
    {
      type: "enum",
      name: "booking_method",
      description: "How the caller wanted to proceed.",
      choices: ["phone_booking", "transfer", "callback", "unknown"],
      required: false,
    },
    { type: "boolean", name: "appointment_confirmed", description: "Whether Cal.com confirmed booking.", required: false },
    { type: "boolean", name: "transfer_requested", description: "Whether transfer was requested.", required: false },
    {
      type: "enum",
      name: "call_outcome",
      description: "Final call outcome.",
      choices: [
        "real_appointment_booked",
        "lead_captured",
        "transferred",
        "callback_needed",
        "wrong_number",
        "unsupported",
        "hostile_ended",
      ],
      required: false,
    },
    { type: "system-presets", name: "user_sentiment", required: false },
    { type: "system-presets", name: "call_summary", required: false },
  ];
  const source = Array.isArray(existing) && existing.length > 0 ? existing : fallback;
  const hasSystemCallSummary = source.some(
    (item: AnyRecord) => item?.name === "call_summary" && item?.type === "system-presets",
  );
  const seen = new Set<string>();
  return source.filter((item: AnyRecord) => {
    const name = item?.name;
    if (typeof name !== "string") return true;
    if (hasSystemCallSummary && name === "call_summary" && item.type !== "system-presets") return false;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function inboundTools(productionBaseUrl: string) {
  return [
    ...buildCustomToolDefinitions(productionBaseUrl).filter(
      (tool) => !["send_booking_sms", "check_availability_cal", "book_appointment_cal"].includes(tool.name),
    ),
    ...buildRetellControlTools({ quietTransferExecution: true }),
    ...buildNativeCalComTools(),
  ];
}

function publicToolSummary(llm: AnyRecord) {
  return (llm.general_tools ?? []).map((tool: AnyRecord) => ({
    name: tool.name,
    type: tool.type,
    url: tool.url ?? null,
    event_type_id: tool.event_type_id ?? null,
    has_secret_config: Boolean(tool.cal_api_key),
  }));
}

async function main() {
  const stamp = timestamp();
  const productionBaseUrl = baseUrl();
  const webhookUrl = `${productionBaseUrl}/retell/webhook`;

  const [phoneBefore, agentBefore, llmBefore] = await Promise.all([
    retellRequest<AnyRecord>("GET", `/get-phone-number/${encodeURIComponent(env.RETELL_PHONE_NUMBER)}`),
    retellRequest<AnyRecord>("GET", `/get-agent/${INBOUND_AGENT_ID}`),
    retellRequest<AnyRecord>("GET", `/get-retell-llm/${INBOUND_LLM_ID}`),
  ]);

  const bindingBefore = (phoneBefore.inbound_agents ?? []).find((item: AnyRecord) => item.agent_id === INBOUND_AGENT_ID);
  if (!bindingBefore) {
    throw new Error(`Phone ${env.RETELL_PHONE_NUMBER} is not bound to ${INBOUND_AGENT_ID}; refusing to mutate.`);
  }

  const backups = {
    phone_before: await backup(stamp, "inbound-phone-before-finalize", phoneBefore),
    agent_before: await backup(stamp, `${INBOUND_AGENT_ID}-before-finalize`, agentBefore),
    llm_before: await backup(stamp, `${INBOUND_LLM_ID}-before-finalize`, llmBefore),
  };

  const targetVersion = agentBefore.is_published
    ? (await retellRequest<AnyRecord>("POST", `/create-agent-version/${INBOUND_AGENT_ID}`, { base_version: agentBefore.version }))
        .version
    : agentBefore.version;

  const prompt = buildSinglePromptCandidatePrompt({
    businessName: env.DEFAULT_BUSINESS_NAME,
    timezone: env.DEFAULT_BUSINESS_TIMEZONE,
    calendarStatus:
      "Retell native Cal.com tools are the primary booking path. Echo-verify before booking and confirm only after book_appointment_cal succeeds.",
    smsStatus: "SMS booking is disabled for normal inbound calls. Save follow-up requests instead.",
  });

  const toolDefinitions = inboundTools(productionBaseUrl);
  const llmAfterUpdate = await retellRequest<AnyRecord>(
    "PATCH",
    `/update-retell-llm/${INBOUND_LLM_ID}?version=${encodeURIComponent(String(targetVersion))}`,
    {
      model: "gpt-4.1",
      model_temperature: 0.2,
      tool_call_strict_mode: true,
      start_speaker: "agent",
      begin_message: `Thanks for calling ${env.DEFAULT_BUSINESS_NAME}, this is Paul. How can I help?`,
      general_prompt: prompt,
      default_dynamic_variables: {
        business_name: env.DEFAULT_BUSINESS_NAME,
        booking_url: env.BOOKING_URL,
        booking_placeholder_email: env.BOOKING_PLACEHOLDER_EMAIL,
        transfer_number: env.RETELL_TRANSFER_PHONE_NUMBER,
      },
      general_tools: toolDefinitions,
      knowledge_base_ids: [DEMO_PEST_KB_ID],
      kb_config: { top_k: 3, filter_score: 0.6 },
    },
  );

  const interruptionBefore = Number(agentBefore.interruption_sensitivity ?? 0.75);
  const interruptionAfter = interruptionBefore === 0.75 ? 0.85 : Math.min(0.9, Math.max(interruptionBefore, 0.82));
  const handbook = {
    ...(agentBefore.handbook_config ?? {}),
    high_empathy: true,
    ai_disclosure: true,
    speech_normalization: true,
    echo_verification: true,
  };

  await retellRequest(
    "PATCH",
    `/update-agent/${INBOUND_AGENT_ID}?version=${encodeURIComponent(String(targetVersion))}`,
    {
      agent_name: agentBefore.agent_name ?? "Elijah's Pest Control Single Prompt Candidate",
      response_engine: {
        type: "retell-llm",
        llm_id: INBOUND_LLM_ID,
        version: targetVersion,
      },
      webhook_url: webhookUrl,
      webhook_events: agentBefore.webhook_events,
      webhook_timeout_ms: agentBefore.webhook_timeout_ms,
      voice_id: "11labs-Gilfoy",
      voice_model: agentBefore.voice_model ?? "eleven_flash_v2_5",
      voice_speed: agentBefore.voice_speed ?? 1.12,
      volume: agentBefore.volume ?? 1,
      enable_backchannel: false,
      backchannel_frequency: 0,
      backchannel_words: [],
      enable_dynamic_voice_speed: agentBefore.enable_dynamic_voice_speed ?? false,
      enable_dynamic_responsiveness: false,
      responsiveness: 0.95,
      ambient_sound: agentBefore.ambient_sound ?? "coffee-shop",
      ambient_sound_volume: agentBefore.ambient_sound_volume ?? 1,
      interruption_sensitivity: interruptionAfter,
      denoising_mode: agentBefore.denoising_mode ?? "noise-and-background-speech-cancellation",
      stt_mode: agentBefore.stt_mode ?? "accurate",
      end_call_after_silence_ms: agentBefore.end_call_after_silence_ms ?? 120000,
      max_call_duration_ms: agentBefore.max_call_duration_ms ?? 1020000,
      ring_duration_ms: agentBefore.ring_duration_ms ?? 20000,
      handbook_config: handbook,
      post_call_analysis_data: uniquePostCallAnalysisData(agentBefore.post_call_analysis_data),
      analysis_summary_prompt: agentBefore.analysis_summary_prompt,
      analysis_user_sentiment_prompt: agentBefore.analysis_user_sentiment_prompt,
      timezone: agentBefore.timezone ?? env.DEFAULT_BUSINESS_TIMEZONE,
      language: agentBefore.language ?? "en-US",
      version_description: "Inbound finalization: Gilfoy voice, Paul prompt, no SMS booking, phone Cal.com booking",
    },
  );

  await retellRequest("POST", `/publish-agent-version/${INBOUND_AGENT_ID}`, {
    version: targetVersion,
    version_description: "Inbound finalization: Gilfoy voice, Paul prompt, no SMS booking, phone Cal.com booking",
  });

  const [agentAfter, llmAfter, phoneAfter] = await Promise.all([
    retellRequest<AnyRecord>("GET", `/get-agent/${INBOUND_AGENT_ID}`),
    retellRequest<AnyRecord>("GET", `/get-retell-llm/${INBOUND_LLM_ID}`),
    retellRequest<AnyRecord>("GET", `/get-phone-number/${encodeURIComponent(env.RETELL_PHONE_NUMBER)}`),
  ]);

  const bindingAfter = (phoneAfter.inbound_agents ?? []).find((item: AnyRecord) => item.agent_id === INBOUND_AGENT_ID);
  if (bindingAfter && bindingAfter.agent_version !== "latest_published" && Number(bindingAfter.agent_version) !== Number(agentAfter.version)) {
    await retellRequest("PATCH", `/update-phone-number/${encodeURIComponent(env.RETELL_PHONE_NUMBER)}`, {
      inbound_agents: [{ agent_id: INBOUND_AGENT_ID, agent_version: agentAfter.version, weight: 1 }],
    });
  }

  const phoneFinal = await retellRequest<AnyRecord>("GET", `/get-phone-number/${encodeURIComponent(env.RETELL_PHONE_NUMBER)}`);
  const report = {
    created_at: new Date().toISOString(),
    production_base_url: productionBaseUrl,
    webhook_url: webhookUrl,
    live_agent_id: INBOUND_AGENT_ID,
    old_conversation_flow_agent_id: OLD_CONVERSATION_FLOW_AGENT_ID,
    target_version: agentAfter.version,
    backups,
    phone_binding_before: phoneBefore.inbound_agents,
    phone_binding_after: phoneFinal.inbound_agents,
    settings_before: {
      voice_id: agentBefore.voice_id,
      voice_model: agentBefore.voice_model,
      voice_speed: agentBefore.voice_speed,
      interruption_sensitivity: agentBefore.interruption_sensitivity,
      responsiveness: agentBefore.responsiveness,
      enable_dynamic_responsiveness: agentBefore.enable_dynamic_responsiveness,
      enable_dynamic_voice_speed: agentBefore.enable_dynamic_voice_speed,
      ambient_sound: agentBefore.ambient_sound,
      ambient_sound_volume: agentBefore.ambient_sound_volume,
      handbook_config: agentBefore.handbook_config,
    },
    settings_after: {
      voice_id: agentAfter.voice_id,
      voice_model: agentAfter.voice_model,
      voice_speed: agentAfter.voice_speed,
      interruption_sensitivity: agentAfter.interruption_sensitivity,
      responsiveness: agentAfter.responsiveness,
      enable_dynamic_responsiveness: agentAfter.enable_dynamic_responsiveness,
      enable_dynamic_voice_speed: agentAfter.enable_dynamic_voice_speed,
      ambient_sound: agentAfter.ambient_sound,
      ambient_sound_volume: agentAfter.ambient_sound_volume,
      handbook_config: agentAfter.handbook_config,
    },
    llm_after: {
      llm_id: llmAfterUpdate.llm_id ?? llmAfter.llm_id,
      version: llmAfter.version,
      model: llmAfter.model,
      model_temperature: llmAfter.model_temperature,
      begin_message: llmAfter.begin_message,
      knowledge_base_ids: llmAfter.knowledge_base_ids,
      kb_config: llmAfter.kb_config,
      prompt_length_characters: String(llmAfter.general_prompt ?? "").length,
      tools: publicToolSummary(llmAfter),
    },
    no_sms_booking_tool_attached: !(llmAfter.general_tools ?? []).some((tool: AnyRecord) => tool.name === "send_booking_sms"),
    duplicate_post_call_names: (agentAfter.post_call_analysis_data ?? [])
      .map((item: AnyRecord) => item?.name)
      .filter((name: string, index: number, names: string[]) => name && names.indexOf(name) !== index),
  };

  await writeJson(path.resolve("generated", "inbound-finalize-report.json"), report);
  console.log(
    JSON.stringify(
      {
        agent_id: INBOUND_AGENT_ID,
        published_version: agentAfter.version,
        phone_binding: phoneFinal.inbound_agents,
        voice_id: agentAfter.voice_id,
        voice_model: agentAfter.voice_model,
        interruption_sensitivity_before: interruptionBefore,
        interruption_sensitivity_after: agentAfter.interruption_sensitivity,
        no_sms_booking_tool_attached: report.no_sms_booking_tool_attached,
        duplicate_post_call_names: report.duplicate_post_call_names,
        report: "generated/inbound-finalize-report.json",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
