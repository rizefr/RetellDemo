import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { buildOutboundConversationFlow } from "../retell/outboundConversationFlow";
import { getRetellClient } from "../retell/retellClient";

type SetupReport = {
  mode: "dry_run" | "updated_unbound";
  created_provider_resources: boolean;
  phone_binding_changed: false;
  outbound_agent_id: string | null;
  outbound_conversation_flow_id: string | null;
  published_version: number | string | null;
  voice_id: string | null;
  voice_source: "explicit_env" | "current_dashboard" | "default_fallback" | "not_updated";
  notes: string[];
};

const OUTBOUND_VOICE_SETTINGS = {
  voice_model: "eleven_flash_v2_5" as const,
  voice_speed: 0.82,
  voice_temperature: 1.2,
  interruption_sensitivity: 0.75,
  responsiveness: 0.95,
  enable_backchannel: true,
  begin_message_delay_ms: 1550,
  ambient_sound: "call-center" as const,
  ambient_sound_volume: 1,
};

const OUTBOUND_POST_CALL_ANALYSIS = [
  {
    type: "boolean" as const,
    name: "identity_confirmed",
    description: "Whether the person explicitly confirmed the requested first name.",
    required: false,
  },
  {
    type: "boolean" as const,
    name: "payment_link_requested",
    description: "Whether the person explicitly requested or agreed to receive the secure payment link.",
    required: false,
  },
  {
    type: "enum" as const,
    name: "delivery_preference",
    description: "The explicitly requested payment-link delivery method.",
    choices: ["text", "email", "none"],
    required: false,
  },
  {
    type: "boolean" as const,
    name: "human_requested",
    description: "Whether the person explicitly asked to speak with a human.",
    required: false,
  },
  {
    type: "enum" as const,
    name: "objection_type",
    description: "The clearest explicit objection, or none.",
    choices: [
      "none",
      "already_paid",
      "wrong_number",
      "unable_to_pay",
      "callback",
      "do_not_contact",
      "proof_requested",
      "dispute",
      "attorney_represented",
      "scam_concern",
      "payment_link_issue",
      "service_issue",
      "mail_check",
      "callback_scheduled",
    ],
    required: false,
  },
  {
    type: "enum" as const,
    name: "next_action",
    description: "The safest next operational action supported by the call.",
    choices: [
      "none",
      "prepare_payment_link",
      "deliver_payment_link",
      "verify_payment",
      "scheduled_followup",
      "manual_review",
      "outreach_stopped_manual_review",
    ],
    required: false,
  },
];

async function retrieveExplicitOutboundAgent() {
  const client = getRetellClient();
  if (!env.OUTBOUND_RETELL_AGENT_ID || !env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID) {
    throw new Error(
      "OUTBOUND_RETELL_AGENT_ID and OUTBOUND_RETELL_CONVERSATION_FLOW_ID are required; refusing to create or match Retell resources by name.",
    );
  }
  const agent = await client.agent.retrieve(env.OUTBOUND_RETELL_AGENT_ID);
  if (agent.response_engine?.type !== "conversation-flow") {
    throw new Error("Configured OUTBOUND_RETELL_AGENT_ID is not a Conversation Flow agent.");
  }
  if (agent.response_engine.conversation_flow_id !== env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID) {
    throw new Error("Configured outbound agent is not attached to OUTBOUND_RETELL_CONVERSATION_FLOW_ID.");
  }
  const flow = await client.conversationFlow.retrieve(env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID);
  return { agent, flow };
}

async function publishAgentVersion(agentId: string, version: number) {
  const client = getRetellClient();
  try {
    await client.agent.publish(agentId, { version });
  } catch (error) {
    // Retell can return an empty success body that older SDK transports try to parse as JSON.
    if (!(error instanceof SyntaxError) || !error.message.includes("Unexpected end of JSON input")) throw error;
  }
}

function resolveOutboundVoice(existingAgent: unknown): {
  voiceId: string;
  source: SetupReport["voice_source"];
} {
  const explicitVoice = process.env.OUTBOUND_RETELL_VOICE_ID?.trim();
  if (explicitVoice) return { voiceId: explicitVoice, source: "explicit_env" };

  const dashboardVoice =
    typeof (existingAgent as { voice_id?: unknown }).voice_id === "string"
      ? (existingAgent as { voice_id: string }).voice_id.trim()
      : "";
  if (dashboardVoice) return { voiceId: dashboardVoice, source: "current_dashboard" };

  return { voiceId: "11labs-Gilfoy", source: "default_fallback" };
}

async function updateExistingOutboundAgent(
  existing: Awaited<ReturnType<typeof retrieveExplicitOutboundAgent>>,
  flow: ReturnType<typeof buildOutboundConversationFlow>,
) {
  const client = getRetellClient();
  const voice = resolveOutboundVoice(existing.agent);
  const draftAgent = await client.agent.createVersion(existing.agent.agent_id, {
    base_version: existing.agent.version,
  });
  if (typeof draftAgent.version !== "number") {
    throw new Error("Retell did not return a numeric draft agent version; refusing to update the outbound flow.");
  }
  const targetAgentVersion = draftAgent.version;
  const targetFlowVersion =
    draftAgent.response_engine.type === "conversation-flow"
      ? (draftAgent.response_engine.version ?? draftAgent.version)
      : draftAgent.version;
  if (typeof targetFlowVersion !== "number") {
    throw new Error("Retell did not return a numeric draft Conversation Flow version; refusing to update.");
  }

  const updatedFlow = await client.conversationFlow.update(existing.flow.conversation_flow_id, {
    ...flow,
    version: targetFlowVersion,
  });

  const updatedAgent = await client.agent.update(existing.agent.agent_id, {
    version: targetAgentVersion,
    agent_name: env.OUTBOUND_RETELL_AGENT_NAME,
    voice_id: voice.voiceId,
    ...OUTBOUND_VOICE_SETTINGS,
    response_engine: {
      type: "conversation-flow",
      conversation_flow_id: existing.flow.conversation_flow_id,
      version: updatedFlow.version,
    },
    webhook_url: `${env.APP_BASE_URL.replace(/\/$/, "")}/api/outbound/webhooks/retell`,
    webhook_events: ["call_started", "call_ended", "call_analyzed", "transcript_updated"],
    voicemail_option: { action: { type: "hangup" } },
    data_storage_setting: "everything_except_pii",
    data_storage_retention_days: 30,
    analysis_summary_prompt: "Summarize the first-party B2B invoice follow-up outcome without adding sensitive identifiers.",
    post_call_analysis_data: OUTBOUND_POST_CALL_ANALYSIS,
  });
  await publishAgentVersion(updatedAgent.agent_id, updatedAgent.version);

  const [agentReadback, flowReadback] = await Promise.all([
    client.agent.retrieve(updatedAgent.agent_id),
    client.conversationFlow.retrieve(updatedFlow.conversation_flow_id),
  ]);
  return { agent: agentReadback, flow: flowReadback, voiceSource: voice.source };
}

async function writeArtifacts(report: SetupReport, flow: unknown) {
  const generatedDir = path.resolve(process.cwd(), "generated");
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.writeFile(
    path.join(generatedDir, "outbound-retell-setup-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(generatedDir, "outbound-retell-conversation-flow-payload.json"),
    `${JSON.stringify(flow, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(generatedDir, ".env.outbound.example.generated"),
    [
      "# Review the setup report, then copy values manually into your secret manager or local .env.",
      `OUTBOUND_RETELL_AGENT_ID=${report.outbound_agent_id ?? ""}`,
      `OUTBOUND_RETELL_CONVERSATION_FLOW_ID=${report.outbound_conversation_flow_id ?? ""}`,
      "OUTBOUND_RETELL_PHONE_NUMBER_ID=",
      "RETELL_FROM_NUMBER=+19842075346",
      "",
    ].join("\n"),
  );
}

async function main() {
  const baseUrl = env.APP_BASE_URL.replace(/\/$/, "") || "https://example.invalid";
  const flow = buildOutboundConversationFlow(baseUrl);
  const dryRunReport: SetupReport = {
    mode: "dry_run",
    created_provider_resources: false,
    phone_binding_changed: false,
    outbound_agent_id: env.OUTBOUND_RETELL_AGENT_ID || null,
    outbound_conversation_flow_id: env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID || null,
    published_version: null,
    voice_id: process.env.OUTBOUND_RETELL_VOICE_ID?.trim() || null,
    voice_source: "not_updated",
    notes: [
      "Safe default: no Retell resources were created.",
      "Set CONFIRM_CREATE_RETELL_OUTBOUND_AGENT=true to update and publish only the explicit OUTBOUND_RETELL_AGENT_ID and OUTBOUND_RETELL_CONVERSATION_FLOW_ID.",
      "This script contains no phone-number update, phone binding, name matching, or duplicate creation operation.",
      "Voice safety: if OUTBOUND_RETELL_VOICE_ID is not explicitly set for this run, the script preserves the current dashboard voice from Retell readback.",
    ],
  };

  if (!env.CONFIRM_CREATE_RETELL_OUTBOUND_AGENT) {
    await writeArtifacts(dryRunReport, flow);
    console.log(JSON.stringify(dryRunReport, null, 2));
    return;
  }
  if (!env.RETELL_API_KEY || !env.APP_BASE_URL || !env.OUTBOUND_RETELL_WEBHOOK_SECRET) {
    throw new Error(
      "RETELL_API_KEY, APP_BASE_URL, and OUTBOUND_RETELL_WEBHOOK_SECRET are required for confirmed creation.",
    );
  }

  const existing = await retrieveExplicitOutboundAgent();
  const updated = await updateExistingOutboundAgent(existing, flow);
  const report: SetupReport = {
    mode: "updated_unbound",
    created_provider_resources: false,
    phone_binding_changed: false,
    outbound_agent_id: updated.agent.agent_id,
    outbound_conversation_flow_id: updated.flow.conversation_flow_id,
    published_version: updated.agent.version,
    voice_id:
      typeof (updated.agent as { voice_id?: unknown }).voice_id === "string"
        ? (updated.agent as { voice_id: string }).voice_id
        : null,
    voice_source: updated.voiceSource,
    notes: [
      "Updated and published only the explicit outbound agent and Conversation Flow IDs.",
      "No phone binding API was called.",
      "No name matching or duplicate provider resource creation was performed.",
      updated.voiceSource === "explicit_env"
        ? "Voice was changed because OUTBOUND_RETELL_VOICE_ID was explicitly set for this run."
        : "Voice was preserved from the current Retell dashboard readback because OUTBOUND_RETELL_VOICE_ID was not explicitly set.",
      "Copy outbound IDs manually from the generated env example after reviewing the report.",
    ],
  };
  await writeArtifacts(report, updated.flow);
  console.log(JSON.stringify(report, null, 2));
  console.log(`OUTBOUND_RETELL_AGENT_ID=${updated.agent.agent_id}`);
  console.log(`OUTBOUND_RETELL_CONVERSATION_FLOW_ID=${updated.flow.conversation_flow_id}`);
}

main().catch((error) => {
  console.error("Outbound Retell setup failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
