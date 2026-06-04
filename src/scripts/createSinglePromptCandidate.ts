import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import {
  candidateCalComConfigFromEnv,
  getCandidateCalendarAdapter,
} from "../services/calendar";
import { buildSinglePromptCandidatePrompt, DEMO_PEST_KB_ID, DEMO_PEST_KB_NAME } from "../retell/singlePromptCandidatePrompt";
import { getRetellClient } from "../retell/retellClient";
import { buildCustomToolDefinitions, buildRetellControlTools } from "../retell/tools";

type AnyRecord = Record<string, any>;

const LIVE_AGENT_ID = "agent_1e77470887528d657c5ad62d4d";
const LIVE_FLOW_ID = "conversation_flow_ac54a9df6510";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function redact(value: string) {
  return value ? "<set>" : "<missing>";
}

function sanitizedError(error: unknown): string {
  let raw = error instanceof Error ? error.message : String(error);
  for (const secret of [
    env.RETELL_API_KEY,
    env.RETELL_WEBHOOK_SECRET_OR_API_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_DB_URL,
    env.CALCOM_API_KEY,
  ].filter(Boolean)) {
    raw = raw.replaceAll(secret, "<redacted>");
  }
  return raw;
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function backupJson(stamp: string, name: string, value: unknown) {
  const outputPath = path.resolve(process.cwd(), "generated", "backups", `${stamp}-${name}.json`);
  await writeJson(outputPath, value);
  return outputPath;
}

async function publishAgentVersion(agentId: string, version: number) {
  const baseUrl = process.env.RETELL_BASE_URL || "https://api.retellai.com";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/publish-agent-version/${agentId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RETELL_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "*/*",
    },
    body: JSON.stringify({ version, version_description: "Single prompt candidate initial publish" }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Direct publish failed HTTP ${response.status} ${body}`);
  }
}

function postCallAnalysisData() {
  return [
    { type: "string", name: "caller_name", description: "Caller first name or full name.", required: false },
    { type: "string", name: "caller_phone", description: "Best phone number for the caller.", required: false },
    { type: "string", name: "alternate_phone", description: "Alternate callback or text number if provided.", required: false },
    { type: "string", name: "pest_issue", description: "The pest issue discussed.", required: false },
    { type: "string", name: "property_address", description: "Property address or partial address.", required: false },
    { type: "string", name: "preferred_datetime", description: "Preferred appointment date/time.", required: false },
    {
      type: "enum",
      name: "urgency_level",
      description: "Urgency level detected from the call.",
      choices: ["low", "medium", "high", "emergency"],
      required: false,
    },
    {
      type: "enum",
      name: "booking_method",
      description: "Booking path chosen by the caller.",
      choices: ["phone_booking", "sms_link", "transfer", "callback", "unknown"],
      required: false,
    },
    { type: "boolean", name: "sms_sent", description: "Whether SMS was actually sent.", required: false },
    { type: "boolean", name: "sms_simulated", description: "Whether SMS was simulated.", required: false },
    { type: "boolean", name: "appointment_confirmed", description: "Whether Cal.com confirmed booking.", required: false },
    { type: "boolean", name: "transfer_requested", description: "Whether transfer was requested or required.", required: false },
    { type: "string", name: "call_summary", description: "Short operational call summary.", required: false },
    {
      type: "enum",
      name: "call_outcome",
      description: "Primary call outcome.",
      choices: [
        "real_appointment_booked",
        "phone_booking_requested",
        "sms_booking_simulated",
        "lead_captured",
        "transferred",
        "callback_needed",
        "wrong_number",
        "unsupported",
        "hostile_ended",
      ],
      required: false,
    },
  ];
}

function pickAgentSettings(source: AnyRecord) {
  const fields = [
    "voice_id",
    "voice_model",
    "voice_speed",
    "voice_temperature",
    "ambient_sound",
    "ambient_sound_volume",
    "enable_dynamic_voice_speed",
    "enable_dynamic_responsiveness",
    "enable_backchannel",
    "backchannel_frequency",
    "backchannel_words",
    "responsiveness",
    "interruption_sensitivity",
    "denoising_mode",
    "stt_mode",
    "end_call_after_silence_ms",
    "max_call_duration_ms",
    "ring_duration_ms",
    "begin_message_delay_ms",
    "allow_user_dtmf",
    "allow_dtmf_interruption",
    "handbook_config",
    "normalize_for_speech",
    "webhook_events",
    "webhook_timeout_ms",
    "language",
    "timezone",
  ];
  const settings: AnyRecord = {};
  for (const field of fields) {
    if (source[field] !== undefined) settings[field] = source[field];
  }

  return {
    ...settings,
    voice_id: "11labs-Cimo",
    voice_model: "eleven_v3",
    voice_speed: 1.12,
    ambient_sound: source.ambient_sound ?? "coffee-shop",
    ambient_sound_volume: source.ambient_sound_volume ?? 1,
    enable_dynamic_voice_speed: source.enable_dynamic_voice_speed ?? true,
    enable_dynamic_responsiveness: false,
    responsiveness: source.responsiveness ?? 0.95,
    interruption_sensitivity: source.interruption_sensitivity ?? 0.75,
    denoising_mode: "noise-and-background-speech-cancellation",
    stt_mode: source.stt_mode ?? "accurate",
    end_call_after_silence_ms: source.end_call_after_silence_ms ?? 120000,
    max_call_duration_ms: source.max_call_duration_ms ?? 1020000,
    ring_duration_ms: source.ring_duration_ms ?? 20000,
    timezone: env.DEFAULT_BUSINESS_TIMEZONE,
    language: source.language ?? "en-US",
  };
}

function promptLength(prompt: string) {
  return {
    characters: prompt.length,
    estimated_tokens_chars_div_4: Math.ceil(prompt.length / 4),
  };
}

async function maybeReadGeneratedConfig(name: string) {
  const filePath = path.resolve(process.cwd(), "generated", name);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function checkPublicHealth() {
  if (!env.PUBLIC_BASE_URL) return { checked: false, ok: false, status: null, error: "PUBLIC_BASE_URL is missing." };
  try {
    const response = await fetch(`${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(10000),
    });
    return { checked: true, ok: response.ok, status: response.status, error: null };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const client = getRetellClient();
  const stamp = timestamp();
  const report: AnyRecord = {
    created_at: new Date().toISOString(),
    candidate_readiness: "NOT_READY",
    ready_for_phone_reassignment: false,
    blockers: [] as string[],
    warnings: [] as string[],
    live_agent_preserved: true,
    live_agent_id_expected: LIVE_AGENT_ID,
    live_flow_id_expected: LIVE_FLOW_ID,
    env_status: {
      RETELL_API_KEY: redact(env.RETELL_API_KEY),
      RETELL_AGENT_ID: env.RETELL_AGENT_ID,
      RETELL_CONVERSATION_FLOW_ID: env.RETELL_CONVERSATION_FLOW_ID,
      RETELL_PHONE_NUMBER: env.RETELL_PHONE_NUMBER ? "<set>" : "<missing>",
      PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
      TOOLS_BASE_URL: env.TOOLS_BASE_URL,
      RETELL_WEBHOOK_URL: env.RETELL_WEBHOOK_URL,
      CALCOM_API_KEY: redact(env.CALCOM_API_KEY),
      CALCOM_EVENT_TYPE_ID: env.CALCOM_EVENT_TYPE_ID ? "<set>" : "<missing>",
      CALCOM_USERNAME: env.CALCOM_USERNAME ? "<set>" : "<missing>",
      CALCOM_EVENT_SLUG: env.CALCOM_EVENT_SLUG ? "<set>" : "<missing>",
      BOOKING_URL: env.BOOKING_URL ? "<set>" : "<missing>",
      BOOKING_PLACEHOLDER_EMAIL: env.BOOKING_PLACEHOLDER_EMAIL,
      SMS_MODE: env.SMS_MODE,
      RETELL_SMS_NODE_ENABLED: env.RETELL_SMS_NODE_ENABLED,
      RETELL_OUTBOUND_SMS_ENABLED: env.RETELL_OUTBOUND_SMS_ENABLED,
      CALENDAR_PROVIDER: env.CALENDAR_PROVIDER,
    },
  };

  if (env.RETELL_AGENT_ID !== LIVE_AGENT_ID) {
    throw new Error(`RETELL_AGENT_ID must remain ${LIVE_AGENT_ID}; found ${env.RETELL_AGENT_ID || "<missing>"}`);
  }
  if (env.RETELL_CONVERSATION_FLOW_ID !== LIVE_FLOW_ID) {
    throw new Error(`RETELL_CONVERSATION_FLOW_ID must remain ${LIVE_FLOW_ID}; found ${env.RETELL_CONVERSATION_FLOW_ID || "<missing>"}`);
  }
  if (!env.RETELL_PHONE_NUMBER) throw new Error("RETELL_PHONE_NUMBER is required for live binding safety readback.");

  report.public_health = await checkPublicHealth();
  if (!report.public_health.ok) {
    report.warnings.push("PUBLIC_BASE_URL /health is not reachable. Candidate was still created, but tool/webhook testing needs the backend/ngrok running.");
  }

  const [liveAgent, liveFlow, livePhone] = (await Promise.all([
    client.agent.retrieve(LIVE_AGENT_ID),
    client.conversationFlow.retrieve(LIVE_FLOW_ID),
    client.phoneNumber.retrieve(env.RETELL_PHONE_NUMBER),
  ])) as AnyRecord[];

  const activeBinding = (livePhone.inbound_agents ?? []).find((binding: AnyRecord) => binding.agent_id === LIVE_AGENT_ID);
  if (!activeBinding) throw new Error("Phone binding does not point to the current live agent; refusing to create candidate.");

  report.live_readback = {
    agent_id: liveAgent.agent_id,
    agent_version: liveAgent.version,
    agent_published: liveAgent.is_published,
    response_engine: liveAgent.response_engine,
    flow_id: liveFlow.conversation_flow_id,
    flow_version: liveFlow.version,
    phone_binding: { inbound_agents: livePhone.inbound_agents },
  };
  report.backups = {
    live_agent: await backupJson(stamp, `${LIVE_AGENT_ID}-before-single-prompt-candidate`, liveAgent),
    live_flow: await backupJson(stamp, `${LIVE_FLOW_ID}-before-single-prompt-candidate`, liveFlow),
    phone_binding: await backupJson(stamp, `${env.RETELL_PHONE_NUMBER.replace(/^\+/, "")}-phone-before-single-prompt-candidate`, livePhone),
    retell_agent_config: await backupJson(stamp, "retell-agent-config-before-single-prompt-candidate", await maybeReadGeneratedConfig("retell-agent-config.json")),
    retell_flow_config: await backupJson(
      stamp,
      "retell-conversation-flow-config-before-single-prompt-candidate",
      await maybeReadGeneratedConfig("retell-conversation-flow-config.json"),
    ),
  };

  let kbAttached = false;
  try {
    const kb = (await client.knowledgeBase.retrieve(DEMO_PEST_KB_ID)) as AnyRecord;
    kbAttached = true;
    report.knowledge_base = {
      requested_id: DEMO_PEST_KB_ID,
      requested_name: DEMO_PEST_KB_NAME,
      retrieved: true,
      retrieved_id: kb.knowledge_base_id,
      retrieved_name: kb.knowledge_base_name,
      status: kb.status,
      title_matches: kb.knowledge_base_name === DEMO_PEST_KB_NAME,
    };
    if (kb.knowledge_base_name !== DEMO_PEST_KB_NAME) {
      report.warnings.push(`Knowledge base ID retrieved, but name was "${kb.knowledge_base_name}" instead of "${DEMO_PEST_KB_NAME}".`);
      report.blockers.push("Demo Pest KB title did not match expected title.");
    }
  } catch (error) {
    report.knowledge_base = {
      requested_id: DEMO_PEST_KB_ID,
      requested_name: DEMO_PEST_KB_NAME,
      retrieved: false,
      error: sanitizedError(error),
    };
    report.blockers.push("Demo Pest KB could not be retrieved or attached.");
  }

  const calConfig = candidateCalComConfigFromEnv();
  report.calcom = {
    status: calConfig.status,
    usable_config: calConfig.usable,
    config_source: calConfig.config.source,
    message: calConfig.message,
    booking_url_parse_source: calConfig.config.source,
    event_identifier_present: Boolean(calConfig.config.eventTypeId || (calConfig.config.username && calConfig.config.eventSlug)),
    real_over_call_booking_verified: false,
    availability_verified: false,
  };

  let availabilityCheck = null;
  if (calConfig.usable) {
    try {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      availabilityCheck = await getCandidateCalendarAdapter().checkAvailability({
        preferred_date: tomorrow,
        preferred_time: "morning",
        timezone: env.DEFAULT_BUSINESS_TIMEZONE,
        appointment_type: "pest_control_service",
        pest_issue: "pest-control service",
      });
      report.calcom.availability_check = availabilityCheck;
      report.calcom.availability_verified = Boolean(availabilityCheck.enabled && availabilityCheck.success !== false);
      report.calcom.real_over_call_booking_verified = false;
      if (!report.calcom.availability_verified) {
        report.blockers.push("Cal.com availability check did not verify a usable event type.");
      }
    } catch (error) {
      report.calcom.availability_error = sanitizedError(error);
      report.blockers.push("Cal.com availability check failed.");
    }
  } else {
    report.blockers.push(calConfig.message);
  }

  const prompt = buildSinglePromptCandidatePrompt({
    businessName: env.DEFAULT_BUSINESS_NAME,
    timezone: env.DEFAULT_BUSINESS_TIMEZONE,
    calendarStatus: calConfig.usable
      ? "Candidate Cal.com routes are configured. Confirm appointments only after book_appointment_cal returns confirmed true."
      : "Cal.com is not verified. Capture booking requests and say the team will confirm.",
    smsStatus:
      "SMS is simulated unless send_booking_sms returns sms_sent true. In the current demo, expect sms_simulated true.",
  });

  const conversationFlowConfig = await maybeReadGeneratedConfig("retell-conversation-flow-config.json");
  const currentPrompt = JSON.stringify(conversationFlowConfig ?? liveFlow);
  report.prompt_length_comparison = {
    current_conversation_flow_config: promptLength(currentPrompt),
    single_prompt_candidate: promptLength(prompt),
    estimated_token_reduction:
      Math.ceil(currentPrompt.length / 4) > 0
        ? `${Math.max(0, Math.round((1 - prompt.length / currentPrompt.length) * 100))}%`
        : "unknown",
  };

  const baseUrl = env.TOOLS_BASE_URL || env.PUBLIC_BASE_URL;
  const llmCreatePayload: AnyRecord = {
    model: "gpt-4.1",
    model_temperature: 0.2,
    tool_call_strict_mode: true,
    start_speaker: "agent",
    begin_message: `Thanks for calling ${env.DEFAULT_BUSINESS_NAME}, this is Ava. How can I help?`,
    general_prompt: prompt,
    default_dynamic_variables: {
      business_name: env.DEFAULT_BUSINESS_NAME,
      booking_url: env.BOOKING_URL,
      booking_placeholder_email: env.BOOKING_PLACEHOLDER_EMAIL,
      transfer_number: env.RETELL_TRANSFER_PHONE_NUMBER,
    },
    general_tools: [
      ...buildCustomToolDefinitions(baseUrl, { candidateCalendar: true }),
      ...buildRetellControlTools({ quietTransferExecution: true }),
    ],
    ...(kbAttached ? { knowledge_base_ids: [DEMO_PEST_KB_ID], kb_config: { top_k: 3 } } : {}),
  };

  let llm: AnyRecord;
  try {
    llm = (await client.llm.create(llmCreatePayload as never)) as AnyRecord;
  } catch (error) {
    const message = sanitizedError(error);
    if (!/strict|tool_call_strict_mode/i.test(message)) throw error;
    report.warnings.push(`Retell rejected strict tool calling; retrying without strict mode: ${message}`);
    llm = (await client.llm.create({ ...llmCreatePayload, tool_call_strict_mode: false } as never)) as AnyRecord;
    report.blockers.push("Strict tool calling was not accepted by Retell for this candidate.");
  }

  const agentCreatePayload: AnyRecord = {
    ...pickAgentSettings(liveAgent),
    response_engine: { type: "retell-llm", llm_id: llm.llm_id },
    agent_name: "Elijah's Pest Control Single Prompt Candidate",
    version_description: "Single prompt candidate",
    webhook_url: env.RETELL_WEBHOOK_URL || undefined,
    webhook_events: liveAgent.webhook_events ?? [
      "call_started",
      "call_ended",
      "call_analyzed",
      "transcript_updated",
      "transfer_started",
      "transfer_bridged",
      "transfer_cancelled",
      "transfer_ended",
    ],
    webhook_timeout_ms: liveAgent.webhook_timeout_ms ?? 10000,
    post_call_analysis_data: postCallAnalysisData(),
    analysis_summary_prompt:
      "Summarize pest issue, address if given, booking path, Cal.com result, SMS state, transfer state, and next step in two concise sentences.",
    analysis_user_sentiment_prompt: "Classify user sentiment as positive, neutral, negative, distressed, or hostile.",
  };

  const candidateAgent = (await client.agent.create(agentCreatePayload as never)) as AnyRecord;
  await publishAgentVersion(candidateAgent.agent_id, candidateAgent.version);

  const [candidateReadback, phoneAfter] = (await Promise.all([
    client.agent.retrieve(candidateAgent.agent_id),
    client.phoneNumber.retrieve(env.RETELL_PHONE_NUMBER),
  ])) as AnyRecord[];

  const candidateBound = (phoneAfter.inbound_agents ?? []).some((binding: AnyRecord) => binding.agent_id === candidateAgent.agent_id);
  const liveStillBound = (phoneAfter.inbound_agents ?? []).some((binding: AnyRecord) => binding.agent_id === LIVE_AGENT_ID);

  report.candidate = {
    agent_id: candidateAgent.agent_id,
    llm_id: llm.llm_id,
    agent_version: candidateReadback.version,
    published: candidateReadback.is_published,
    model: llm.model ?? "gpt-4.1",
    response_engine: candidateReadback.response_engine,
    phone_bound: candidateBound,
    voice_settings: {
      voice_id: candidateReadback.voice_id,
      voice_model: candidateReadback.voice_model,
      voice_speed: candidateReadback.voice_speed,
      enable_dynamic_voice_speed: candidateReadback.enable_dynamic_voice_speed,
      enable_dynamic_responsiveness: candidateReadback.enable_dynamic_responsiveness,
      ambient_sound: candidateReadback.ambient_sound,
      ambient_sound_volume: candidateReadback.ambient_sound_volume,
      responsiveness: candidateReadback.responsiveness,
      interruption_sensitivity: candidateReadback.interruption_sensitivity,
      denoising_mode: candidateReadback.denoising_mode,
      stt_mode: candidateReadback.stt_mode,
      handbook_config: candidateReadback.handbook_config,
    },
    tool_urls: buildCustomToolDefinitions(baseUrl, { candidateCalendar: true }).map((tool) => ({
      name: tool.name,
      url: tool.url,
    })),
  };
  report.live_after_candidate_creation = {
    live_still_bound: liveStillBound,
    candidate_bound: candidateBound,
    phone_binding: { inbound_agents: phoneAfter.inbound_agents },
  };

  if (!candidateReadback.is_published) report.blockers.push("Candidate agent was created but not published.");
  if (candidateBound) report.blockers.push("Candidate is unexpectedly phone-bound.");
  if (!liveStillBound) report.blockers.push("Live phone binding no longer points to the current live agent.");
  if (!report.calcom.availability_verified) {
    report.blockers.push("Real Cal.com over-call booking is not verified. No real booking was created without user approval.");
  } else {
    report.warnings.push("Cal.com availability is verified, but no real booking was created without explicit approval.");
    report.blockers.push("Controlled real Cal.com booking test still needs user approval before phone reassignment.");
  }

  report.candidate_readiness =
    candidateReadback.is_published && !candidateBound && kbAttached && report.calcom.availability_verified
      ? "READY_FOR_CANDIDATE_TESTING"
      : "NOT_READY";
  report.ready_for_phone_reassignment = false;
  report.next_step_before_phone_reassignment =
    "Approve and run a controlled real Cal.com booking test, then run the full candidate batch/live test before binding the phone number.";

  const outputPath = path.resolve(process.cwd(), "generated", "single-prompt-candidate-report.json");
  await writeJson(outputPath, report);

  console.log(
    JSON.stringify(
      {
        output_path: outputPath,
        candidate_readiness: report.candidate_readiness,
        ready_for_phone_reassignment: report.ready_for_phone_reassignment,
        live_agent_still_bound: liveStillBound,
        candidate_agent_id: candidateAgent.agent_id,
        candidate_llm_id: llm.llm_id,
        candidate_model: report.candidate.model,
        candidate_phone_bound: candidateBound,
        demo_pest_kb_attached: kbAttached,
        calcom_availability_verified: report.calcom.availability_verified,
        blockers: report.blockers,
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  const outputPath = path.resolve(process.cwd(), "generated", "single-prompt-candidate-report.json");
  const failure = {
    created_at: new Date().toISOString(),
    candidate_readiness: "NOT_READY",
    ready_for_phone_reassignment: false,
    error: sanitizedError(error),
  };
  await writeJson(outputPath, failure);
  console.error(JSON.stringify({ output_path: outputPath, error: failure.error }, null, 2));
  process.exitCode = 1;
});
