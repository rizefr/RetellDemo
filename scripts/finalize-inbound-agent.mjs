import fs from "node:fs";
import path from "node:path";

const INBOUND_AGENT_ID = "agent_16b324c0e55f21c0a5f914c169";
const INBOUND_LLM_ID = "llm_e8bb285e8cb0fc562f06e2395a78";
const OLD_CONVERSATION_FLOW_AGENT_ID = "agent_1e77470887528d657c5ad62d4d";
const DEMO_PEST_KB_ID = "knowledge_base_5c6a5b20b1a9ed4f";

function loadEnv() {
  const env = { ...process.env };
  if (!fs.existsSync(".env")) return env;
  for (const line of fs.readFileSync(".env", "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!(key in env)) env[key] = value;
  }
  return env;
}

const env = loadEnv();

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function productionBaseUrl() {
  const value = env.INBOUND_BASE_URL || env.APP_BASE_URL || env.PUBLIC_BASE_URL;
  if (!value || !/^https:\/\//.test(value)) {
    throw new Error("APP_BASE_URL or INBOUND_BASE_URL must be the production HTTPS backend URL.");
  }
  return value.replace(/\/$/, "");
}

function redact(value) {
  let output = String(value);
  for (const secret of [env.RETELL_API_KEY, env.CALCOM_API_KEY, env.RETELL_WEBHOOK_SECRET_OR_API_KEY].filter(Boolean)) {
    output = output.replaceAll(secret, "<redacted>");
  }
  return output;
}

async function retell(method, endpoint, body) {
  console.error(`[retell] ${method} ${endpoint.split("?")[0]}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`https://api.retellai.com${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.RETELL_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${endpoint} failed HTTP ${response.status}: ${redact(text.slice(0, 800))}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function backup(stamp, name, value) {
  const filePath = path.resolve("generated", "backups", `${stamp}-${name}.json`);
  writeJson(filePath, value);
  return filePath;
}

function toolUrl(baseUrl, route) {
  return `${baseUrl}/tools/${route}`;
}

function customTools(baseUrl) {
  return [
    {
      type: "custom",
      name: "check_service_area",
      tool_id: "tool_check_service_area",
      description: "Check whether a city, ZIP, or state appears in the pest-control company's filled-in KB service area.",
      url: toolUrl(baseUrl, "check-service-area"),
      method: "POST",
      args_at_root: true,
      timeout_ms: 10000,
      speak_during_execution: false,
      speak_after_execution: true,
      parameters: {
        type: "object",
        properties: {
          zip_code: { type: "string", nullable: true },
          city: { type: "string", nullable: true },
          state: { type: "string", nullable: true },
        },
        required: [],
      },
    },
    {
      type: "custom",
      name: "create_lead",
      tool_id: "tool_create_lead",
      description: "Save a meaningful inbound pest-control caller as a lead or booking follow-up request.",
      url: toolUrl(baseUrl, "create-lead"),
      method: "POST",
      args_at_root: true,
      timeout_ms: 15000,
      speak_during_execution: false,
      speak_after_execution: true,
      response_variables: {
        lead_id: "$.lead_id",
        normalized_caller_phone: "$.caller_phone",
      },
      parameters: {
        type: "object",
        properties: {
          caller_name: { type: "string" },
          caller_phone: { type: "string", default: "{{user_number}}" },
          alternate_phone: { type: "string", nullable: true },
          pest_issue: { type: "string" },
          urgency_level: { type: "string", enum: ["low", "medium", "high", "emergency"] },
          preferred_booking_method: { type: "string", enum: ["phone_booking", "transfer", "callback", "unknown"] },
          service_area: { type: "string", nullable: true },
          zip_code: { type: "string", nullable: true },
          property_address: { type: "string", nullable: true },
          property_street: { type: "string", nullable: true },
          property_city: { type: "string", nullable: true },
          property_state: { type: "string", nullable: true },
          property_zip: { type: "string", nullable: true },
          preferred_datetime: { type: "string", nullable: true },
          call_summary: { type: "string" },
          retell_call_id: { type: "string", nullable: true, default: "{{call_id}}" },
          source: { type: "string", const: "retell_voice_agent" },
        },
        required: ["caller_name", "caller_phone", "pest_issue", "urgency_level", "preferred_booking_method"],
      },
    },
    {
      type: "custom",
      name: "log_transfer_request",
      tool_id: "tool_log_transfer_request",
      description: "Log an urgent, escalated, complaint, billing, or repeated live-person transfer request when time allows.",
      url: toolUrl(baseUrl, "transfer-call"),
      method: "POST",
      args_at_root: true,
      timeout_ms: 10000,
      speak_during_execution: false,
      speak_after_execution: false,
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          caller_name: { type: "string", nullable: true },
          caller_phone: { type: "string", nullable: true, default: "{{user_number}}" },
          pest_issue: { type: "string", nullable: true },
          urgency_level: { type: "string", enum: ["medium", "high", "emergency"] },
          retell_call_id: { type: "string", nullable: true, default: "{{call_id}}" },
        },
        required: ["reason", "urgency_level"],
      },
    },
  ];
}

function controlTools() {
  return [
    {
      type: "transfer_call",
      name: "transfer_call",
      description: "Transfer urgent, unsafe, complaint, billing, repeated live-person, or escalated calls.",
      transfer_destination: {
        type: "predefined",
        number: env.RETELL_TRANSFER_PHONE_NUMBER || "{{transfer_number}}",
      },
      transfer_option: {
        type: "cold_transfer",
        cold_transfer_mode: "sip_invite",
        show_transferee_as_caller: false,
        transfer_ring_duration_ms: 45000,
      },
      speak_during_execution: false,
    },
    {
      type: "end_call",
      name: "end_call",
      description: "End after the clean closing line has been said.",
      speak_during_execution: false,
    },
  ];
}

function nativeCalTools() {
  if (!env.CALCOM_API_KEY || !env.CALCOM_EVENT_TYPE_ID) return [];
  const eventTypeId = Number.isNaN(Number(env.CALCOM_EVENT_TYPE_ID)) ? env.CALCOM_EVENT_TYPE_ID : Number(env.CALCOM_EVENT_TYPE_ID);
  return [
    {
      type: "check_availability_cal",
      name: "check_availability_cal",
      description: "Retell native Cal.com availability check. Use after intake and before offering slots.",
      cal_api_key: env.CALCOM_API_KEY,
      event_type_id: eventTypeId,
      timezone: env.DEFAULT_BUSINESS_TIMEZONE || "America/New_York",
    },
    {
      type: "book_appointment_cal",
      name: "book_appointment_cal",
      description: "Retell native Cal.com booking. Use only after final echo verification. Confirm only when booking succeeds.",
      cal_api_key: env.CALCOM_API_KEY,
      event_type_id: eventTypeId,
      timezone: env.DEFAULT_BUSINESS_TIMEZONE || "America/New_York",
    },
  ];
}

function buildPrompt(businessName) {
  return `# Critical Overrides
- You are a phone receptionist. Keep each turn to 1 or 2 short sentences.
- Ask one question at a time.
- Use only Demo Pest KB for business facts. Blank or missing KB fields mean unknown.
- Do not invent prices, prep instructions, chemical/safety advice, service areas, warranties, availability, or appointment confirmations.
- Do not offer SMS booking or a text booking link as a normal option for inbound calls.
- If a caller asks for a text link, save a follow-up request instead. Do not say a text was sent.
- For a first non-urgent request to speak with a person or be transferred, do not call transfer_call immediately. First say: "I can try to get someone, but the team may be out in the field. The fastest thing I can do is get you on the schedule now. Is that okay?" If the caller still insists, then transfer.
- Do not provide a website, brochure, full service catalog, or wildlife policy unless it is explicitly listed in the KB.
- Use Retell native Cal.com tools as the primary phone-booking path.
- Call create_lead after collecting name, phone, pest issue, address status, and requested time, before checking availability or booking.
- Never say an appointment is booked unless book_appointment_cal succeeds.
- Before calling book_appointment_cal, do one final echo verification and wait for the caller to say it is correct.
- Do not ask for email. If a booking tool requires email, use {{booking_placeholder_email}} silently.
- If the caller says "hold on," say exactly: NO_RESPONSE_NEEDED

# Role
You are Paul, the receptionist for ${businessName}, a pest-control company.
You answer basic questions from the KB, collect service requests, book over the phone through Cal.com, and transfer calls that need a person.

# Personality
Warm, calm, efficient, and natural. Not bubbly, not salesy, not robotic.
Use light acknowledgments like "Got it" or "Okay" when natural. Match the caller's energy without overdoing filler.

# Primary Objective
Help the caller get pest-control help quickly: book over the phone, capture a lead for follow-up, or transfer.

# Knowledge Base Rules
- The attached KB is Demo Pest KB (${DEMO_PEST_KB_ID}).
- Use the KB for services, service area, hours, prep, safety wording, policies, and FAQs.
- If the KB does not answer it, say you do not have that detail and offer follow-up or transfer.
- Do not diagnose pests or severity. Capture what the caller describes.
- Do not quote prices, ranges, warranties, prep steps, or safety claims unless specifically listed and approved.

# Available Tools
- create_lead: Save service/callback/booking details.
- check_service_area: Use only if city/ZIP is volunteered or caller asks about coverage.
- check_availability_cal: Retell native Cal.com availability.
- book_appointment_cal: Retell native Cal.com booking after final echo verification.
- log_transfer_request: Log why a transfer is needed when time allows.
- transfer_call: Use for urgent or escalated human-needed calls.
- end_call: End after a clean close.

# Required Lead Fields
For normal booking or lead capture collect, in order:
1. First name.
2. Confirm the caller number: "Is the number you're calling from the best one for a call or text?"
3. Alternate number only if the caller says the current number is not best.
4. Pest issue or purpose, plus one useful detail if natural.
5. Property address. If unclear, ask once. If refused or still unclear, continue and note the team can confirm it later.
6. Preferred day/time for booking.

# Core Flow
Opening: "Thanks for calling ${businessName}, this is Paul. How can I help?"
If the caller wants service, ask what pest issue they are dealing with.
If the caller asks what services are offered, do not read a long list. Say: "We handle general pest control, with services ranging from ants and roaches to rodents, termites, and wasp or hornet issues. What are you dealing with?"
If they ask again for a full catalog, brochure, website, or every specialty service, keep it compact and KB-bound: "I don't want to over-list anything that may not apply. If you tell me what you're dealing with, I can check that, or I can get you scheduled so the team can confirm the details."
For ants, use light empathy: "Yeah, ants can be frustrating, especially in the kitchen. Are they small ants, or are they a bit larger?" If useful, ask whether they seem to come from one spot or multiple areas, then continue booking.
For normal service, move toward phone booking: "I can help get that booked over the phone now. Can I have your first name?"
If the caller rambles, summarize briefly and ask one focused next question.
If the caller asks "how are you," say: "I'm doing alright today. Uh, how are you?" Then continue.

# Phone Booking / Cal.com Flow
Collect first name, phone confirmation, pest issue, address, and preferred day/time.
Call create_lead with preferred_booking_method phone_booking before checking availability.
Say: "Give me a second while I check the schedule." Then call check_availability_cal.
Offer up to 3 returned slots.
When the caller chooses a slot, echo verify in one question:
"Let me make sure I have this right: your name is [name], the best number is [number], the issue is [pest issue], this is for [address or say the team can confirm the exact address later], and you want [chosen date/time]. Is that all correct?"
If anything is wrong, correct that field only and confirm briefly again.
Do not call book_appointment_cal until the caller confirms.
Say: "Okay, give me one moment while I book that." Then call book_appointment_cal.
If confirmed: "All set — you're booked for [day/time]."
If failed or unavailable: create_lead if needed, then say: "I saved your request, but the booking didn't go through on my end. The team will follow up to confirm the time."

# Follow-Up Request Flow
Do not offer a text link as a normal booking option.
If the caller asks for a text link or does not want to book over the phone, collect first name, phone, pest issue, and address if willing.
Call create_lead with preferred_booking_method callback.
Say: "I saved your request. The team can follow up from there."

# Transfer Rules
For a first live-person request that is not urgent or angry, say: "I can try to get someone, but the team may be out in the field. The fastest thing I can do is get you on the schedule now. Is that okay?"
If the caller accepts, continue phone booking. If they still insist, transfer.
For urgent, unsafe, angry, repeated live-person requests, billing, complaints, or emergency wording, say: "Let me connect you with someone who can help with that. One moment."
Then call log_transfer_request if time allows, and transfer_call.
Transfer quickly for hornets/wasps near people, stings or symptoms, medical concerns, chemical exposure, baby/pet safety concerns not clearly answered in the KB, severe infestations, restaurants/food prep/schools/daycares/hospitals, billing, complaints, angry callers, unsupported/unknown questions where caller wants a person, or emergency wording.

# Pricing / Safety / Unknown Rules
Pricing: "Pricing depends on the pest issue, property, and treatment needed. I can get the request started so the team can confirm the right option."
Safety or chemicals: "I don't have those treatment details here. I can connect you with someone or save your info so the team can follow up."
Prep: "I don't have specific prep instructions here. The team or technician can confirm what to do before the visit."
Unknown: "I don't want to guess on that. I can connect you with someone or save your info so the team can follow up."

# Example Dialogues
Services:
Caller: What types of services do you have?
Agent: We handle general pest control for common household pests, rodents, termites, bed bugs, mosquitoes, and wasp or hornet issues. What are you dealing with?

Ants:
Caller: I have ants in the kitchen.
Agent: Yeah, ants can be frustrating, especially in the kitchen. Are they small ants, or are they a bit larger?
Caller: Small, by the sink.
Agent: Got it. Are they mostly coming from one spot, or showing up in multiple areas?
Caller: Mostly by the sink.
Agent: I can help get that booked over the phone now. Can I have your first name?

Live person:
Caller: I want to be transferred immediately.
Agent: I can try to get someone, but the team may be out in the field. The fastest thing I can do is get you on the schedule now. Is that okay?
Caller: No, transfer me.
Agent: Let me connect you with someone who can help with that. One moment.
Agent calls log_transfer_request and transfer_call.

Urgent hornet:
Caller: There's a hornet nest by my front door and my kid got stung.
Agent: Let me connect you with someone who can help with that. One moment.
Agent calls transfer_call.

Echo verification:
Caller: 11 works.
Agent: Let me make sure I have this right: your name is Eli, the best number is the one you're calling from, the issue is ants, this is for 123 Ocean Avenue in Brooklyn, and you want the 11 AM slot. Is that all correct?
Caller: The address is 123 Ocean Parkway.
Agent: Got it — 123 Ocean Parkway in Brooklyn. You still want the 11 AM slot, correct?

# Closing
Before ending, ask: "Is there anything else I can help you with today?"
If no: "Thanks for calling ${businessName}. Have a good day."
Then call end_call.`;
}

function dedupePostCall(existing) {
  const fallback = [
    { type: "string", name: "caller_name", description: "Caller first name or full name.", required: false },
    { type: "string", name: "caller_phone", description: "Best callback phone number.", required: false },
    { type: "string", name: "alternate_phone", description: "Alternate callback number if provided.", required: false },
    { type: "string", name: "pest_issue", description: "Pest issue discussed.", required: false },
    { type: "string", name: "property_address", description: "Service property address if provided.", required: false },
    { type: "string", name: "preferred_datetime", description: "Requested or confirmed appointment time.", required: false },
    { type: "boolean", name: "appointment_confirmed", description: "Whether Cal.com confirmed booking.", required: false },
    { type: "boolean", name: "transfer_requested", description: "Whether transfer was requested.", required: false },
    { type: "system-presets", name: "user_sentiment", required: false },
    { type: "system-presets", name: "call_summary", required: false },
  ];
  const source = Array.isArray(existing) && existing.length ? existing : fallback;
  const hasSystemCallSummary = source.some((item) => item?.name === "call_summary" && item?.type === "system-presets");
  const seen = new Set();
  return source.filter((item) => {
    if (!item?.name) return true;
    if (hasSystemCallSummary && item.name === "call_summary" && item.type !== "system-presets") return false;
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function publicToolSummary(llm) {
  return (llm.general_tools ?? []).map((tool) => ({
    name: tool.name,
    type: tool.type,
    url: tool.url ?? null,
    event_type_id: tool.event_type_id ?? null,
    has_secret_config: Boolean(tool.cal_api_key),
  }));
}

async function main() {
  if (!env.RETELL_API_KEY) throw new Error("RETELL_API_KEY is missing.");
  if (!env.RETELL_PHONE_NUMBER) throw new Error("RETELL_PHONE_NUMBER is missing.");
  const stamp = timestamp();
  const baseUrl = productionBaseUrl();
  const webhookUrl = `${baseUrl}/retell/webhook`;

  const [phoneBefore, agentBefore, llmBefore] = await Promise.all([
    retell("GET", `/get-phone-number/${encodeURIComponent(env.RETELL_PHONE_NUMBER)}`),
    retell("GET", `/get-agent/${INBOUND_AGENT_ID}`),
    retell("GET", `/get-retell-llm/${INBOUND_LLM_ID}`),
  ]);

  const bindingBefore = (phoneBefore.inbound_agents ?? []).find((item) => item.agent_id === INBOUND_AGENT_ID);
  if (!bindingBefore) throw new Error(`Phone is not bound to ${INBOUND_AGENT_ID}; refusing to mutate.`);

  const backups = {
    phone_before: backup(stamp, "inbound-phone-before-finalize-js", phoneBefore),
    agent_before: backup(stamp, `${INBOUND_AGENT_ID}-before-finalize-js`, agentBefore),
    llm_before: backup(stamp, `${INBOUND_LLM_ID}-before-finalize-js`, llmBefore),
  };

  const targetVersion = agentBefore.is_published
    ? (await retell("POST", `/create-agent-version/${INBOUND_AGENT_ID}`, { base_version: agentBefore.version })).version
    : agentBefore.version;

  const tools = [...customTools(baseUrl), ...controlTools(), ...nativeCalTools()];
  const prompt = buildPrompt(env.DEFAULT_BUSINESS_NAME || "Elijah's Pest Control");

  await retell("PATCH", `/update-retell-llm/${INBOUND_LLM_ID}?version=${encodeURIComponent(String(targetVersion))}`, {
    model: "gpt-4.1",
    model_temperature: 0.2,
    tool_call_strict_mode: true,
    start_speaker: "agent",
    begin_message: `Thanks for calling ${env.DEFAULT_BUSINESS_NAME || "Elijah's Pest Control"}, this is Paul. How can I help?`,
    general_prompt: prompt,
    default_dynamic_variables: {
      business_name: env.DEFAULT_BUSINESS_NAME || "Elijah's Pest Control",
      booking_url: env.BOOKING_URL || "",
      booking_placeholder_email: env.BOOKING_PLACEHOLDER_EMAIL || "demo@example.com",
      transfer_number: env.RETELL_TRANSFER_PHONE_NUMBER || "",
    },
    general_tools: tools,
    knowledge_base_ids: [DEMO_PEST_KB_ID],
    kb_config: { top_k: 3, filter_score: 0.6 },
  });

  const interruptionBefore = Number(agentBefore.interruption_sensitivity ?? 0.75);
  const interruptionAfter = interruptionBefore === 0.75 ? 0.85 : Math.min(0.9, Math.max(interruptionBefore, 0.82));
  await retell("PATCH", `/update-agent/${INBOUND_AGENT_ID}?version=${encodeURIComponent(String(targetVersion))}`, {
    agent_name: agentBefore.agent_name ?? "Elijah's Pest Control Single Prompt Candidate",
    response_engine: { type: "retell-llm", llm_id: INBOUND_LLM_ID, version: targetVersion },
    webhook_url: webhookUrl,
    webhook_events: agentBefore.webhook_events,
    webhook_timeout_ms: agentBefore.webhook_timeout_ms,
    voice_id: "11labs-Gilfoy",
    voice_model: agentBefore.voice_model ?? "eleven_flash_v2_5",
    voice_speed: agentBefore.voice_speed ?? 1.12,
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
    handbook_config: {
      ...(agentBefore.handbook_config ?? {}),
      high_empathy: true,
      ai_disclosure: true,
      speech_normalization: true,
      echo_verification: true,
    },
    post_call_analysis_data: dedupePostCall(agentBefore.post_call_analysis_data),
    analysis_summary_prompt: agentBefore.analysis_summary_prompt,
    analysis_user_sentiment_prompt: agentBefore.analysis_user_sentiment_prompt,
    timezone: agentBefore.timezone ?? env.DEFAULT_BUSINESS_TIMEZONE ?? "America/New_York",
    language: agentBefore.language ?? "en-US",
    version_description: "Inbound finalization: Gilfoy voice, Paul prompt, no SMS booking, phone Cal.com booking",
  });

  await retell("POST", `/publish-agent-version/${INBOUND_AGENT_ID}`, {
    version: targetVersion,
    version_description: "Inbound finalization: Gilfoy voice, Paul prompt, no SMS booking, phone Cal.com booking",
  });

  const [agentAfter, llmAfter, phoneAfter] = await Promise.all([
    retell("GET", `/get-agent/${INBOUND_AGENT_ID}`),
    retell("GET", `/get-retell-llm/${INBOUND_LLM_ID}`),
    retell("GET", `/get-phone-number/${encodeURIComponent(env.RETELL_PHONE_NUMBER)}`),
  ]);

  const duplicatePostCallNames = (agentAfter.post_call_analysis_data ?? [])
    .map((item) => item?.name)
    .filter((name, index, names) => name && names.indexOf(name) !== index);
  const report = {
    created_at: new Date().toISOString(),
    production_base_url: baseUrl,
    webhook_url: webhookUrl,
    live_agent_id: INBOUND_AGENT_ID,
    old_conversation_flow_agent_id: OLD_CONVERSATION_FLOW_AGENT_ID,
    published_version: agentAfter.version,
    backups,
    phone_binding_before: phoneBefore.inbound_agents,
    phone_binding_after: phoneAfter.inbound_agents,
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
      llm_id: llmAfter.llm_id,
      version: llmAfter.version,
      model: llmAfter.model,
      model_temperature: llmAfter.model_temperature,
      begin_message: llmAfter.begin_message,
      knowledge_base_ids: llmAfter.knowledge_base_ids,
      kb_config: llmAfter.kb_config,
      prompt_length_characters: String(llmAfter.general_prompt ?? "").length,
      tools: publicToolSummary(llmAfter),
    },
    no_sms_booking_tool_attached: !(llmAfter.general_tools ?? []).some((tool) => tool.name === "send_booking_sms"),
    duplicate_post_call_names: duplicatePostCallNames,
  };
  writeJson(path.resolve("generated", "inbound-finalize-report.json"), report);
  console.log(JSON.stringify({
    agent_id: INBOUND_AGENT_ID,
    published_version: agentAfter.version,
    phone_binding: phoneAfter.inbound_agents,
    voice_id: agentAfter.voice_id,
    voice_model: agentAfter.voice_model,
    interruption_sensitivity_before: interruptionBefore,
    interruption_sensitivity_after: agentAfter.interruption_sensitivity,
    no_sms_booking_tool_attached: report.no_sms_booking_tool_attached,
    duplicate_post_call_names: duplicatePostCallNames,
    report: "generated/inbound-finalize-report.json",
  }, null, 2));
}

main().catch((error) => {
  console.error(redact(error?.message || error));
  process.exit(1);
});
