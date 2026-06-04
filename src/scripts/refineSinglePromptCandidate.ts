import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import {
  candidateCalComConfigFromEnv,
  getCandidateCalendarAdapter,
} from "../services/calendar";
import { buildSinglePromptCandidatePrompt, DEMO_PEST_KB_ID } from "../retell/singlePromptCandidatePrompt";
import { getRetellClient } from "../retell/retellClient";
import { buildCustomToolDefinitions, buildNativeCalComTools, buildRetellControlTools } from "../retell/tools";

type AnyRecord = Record<string, any>;

const LIVE_AGENT_ID = "agent_1e77470887528d657c5ad62d4d";
const CANDIDATE_AGENT_ID = "agent_16b324c0e55f21c0a5f914c169";
const CANDIDATE_LLM_ID = "llm_e8bb285e8cb0fc562f06e2395a78";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function redactError(error: unknown): string {
  let raw = error instanceof Error ? `${error.message}${error.stack ? `\n${error.stack}` : ""}` : String(error);
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

function productionBaseUrl() {
  const explicit = process.env.CANDIDATE_BASE_URL || process.env.PRODUCTION_BASE_URL || "";
  if (!explicit) {
    throw new Error("Set CANDIDATE_BASE_URL to the verified Vercel/domain backend URL before refining the candidate.");
  }
  if (!/^https:\/\//.test(explicit)) throw new Error("CANDIDATE_BASE_URL must be an HTTPS URL.");
  return explicit.replace(/\/$/, "");
}

function hasNgrok(value: unknown) {
  return JSON.stringify(value).includes("ngrok-free.app");
}

async function publicHealth(baseUrl: string) {
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10000) });
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: body.slice(0, 500),
  };
}

function promptLength(prompt: string) {
  return {
    characters: prompt.length,
    estimated_tokens_chars_div_4: Math.ceil(prompt.length / 4),
  };
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
      name: "booking_method",
      description: "Booking path chosen by the caller.",
      choices: ["phone_booking", "sms_link", "transfer", "callback", "unknown"],
      required: false,
    },
    { type: "boolean", name: "sms_sent", description: "Whether SMS was actually sent.", required: false },
    { type: "boolean", name: "sms_simulated", description: "Whether SMS was simulated.", required: false },
    { type: "boolean", name: "appointment_confirmed", description: "Whether Cal.com confirmed booking.", required: false },
    { type: "string", name: "call_summary", description: "Short operational call summary.", required: false },
  ];
}

function uniquePostCallAnalysisData(existing: unknown) {
  const source = Array.isArray(existing) && existing.length > 0 ? existing : postCallAnalysisData();
  const seen = new Set<string>();
  return source.filter((item: AnyRecord) => {
    const name = item?.name;
    if (typeof name !== "string") return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

async function publishAgent(agentId: string, version: number) {
  const baseUrl = process.env.RETELL_BASE_URL || "https://api.retellai.com";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/publish-agent-version/${agentId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RETELL_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "*/*",
    },
    body: JSON.stringify({
      version,
      version_description: "Candidate Vercel URL, fixed responsiveness, and echo verification",
    }),
  });
  if (!response.ok) {
    throw new Error(`Direct publish failed HTTP ${response.status}: ${await response.text()}`);
  }
}

async function main() {
  const client = getRetellClient() as AnyRecord;
  const stamp = timestamp();
  const baseUrl = productionBaseUrl();
  const webhookUrl = `${baseUrl}/retell/webhook`;

  const health = await publicHealth(baseUrl);
  if (!health.ok) throw new Error(`Production health failed at ${baseUrl}/health with status ${health.status}`);

  const [phoneBefore, liveAgent, candidateAgent, candidateLlm] = (await Promise.all([
    client.phoneNumber.retrieve(env.RETELL_PHONE_NUMBER),
    client.agent.retrieve(LIVE_AGENT_ID),
    client.agent.retrieve(CANDIDATE_AGENT_ID),
    client.llm.retrieve(CANDIDATE_LLM_ID),
  ])) as AnyRecord[];

  const liveBinding = (phoneBefore.inbound_agents ?? []).find((binding: AnyRecord) => binding.agent_id === LIVE_AGENT_ID);
  const candidateBinding = (phoneBefore.inbound_agents ?? []).find((binding: AnyRecord) => binding.agent_id === CANDIDATE_AGENT_ID);
  if (!liveBinding) throw new Error("Live phone binding no longer points to the live agent; refusing candidate mutation.");
  if (candidateBinding) throw new Error("Candidate is unexpectedly phone-bound; refusing mutation.");

  const backups = {
    phone_before: await backupJson(stamp, "phone-before-candidate-vercel-refine", phoneBefore),
    live_agent_before: await backupJson(stamp, `${LIVE_AGENT_ID}-readback-before-candidate-vercel-refine`, liveAgent),
    candidate_agent_before: await backupJson(stamp, `${CANDIDATE_AGENT_ID}-before-vercel-refine`, candidateAgent),
    candidate_llm_before: await backupJson(stamp, `${CANDIDATE_LLM_ID}-before-vercel-refine`, candidateLlm),
  };

  const calConfig = candidateCalComConfigFromEnv();
  const availability = calConfig.usable
    ? await getCandidateCalendarAdapter().checkAvailability({
        preferred_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        preferred_time: "morning",
        timezone: env.DEFAULT_BUSINESS_TIMEZONE,
        appointment_type: "pest_control_service",
        pest_issue: "pest-control service",
      })
    : null;

  const prompt = buildSinglePromptCandidatePrompt({
    businessName: env.DEFAULT_BUSINESS_NAME,
    timezone: env.DEFAULT_BUSINESS_TIMEZONE,
    calendarStatus: availability?.success === true
      ? "Candidate Cal.com availability is verified. Echo-verify before booking and confirm only after book_appointment_cal returns confirmed true."
      : "Cal.com booking is not fully verified. Save booking requests and say the team will follow up unless booking confirms.",
    smsStatus: "SMS remains simulated unless send_booking_sms returns sms_sent true.",
  });

  const toolDefinitions = [
    ...buildCustomToolDefinitions(baseUrl, { candidateCalendar: false }).filter(
      (tool) => !["check_availability_cal", "book_appointment_cal"].includes(tool.name),
    ),
    ...buildRetellControlTools({ quietTransferExecution: true }),
    ...buildNativeCalComTools(),
  ];

  const draftAgent = await client.agent.createVersion(CANDIDATE_AGENT_ID, {
    base_version: candidateAgent.version,
  });
  const targetVersion = draftAgent.version;

  let llmAfter: AnyRecord;
  let llmUpdateMode = "updated_existing_llm";
  try {
    llmAfter = await client.llm.update(CANDIDATE_LLM_ID, {
      version: targetVersion,
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
      general_tools: toolDefinitions,
      knowledge_base_ids: [DEMO_PEST_KB_ID],
      kb_config: { top_k: 3 },
    });
  } catch (error) {
    llmUpdateMode = `failed_existing_llm_update: ${redactError(error)}`;
    throw error;
  }

  await client.agent.update(CANDIDATE_AGENT_ID, {
    version: targetVersion,
    agent_name: candidateAgent.agent_name,
    response_engine: {
      type: "retell-llm",
      llm_id: llmAfter.llm_id,
      version: targetVersion,
    },
    webhook_url: webhookUrl,
    webhook_events: candidateAgent.webhook_events,
    webhook_timeout_ms: candidateAgent.webhook_timeout_ms,
    voice_id: "11labs-Cimo",
    voice_model: "eleven_v3",
    voice_speed: 1.12,
    enable_dynamic_voice_speed: candidateAgent.enable_dynamic_voice_speed ?? true,
    enable_dynamic_responsiveness: false,
    responsiveness: 0.95,
    ambient_sound: "coffee-shop",
    ambient_sound_volume: 1,
    interruption_sensitivity: candidateAgent.interruption_sensitivity ?? 0.75,
    denoising_mode: candidateAgent.denoising_mode ?? "noise-and-background-speech-cancellation",
    stt_mode: candidateAgent.stt_mode ?? "accurate",
    end_call_after_silence_ms: candidateAgent.end_call_after_silence_ms ?? 120000,
    max_call_duration_ms: candidateAgent.max_call_duration_ms ?? 1020000,
    ring_duration_ms: candidateAgent.ring_duration_ms ?? 20000,
    handbook_config: candidateAgent.handbook_config,
    post_call_analysis_data: uniquePostCallAnalysisData(candidateAgent.post_call_analysis_data),
    analysis_summary_prompt: candidateAgent.analysis_summary_prompt,
    analysis_user_sentiment_prompt: candidateAgent.analysis_user_sentiment_prompt,
    timezone: candidateAgent.timezone ?? env.DEFAULT_BUSINESS_TIMEZONE,
    language: candidateAgent.language ?? "en-US",
    version_description: "Candidate Vercel URL, fixed responsiveness, and echo verification",
  });

  await publishAgent(CANDIDATE_AGENT_ID, targetVersion);

  const [candidateAfter, llmReadback, phoneAfter] = (await Promise.all([
    client.agent.retrieve(CANDIDATE_AGENT_ID),
    client.llm.retrieve(llmAfter.llm_id),
    client.phoneNumber.retrieve(env.RETELL_PHONE_NUMBER),
  ])) as AnyRecord[];

  const report = {
    created_at: new Date().toISOString(),
    base_url: baseUrl,
    webhook_url: webhookUrl,
    health,
    live_agent_unchanged: true,
    live_phone_binding_before: phoneBefore.inbound_agents,
    live_phone_binding_after: phoneAfter.inbound_agents,
    candidate_phone_bound_after: (phoneAfter.inbound_agents ?? []).some((binding: AnyRecord) => binding.agent_id === CANDIDATE_AGENT_ID),
    backups,
    llm_update_mode: llmUpdateMode,
    candidate_before: {
      agent_id: candidateAgent.agent_id,
      version: candidateAgent.version,
      webhook_url: candidateAgent.webhook_url,
      response_engine: candidateAgent.response_engine,
      voice_id: candidateAgent.voice_id,
      voice_model: candidateAgent.voice_model,
      voice_speed: candidateAgent.voice_speed,
      enable_dynamic_voice_speed: candidateAgent.enable_dynamic_voice_speed,
      enable_dynamic_responsiveness: candidateAgent.enable_dynamic_responsiveness,
      responsiveness: candidateAgent.responsiveness,
    },
    candidate_after: {
      agent_id: candidateAfter.agent_id,
      version: candidateAfter.version,
      is_published: candidateAfter.is_published,
      webhook_url: candidateAfter.webhook_url,
      response_engine: candidateAfter.response_engine,
      voice_id: candidateAfter.voice_id,
      voice_model: candidateAfter.voice_model,
      voice_speed: candidateAfter.voice_speed,
      enable_dynamic_voice_speed: candidateAfter.enable_dynamic_voice_speed,
      enable_dynamic_responsiveness: candidateAfter.enable_dynamic_responsiveness,
      responsiveness: candidateAfter.responsiveness,
      ambient_sound: candidateAfter.ambient_sound,
      ambient_sound_volume: candidateAfter.ambient_sound_volume,
    },
    llm_after: {
      llm_id: llmReadback.llm_id,
      version: llmReadback.version,
      model: llmReadback.model,
      model_temperature: llmReadback.model_temperature,
      tool_call_strict_mode: llmReadback.tool_call_strict_mode,
      knowledge_base_ids: llmReadback.knowledge_base_ids,
      kb_config: llmReadback.kb_config,
      has_ngrok: hasNgrok(llmReadback),
      tools: (llmReadback.general_tools ?? []).map((tool: AnyRecord) => ({
        name: tool.name,
        type: tool.type,
        url: tool.url ?? null,
        event_type_id: tool.event_type_id ?? null,
        timezone: tool.timezone ?? null,
      })),
      tool_urls: (llmReadback.general_tools ?? [])
        .filter((tool: AnyRecord) => tool.url)
        .map((tool: AnyRecord) => ({ name: tool.name, url: tool.url })),
    },
    calcom: {
      config_status: calConfig.status,
      availability,
      real_booking_created: false,
      real_booking_verification: "not_run_without_user_approval",
    },
    prompt_length: promptLength(prompt),
    ready_for_phone_reassignment: false,
  };

  await writeJson(path.resolve(process.cwd(), "generated", "single-prompt-candidate-report.json"), report);
  await writeJson(path.resolve(process.cwd(), "generated", `single-prompt-candidate-vercel-refine-${stamp}.json`), report);

  console.log(
    JSON.stringify(
      {
        base_url: baseUrl,
        candidate_agent_id: CANDIDATE_AGENT_ID,
        candidate_version: candidateAfter.version,
        candidate_llm_id: llmReadback.llm_id,
        candidate_phone_bound: report.candidate_phone_bound_after,
        dynamic_responsiveness: candidateAfter.enable_dynamic_responsiveness,
        responsiveness: candidateAfter.responsiveness,
        has_ngrok_in_llm: report.llm_after.has_ngrok,
        real_booking_created: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(redactError(error));
  process.exit(1);
});
