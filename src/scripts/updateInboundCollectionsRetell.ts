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
    path.join(generatedDir, "inbound-collections-retell-update-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function main() {
  const dryRun = {
    mode: "dry_run",
    updated: false,
    phone_binding_changed: false,
    inbound_agent_id: env.INBOUND_COLLECTIONS_RETELL_AGENT_ID || null,
    inbound_conversation_flow_id: env.INBOUND_COLLECTIONS_RETELL_CONVERSATION_FLOW_ID || null,
    notes: [
      "Set CONFIRM_UPDATE_RETELL_INBOUND_COLLECTIONS_AGENT=true to version and publish only the explicit inbound collections IDs.",
      "This script does not list, create, bind, buy, import, or delete Retell resources.",
    ],
  };
  if (!env.CONFIRM_UPDATE_RETELL_INBOUND_COLLECTIONS_AGENT) {
    await writeReport(dryRun);
    console.log(JSON.stringify(dryRun, null, 2));
    return;
  }
  if (
    !env.RETELL_API_KEY ||
    !env.APP_BASE_URL ||
    !env.INBOUND_COLLECTIONS_RETELL_AGENT_ID ||
    !env.INBOUND_COLLECTIONS_RETELL_CONVERSATION_FLOW_ID
  ) {
    throw new Error("RETELL_API_KEY, APP_BASE_URL, and explicit inbound Retell agent/flow IDs are required.");
  }

  const client = getRetellClient();
  const agent = await client.agent.retrieve(env.INBOUND_COLLECTIONS_RETELL_AGENT_ID, {
    version: "latest_published",
  });
  if (
    agent.response_engine.type !== "conversation-flow" ||
    agent.response_engine.conversation_flow_id !== env.INBOUND_COLLECTIONS_RETELL_CONVERSATION_FLOW_ID
  ) {
    throw new Error("The explicit published inbound agent is not attached to the expected Conversation Flow.");
  }

  const draft = await client.agent.createVersion(agent.agent_id, { base_version: agent.version });
  const flowVersion = draft.response_engine.type === "conversation-flow"
    ? (draft.response_engine.version ?? draft.version)
    : draft.version;
  if (typeof draft.version !== "number" || typeof flowVersion !== "number") {
    throw new Error("Retell did not return numeric draft versions; refusing to update.");
  }

  const updatedFlow = await client.conversationFlow.update(
    env.INBOUND_COLLECTIONS_RETELL_CONVERSATION_FLOW_ID,
    {
      ...buildInboundCollectionsConversationFlow(env.APP_BASE_URL.replace(/\/$/, "")),
      version: flowVersion,
    },
  );
  const updatedAgent = await client.agent.update(agent.agent_id, {
    version: draft.version,
    agent_name: "Elevator Inspection Callback Collections — Paul",
    response_engine: {
      type: "conversation-flow",
      conversation_flow_id: updatedFlow.conversation_flow_id,
      version: updatedFlow.version,
    },
    webhook_url: `${env.APP_BASE_URL.replace(/\/$/, "")}/api/outbound/webhooks/retell`,
    webhook_events: ["call_started", "call_ended", "call_analyzed", "transcript_updated"],
    voicemail_option: null,
  });
  await publishAgentVersion(updatedAgent.agent_id, updatedAgent.version);

  const [agentReadback, flowReadback] = await Promise.all([
    client.agent.retrieve(updatedAgent.agent_id, { version: "latest_published" }),
    client.conversationFlow.retrieve(updatedFlow.conversation_flow_id, { version: updatedFlow.version }),
  ]);
  const report = {
    mode: "updated_published",
    updated: true,
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
