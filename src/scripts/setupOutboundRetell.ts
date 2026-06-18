import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { buildOutboundConversationFlow } from "../retell/outboundConversationFlow";
import { getRetellClient } from "../retell/retellClient";

type SetupReport = {
  mode: "dry_run" | "created_unbound" | "updated_unbound";
  created_provider_resources: boolean;
  phone_binding_changed: false;
  outbound_agent_id: string | null;
  outbound_conversation_flow_id: string | null;
  published_version: number | string | null;
  notes: string[];
};

const OUTBOUND_VOICE_SETTINGS = {
  voice_model: "eleven_flash_v2_5" as const,
  voice_speed: 1.12,
  voice_temperature: 1.2,
  interruption_sensitivity: 0.75,
  responsiveness: 0.95,
  enable_backchannel: true,
  begin_message_delay_ms: 250,
};

async function findExistingOutboundAgent() {
  const client = getRetellClient();
  const agents = await client.agent.list();
  const agent = agents.find((candidate) => candidate.agent_name === env.OUTBOUND_RETELL_AGENT_NAME);
  if (!agent || agent.response_engine?.type !== "conversation-flow") return null;
  const flow = await client.conversationFlow.retrieve(agent.response_engine.conversation_flow_id);
  if (!flow.global_prompt?.includes("first-party B2B unpaid invoice follow-up")) return null;
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

async function updateExistingOutboundAgent(
  existing: NonNullable<Awaited<ReturnType<typeof findExistingOutboundAgent>>>,
  flow: ReturnType<typeof buildOutboundConversationFlow>,
) {
  const client = getRetellClient();
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
    voice_id: env.OUTBOUND_RETELL_VOICE_ID,
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
  });
  await publishAgentVersion(updatedAgent.agent_id, updatedAgent.version);

  const [agentReadback, flowReadback] = await Promise.all([
    client.agent.retrieve(updatedAgent.agent_id),
    client.conversationFlow.retrieve(updatedFlow.conversation_flow_id),
  ]);
  return { agent: agentReadback, flow: flowReadback };
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
    notes: [
      "Safe default: no Retell resources were created.",
      "Set CONFIRM_CREATE_RETELL_OUTBOUND_AGENT=true to create and publish an unbound flow and agent.",
      "This script contains no phone-number update or binding operation.",
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

  const client = getRetellClient();
  const existing = await findExistingOutboundAgent();
  if (existing) {
    const updated = await updateExistingOutboundAgent(existing, flow);
    const report: SetupReport = {
      mode: "updated_unbound",
      created_provider_resources: false,
      phone_binding_changed: false,
      outbound_agent_id: updated.agent.agent_id,
      outbound_conversation_flow_id: updated.flow.conversation_flow_id,
      published_version: updated.agent.version,
      notes: [
        "Updated and published the existing matching unbound outbound agent and Conversation Flow.",
        "No phone binding API was called.",
        "Copy outbound IDs manually from the generated env example after reviewing the report.",
      ],
    };
    await writeArtifacts(report, updated.flow);
    console.log(JSON.stringify(report, null, 2));
    console.log(`OUTBOUND_RETELL_AGENT_ID=${updated.agent.agent_id}`);
    console.log(`OUTBOUND_RETELL_CONVERSATION_FLOW_ID=${updated.flow.conversation_flow_id}`);
    return;
  }

  const createdFlow = await client.conversationFlow.create(flow);
  const agent = await client.agent.create({
    response_engine: {
      type: "conversation-flow",
      conversation_flow_id: createdFlow.conversation_flow_id,
    },
    voice_id: env.OUTBOUND_RETELL_VOICE_ID,
    ...OUTBOUND_VOICE_SETTINGS,
    agent_name: env.OUTBOUND_RETELL_AGENT_NAME,
    webhook_url: `${env.APP_BASE_URL.replace(/\/$/, "")}/api/outbound/webhooks/retell`,
    webhook_events: ["call_started", "call_ended", "call_analyzed", "transcript_updated"],
    voicemail_option: { action: { type: "hangup" } },
    data_storage_setting: "everything_except_pii",
    data_storage_retention_days: 30,
    analysis_summary_prompt: "Summarize the B2B invoice follow-up outcome without adding sensitive identifiers.",
  });
  await publishAgentVersion(agent.agent_id, agent.version);
  const readback = await client.agent.retrieve(agent.agent_id);
  const report: SetupReport = {
    mode: "created_unbound",
    created_provider_resources: true,
    phone_binding_changed: false,
    outbound_agent_id: agent.agent_id,
    outbound_conversation_flow_id: createdFlow.conversation_flow_id,
    published_version: readback.version,
    notes: [
      "Created and published a new unbound outbound agent and Conversation Flow.",
      "No phone binding was read or changed.",
      "Copy outbound IDs manually from the generated env example after reviewing the report.",
    ],
  };
  await writeArtifacts(report, flow);
  console.log(JSON.stringify(report, null, 2));
  console.log(`OUTBOUND_RETELL_AGENT_ID=${agent.agent_id}`);
  console.log(`OUTBOUND_RETELL_CONVERSATION_FLOW_ID=${createdFlow.conversation_flow_id}`);
}

main().catch((error) => {
  console.error("Outbound Retell setup failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
