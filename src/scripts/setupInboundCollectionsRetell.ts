import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { buildInboundCollectionsConversationFlow } from "../retell/inboundCollectionsConversationFlow";
import { getRetellClient } from "../retell/retellClient";

async function publishAgentVersion(agentId: string, version: number) {
  try {
    await getRetellClient().agent.publish(agentId, { version });
  } catch (error) {
    if (!(error instanceof SyntaxError) || !error.message.includes("Unexpected end of JSON input")) throw error;
  }
}

async function writeReport(report: Record<string, unknown>) {
  const generatedDir = path.resolve(process.cwd(), "generated");
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.writeFile(
    path.join(generatedDir, "inbound-collections-retell-setup-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function main() {
  const baseUrl = env.APP_BASE_URL.replace(/\/$/, "") || "https://example.invalid";
  const dryRun = {
    mode: "dry_run",
    created: false,
    phone_binding_changed: false,
    base_outbound_agent_id: env.OUTBOUND_RETELL_AGENT_ID || null,
    base_outbound_flow_id: env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID || null,
    notes: [
      "Set CONFIRM_CREATE_RETELL_INBOUND_COLLECTIONS_AGENT=true to create one new inbound collections Conversation Flow and agent.",
      "The base outbound agent is read by explicit ID at version latest_published; no name matching or agent listing is used.",
      "This script does not update, buy, import, or delete phone numbers.",
    ],
  };
  if (!env.CONFIRM_CREATE_RETELL_INBOUND_COLLECTIONS_AGENT) {
    await writeReport(dryRun);
    console.log(JSON.stringify(dryRun, null, 2));
    return;
  }
  if (!env.RETELL_API_KEY || !env.APP_BASE_URL || !env.OUTBOUND_RETELL_AGENT_ID || !env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID) {
    throw new Error("RETELL_API_KEY, APP_BASE_URL, OUTBOUND_RETELL_AGENT_ID, and OUTBOUND_RETELL_CONVERSATION_FLOW_ID are required.");
  }

  const client = getRetellClient();
  const outboundAgent = await client.agent.retrieve(env.OUTBOUND_RETELL_AGENT_ID, { version: "latest_published" });
  if (
    outboundAgent.response_engine.type !== "conversation-flow" ||
    outboundAgent.response_engine.conversation_flow_id !== env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID
  ) {
    throw new Error("The explicit published outbound agent is not attached to the expected Conversation Flow.");
  }

  const flow = await client.conversationFlow.create(buildInboundCollectionsConversationFlow(baseUrl));
  const agent = await client.agent.create({
    agent_name: "Elevator Inspection Callback Collections — Paul",
    response_engine: {
      type: "conversation-flow",
      conversation_flow_id: flow.conversation_flow_id,
      version: flow.version,
    },
    voice_id: outboundAgent.voice_id,
    voice_model: outboundAgent.voice_model,
    voice_speed: outboundAgent.voice_speed,
    voice_temperature: outboundAgent.voice_temperature,
    interruption_sensitivity: outboundAgent.interruption_sensitivity,
    responsiveness: outboundAgent.responsiveness,
    enable_backchannel: outboundAgent.enable_backchannel,
    begin_message_delay_ms: outboundAgent.begin_message_delay_ms,
    ambient_sound: outboundAgent.ambient_sound,
    ambient_sound_volume: outboundAgent.ambient_sound_volume,
    language: outboundAgent.language,
    webhook_url: `${baseUrl}/api/outbound/webhooks/retell`,
    webhook_events: ["call_started", "call_ended", "call_analyzed", "transcript_updated"],
    voicemail_option: null,
    data_storage_setting: "everything_except_pii",
    data_storage_retention_days: 30,
    analysis_summary_prompt: "Summarize the verified inbound B2B invoice callback outcome without adding sensitive identifiers.",
  });
  await publishAgentVersion(agent.agent_id, agent.version);
  const [agentReadback, flowReadback] = await Promise.all([
    client.agent.retrieve(agent.agent_id, { version: "latest_published" }),
    client.conversationFlow.retrieve(flow.conversation_flow_id, { version: flow.version }),
  ]);
  const report = {
    mode: "created_unbound",
    created: true,
    phone_binding_changed: false,
    inbound_agent_id: agentReadback.agent_id,
    inbound_agent_version: agentReadback.version,
    inbound_conversation_flow_id: flowReadback.conversation_flow_id,
    inbound_conversation_flow_version: flowReadback.version,
    voice_id: agentReadback.voice_id,
    tools_count: flowReadback.tools?.length ?? 0,
  };
  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

