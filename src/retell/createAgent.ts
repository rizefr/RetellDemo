import { env } from "../config/env";
import { buildAgentPrompt } from "./agentPrompt";
import { buildConversationFlowConfig } from "./conversationFlow";
import { getRetellClient } from "./retellClient";
import { buildCustomToolDefinitions, buildRetellControlTools } from "./tools";

type RetellClient = ReturnType<typeof getRetellClient>;

export interface RetellSetupReport {
  status: "FULLY_AUTOMATED" | "PARTIALLY_MANUAL";
  automated: string[];
  failed: string[];
  manual_steps: string[];
  verification_checklist: string[];
  old_resource_notes: string[];
  agent_id: string | null;
  conversation_flow_id: string | null;
  llm_id: string | null;
  response_engine_type: "conversation-flow" | "retell-llm" | null;
  model_used: string;
  agent_version: number | string | null;
  published: boolean;
  phone_bound: boolean;
  webhook_configured: boolean;
  sms_mode: string;
  calendar_mode: string;
  booking_url_status: string;
}

export interface RetellSetupOptions {
  bookingUrlOverride?: string;
  bookingUrlStatus?: string;
}

function markManual(report: RetellSetupReport, step: string) {
  report.status = "PARTIALLY_MANUAL";
  if (!report.manual_steps.includes(step)) report.manual_steps.push(step);
}

function sanitizedError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replaceAll(env.RETELL_API_KEY, "<redacted>")
    .replaceAll(env.RETELL_WEBHOOK_SECRET_OR_API_KEY, "<redacted>")
    .replaceAll(env.SUPABASE_SERVICE_ROLE_KEY, "<redacted>")
    .replaceAll(env.CALCOM_API_KEY, "<redacted>");
}

async function inspectExistingResources(client: RetellClient, report: RetellSetupReport) {
  if (env.RETELL_AGENT_ID) {
    try {
      const agent = await client.agent.retrieve(env.RETELL_AGENT_ID);
      const responseEngine = agent.response_engine as unknown as Record<string, unknown>;
      const staleReasons = [
        agent.is_published ? "" : "unpublished",
        agent.agent_name === env.RETELL_AGENT_NAME ? "" : `named "${agent.agent_name ?? "unnamed"}"`,
        agent.webhook_url === env.RETELL_WEBHOOK_URL ? "" : "webhook URL differs from .env",
      ].filter(Boolean);
      report.old_resource_notes.push(
        `Existing RETELL_AGENT_ID was retrieved: version ${agent.version}, engine ${String(
          responseEngine.type ?? "unknown",
        )}${staleReasons.length ? `, treated as stale because it is ${staleReasons.join(", ")}` : ""}.`,
      );
    } catch (error) {
      report.old_resource_notes.push(`Existing RETELL_AGENT_ID could not be retrieved: ${sanitizedError(error)}`);
    }
  }

  if (env.RETELL_CONVERSATION_FLOW_ID) {
    try {
      const flow = await client.conversationFlow.retrieve(env.RETELL_CONVERSATION_FLOW_ID);
      report.old_resource_notes.push(
        `Existing RETELL_CONVERSATION_FLOW_ID was retrieved: version ${flow.version}. A fresh flow will be created for this run.`,
      );
    } catch (error) {
      report.old_resource_notes.push(
        `Existing RETELL_CONVERSATION_FLOW_ID could not be retrieved: ${sanitizedError(error)}`,
      );
    }
  }

  if (env.RETELL_PHONE_NUMBER) {
    try {
      const phone = await client.phoneNumber.retrieve(env.RETELL_PHONE_NUMBER);
      const inboundCount = phone.inbound_agents?.length ?? 0;
      const inboundSmsCount = phone.inbound_sms_agents?.length ?? 0;
      const outboundSmsCount = phone.outbound_sms_agents?.length ?? 0;
      report.old_resource_notes.push(
        `Retell phone number was retrieved: type ${phone.phone_number_type}, inbound_agents=${inboundCount}, inbound_sms_agents=${inboundSmsCount}, outbound_sms_agents=${outboundSmsCount}.`,
      );
    } catch (error) {
      report.old_resource_notes.push(`Retell phone number could not be retrieved: ${sanitizedError(error)}`);
    }
  }
}

function postCallAnalysisData() {
  return [
    { type: "string", name: "caller_name", description: "Caller first name or full name.", required: false },
    { type: "string", name: "caller_phone", description: "Best phone number for the caller.", required: false },
    { type: "string", name: "pest_issue", description: "The pest issue discussed.", required: false },
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
      choices: ["sms_link", "phone_booking", "transfer", "callback", "unknown"],
      required: false,
    },
    { type: "boolean", name: "sms_sent", description: "Whether SMS was actually sent.", required: false },
    { type: "boolean", name: "sms_simulated", description: "Whether SMS was simulated instead of sent.", required: false },
    {
      type: "boolean",
      name: "transfer_requested",
      description: "Whether the caller requested or required transfer.",
      required: false,
    },
    {
      type: "boolean",
      name: "appointment_requested",
      description: "Whether the caller requested an appointment.",
      required: false,
    },
    {
      type: "boolean",
      name: "appointment_confirmed",
      description: "Whether a booking API confirmed an appointment.",
      required: false,
    },
    { type: "string", name: "preferred_datetime", description: "Preferred date/time if provided.", required: false },
    { type: "string", name: "service_area_or_zip", description: "City, service area, or ZIP mentioned.", required: false },
    { type: "string", name: "call_summary", description: "Short operational call summary.", required: false },
    { type: "number", name: "lead_quality_score", description: "Lead quality score from 1 to 5.", required: false },
    {
      type: "enum",
      name: "call_outcome",
      description: "Primary outcome of the call.",
      choices: [
        "sms_booking_link_sent",
        "sms_booking_simulated",
        "lead_captured",
        "transferred",
        "callback_needed",
        "phone_booking_requested",
        "real_appointment_booked",
        "wrong_number",
        "unsupported",
        "hostile_ended",
      ],
      required: false,
    },
  ];
}

function agentPayload(responseEngine: Record<string, unknown>, voiceId: string) {
  return {
    response_engine: responseEngine,
    voice_id: voiceId,
    agent_name: env.RETELL_AGENT_NAME,
    version_description: "Elijah's Pest Control receptionist demo",
    webhook_url: env.RETELL_WEBHOOK_URL || undefined,
    webhook_events: [
      "call_started",
      "call_ended",
      "call_analyzed",
      "transcript_updated",
      "transfer_started",
      "transfer_bridged",
      "transfer_cancelled",
      "transfer_ended",
    ],
    webhook_timeout_ms: 10000,
    post_call_analysis_data: postCallAnalysisData(),
    analysis_summary_prompt:
      "Summarize caller need, pest issue, urgency, lead capture, SMS state, transfer state, booking request, and next step in two concise sentences.",
    analysis_user_sentiment_prompt: "Classify user sentiment as positive, neutral, negative, distressed, or hostile.",
    timezone: env.DEFAULT_BUSINESS_TIMEZONE,
    language: "en-US",
    voice_speed: 1.2,
    enable_backchannel: true,
    backchannel_frequency: 0.8,
    backchannel_words: ["mm-hmm", "uh-huh"],
    interruption_sensitivity: 0.8,
    responsiveness: 1.0,
    end_call_after_silence_ms: 60000,
    denoising_mode: "noise-and-background-speech-cancellation",
    handbook_config: {
      default_personality: true,
      scope_boundaries: true,
      speech_normalization: true,
      smart_matching: true,
    },
  };
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
    body: JSON.stringify({
      version,
      version_description: "Elijah's Pest Control live demo baseline",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${body}`);
  }
}

async function createConversationFlowEngine(
  client: RetellClient,
  report: RetellSetupReport,
  options: RetellSetupOptions,
): Promise<Record<string, unknown> | null> {
  const flowConfig = buildConversationFlowConfig({ bookingUrlOverride: options.bookingUrlOverride });
  try {
    const created = await client.conversationFlow.create(flowConfig as never);
    report.conversation_flow_id = created.conversation_flow_id;
    report.response_engine_type = "conversation-flow";
    report.automated.push(`Created new Conversation Flow ${created.conversation_flow_id} version ${created.version}.`);
    markManual(
      report,
      `Add RETELL_CONVERSATION_FLOW_ID=${created.conversation_flow_id} to .env after verifying the live demo.`,
    );
    return {
      type: "conversation-flow",
      conversation_flow_id: created.conversation_flow_id,
    };
  } catch (error) {
    const message = sanitizedError(error);
    report.failed.push(`Conversation Flow create failed: ${message}`);
    markManual(
      report,
      "Create the Conversation Flow manually from generated/retell-conversation-flow-config.json if the Retell API continues rejecting the payload.",
    );
    return null;
  }
}

async function createRetellLlmFallback(
  client: RetellClient,
  report: RetellSetupReport,
  options: RetellSetupOptions,
): Promise<Record<string, unknown> | null> {
  const prompt = buildAgentPrompt({
    businessName: env.DEFAULT_BUSINESS_NAME,
    timezone: env.DEFAULT_BUSINESS_TIMEZONE,
    smsModeDescription:
      "Backend SMS tool is active; it may simulate SMS unless provider configuration is verified.",
    bookingModeDescription: options.bookingUrlOverride
      ? "Use the configured booking URL when SMS succeeds."
      : "No verified booking URL is configured. Capture the lead and say the team can follow up.",
  });

  try {
    const llm = await client.llm.create({
      model: "gpt-4.1",
      model_temperature: 0.2,
      tool_call_strict_mode: true,
      start_speaker: "agent",
      begin_message: `Thanks for calling ${env.DEFAULT_BUSINESS_NAME}, this is Ava. How can I help?`,
      general_prompt: prompt,
      default_dynamic_variables: {
        business_name: env.DEFAULT_BUSINESS_NAME,
        booking_url: options.bookingUrlOverride || env.BOOKING_URL,
        transfer_number: env.RETELL_TRANSFER_PHONE_NUMBER,
      },
      general_tools: [...buildCustomToolDefinitions(), ...buildRetellControlTools()] as never,
    });
    report.llm_id = llm.llm_id;
    report.response_engine_type = "retell-llm";
    report.automated.push(`Created Retell LLM fallback ${llm.llm_id} using gpt-4.1.`);
    markManual(report, `Add fallback LLM ID ${llm.llm_id} to Retell notes if you keep this agent.`);
    return {
      type: "retell-llm",
      llm_id: llm.llm_id,
    };
  } catch (error) {
    report.failed.push(`Retell LLM fallback create failed: ${sanitizedError(error)}`);
    markManual(report, "Create a single-prompt Retell LLM manually using generated/retell-agent-config.json.");
    return null;
  }
}

async function createVoiceAgent(
  client: RetellClient,
  report: RetellSetupReport,
  responseEngine: Record<string, unknown>,
) {
  const primaryPayload = agentPayload(responseEngine, env.RETELL_VOICE_ID);
  try {
    return await client.agent.create(primaryPayload as never);
  } catch (error) {
    const message = sanitizedError(error);
    if (!message.toLowerCase().includes("voice")) throw error;
    report.failed.push(`Voice agent create rejected configured voice ${env.RETELL_VOICE_ID}: ${message}`);
    markManual(report, `Verify RETELL_VOICE_ID=${env.RETELL_VOICE_ID} in the Retell voice library.`);
    report.automated.push("Retrying agent creation with fallback voice retell-Cimo.");
    return client.agent.create(agentPayload(responseEngine, "retell-Cimo") as never);
  }
}

export async function createOrUpdateRetellAgent(options: RetellSetupOptions = {}): Promise<RetellSetupReport> {
  const report: RetellSetupReport = {
    status: "FULLY_AUTOMATED",
    automated: [],
    failed: [],
    manual_steps: [],
    verification_checklist: [
      "In Retell, confirm the new voice agent is published and its phone-number binding uses inbound_agents with weight 1.",
      "Confirm the agent-level webhook URL matches RETELL_WEBHOOK_URL.",
      "Call the Retell number and verify the greeting says Elijah's Pest Control and Ava.",
      "Ask for ants or roach pricing and verify no exact price is invented.",
      "Ask for a live person and verify transfer starts.",
      "Run an SMS booking scenario and verify simulated SMS wording does not say a text was sent.",
      "End the call and confirm call_started/call_ended/call_analyzed webhooks are stored in Supabase.",
    ],
    old_resource_notes: [],
    agent_id: null,
    conversation_flow_id: null,
    llm_id: null,
    response_engine_type: null,
    model_used: "gpt-4.1",
    agent_version: null,
    published: false,
    phone_bound: false,
    webhook_configured: false,
    sms_mode:
      env.SMS_MODE === "retell" && !env.RETELL_SMS_NODE_ENABLED && !env.RETELL_OUTBOUND_SMS_ENABLED
        ? "simulated"
        : env.SMS_MODE,
    calendar_mode: env.CALENDAR_PROVIDER,
    booking_url_status: options.bookingUrlStatus ?? (options.bookingUrlOverride || env.BOOKING_URL ? "configured" : "missing"),
  };

  const client = getRetellClient();
  await inspectExistingResources(client, report);

  let responseEngine = await createConversationFlowEngine(client, report, options);
  if (!responseEngine) responseEngine = await createRetellLlmFallback(client, report, options);
  if (!responseEngine) return report;

  try {
    const agent = await createVoiceAgent(client, report, responseEngine);
    report.agent_id = agent.agent_id;
    report.agent_version = agent.version;
    report.webhook_configured = agent.webhook_url === env.RETELL_WEBHOOK_URL;
    report.automated.push(
      `Created new voice agent ${agent.agent_id} version ${agent.version} using ${report.response_engine_type}.`,
    );
    markManual(report, `Add RETELL_AGENT_ID=${agent.agent_id} to .env after verifying the live demo.`);
  } catch (error) {
    report.failed.push(`Agent create failed: ${sanitizedError(error)}`);
    markManual(report, "Create the voice agent manually using generated/retell-agent-config.json.");
    return report;
  }

  if (typeof report.agent_version === "number" && report.agent_id) {
    try {
      await publishAgentVersion(report.agent_id, report.agent_version);
      report.published = true;
      report.automated.push(`Published agent ${report.agent_id} version ${report.agent_version}.`);
    } catch (error) {
      report.failed.push(`Agent publish failed: ${sanitizedError(error)}`);
      markManual(report, "Publish the new draft agent version manually in the Retell dashboard.");
    }
  } else {
    markManual(report, "Verify and publish the agent manually; setup did not receive a numeric draft version.");
  }

  if (env.RETELL_PHONE_NUMBER && report.agent_id && report.published) {
    try {
      await client.phoneNumber.update(env.RETELL_PHONE_NUMBER, {
        inbound_agents: [{ agent_id: report.agent_id, agent_version: report.agent_version ?? "latest", weight: 1 }],
      });
      report.phone_bound = true;
      report.automated.push("Bound inbound voice calls with weighted inbound_agents total weight 1.");
    } catch (error) {
      report.failed.push(`Phone-number binding failed: ${sanitizedError(error)}`);
      markManual(
        report,
        `In Retell dashboard, open Phone Numbers, select ${env.RETELL_PHONE_NUMBER}, and set inbound_agents to agent ${report.agent_id} version ${report.agent_version} with weight 1.`,
      );
    }
  } else {
    markManual(report, "Set RETELL_PHONE_NUMBER and bind inbound calls to the published voice agent.");
  }

  if (!env.RETELL_SMS_NODE_ENABLED && !env.RETELL_OUTBOUND_SMS_ENABLED) {
    markManual(
      report,
      "SMS remains simulated. Keep RETELL_SMS_NODE_ENABLED=false and RETELL_OUTBOUND_SMS_ENABLED=false until a real booking-text test succeeds.",
    );
  } else {
    markManual(
      report,
      "SMS flags are enabled but not proven by this setup run. Verify SMS-capable Retell number, SMS node/API result, and tool response before allowing the agent to say it sent a text.",
    );
  }

  if (!options.bookingUrlOverride && !env.BOOKING_URL) {
    markManual(
      report,
      "BOOKING_URL is missing. The agent can capture leads, but booking-link delivery stays in safe follow-up mode until a verified booking URL is configured.",
    );
  }

  if (env.CALENDAR_PROVIDER === "calcom" && (!env.CALCOM_EVENT_TYPE_ID || !env.CALCOM_USERNAME || !env.CALCOM_EVENT_SLUG)) {
    markManual(
      report,
      "Cal.com is not fully configured. Set CALENDAR_PROVIDER=none until CALCOM_EVENT_TYPE_ID, CALCOM_USERNAME, and CALCOM_EVENT_SLUG are verified.",
    );
  }

  return report;
}
