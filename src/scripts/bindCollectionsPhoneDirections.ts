import { env } from "../config/env";
import { getRetellClient } from "../retell/retellClient";

const RECEPTIONIST_NUMBER = "+18887809963";
const CONFIRMATION = "I AUTHORIZE DIRECTIONAL COLLECTIONS BINDING";

function bindingSnapshot(phone: Awaited<ReturnType<ReturnType<typeof getRetellClient>["phoneNumber"]["retrieve"]>>) {
  return {
    phone_number: phone.phone_number,
    phone_number_type: phone.phone_number_type,
    inbound_agents: phone.inbound_agents ?? [],
    outbound_agents: phone.outbound_agents ?? [],
    inbound_webhook_url: phone.inbound_webhook_url ?? null,
  };
}

async function main() {
  const inboundAgentId = env.INBOUND_COLLECTIONS_RETELL_AGENT_ID;
  const inboundFlowId = env.INBOUND_COLLECTIONS_RETELL_CONVERSATION_FLOW_ID;
  const phoneNumber = env.RETELL_FROM_NUMBER;
  const baseUrl = env.APP_BASE_URL.replace(/\/$/, "");
  const confirmed = env.CONFIRM_BIND_RETELL_COLLECTIONS_PHONE === CONFIRMATION;
  if (!confirmed) {
    console.log(JSON.stringify({
      mode: "dry_run",
      phone_number: phoneNumber,
      inbound_agent_id: inboundAgentId || null,
      outbound_agent_id: env.OUTBOUND_RETELL_AGENT_ID || null,
      required_confirmation: CONFIRMATION,
      phone_binding_changed: false,
    }, null, 2));
    return;
  }
  if (
    !env.RETELL_API_KEY ||
    !phoneNumber ||
    !baseUrl ||
    !env.OUTBOUND_RETELL_AGENT_ID ||
    !env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID ||
    !inboundAgentId ||
    !inboundFlowId
  ) {
    throw new Error("Explicit outbound/inbound Retell IDs, RETELL_FROM_NUMBER, APP_BASE_URL, and RETELL_API_KEY are required.");
  }

  const client = getRetellClient();
  const [before, receptionistBefore, outboundAgent, inboundAgent] = await Promise.all([
    client.phoneNumber.retrieve(phoneNumber),
    client.phoneNumber.retrieve(RECEPTIONIST_NUMBER),
    client.agent.retrieve(env.OUTBOUND_RETELL_AGENT_ID, { version: "latest_published" }),
    client.agent.retrieve(inboundAgentId, { version: "latest_published" }),
  ]);
  if (
    outboundAgent.response_engine.type !== "conversation-flow" ||
    outboundAgent.response_engine.conversation_flow_id !== env.OUTBOUND_RETELL_CONVERSATION_FLOW_ID
  ) {
    throw new Error("Published outbound agent does not match the explicit outbound Conversation Flow ID.");
  }
  if (
    inboundAgent.response_engine.type !== "conversation-flow" ||
    inboundAgent.response_engine.conversation_flow_id !== inboundFlowId
  ) {
    throw new Error("Published inbound collections agent does not match the explicit inbound Conversation Flow ID.");
  }

  await client.phoneNumber.update(phoneNumber, {
    inbound_agents: [{ agent_id: inboundAgentId, agent_version: "latest_published", weight: 1 }],
    outbound_agents: [{ agent_id: env.OUTBOUND_RETELL_AGENT_ID, agent_version: "latest_published", weight: 1 }],
    inbound_webhook_url: `${baseUrl}/api/outbound/webhooks/retell/inbound-call`,
  });

  const [after, receptionistAfter] = await Promise.all([
    client.phoneNumber.retrieve(phoneNumber),
    client.phoneNumber.retrieve(RECEPTIONIST_NUMBER),
  ]);
  const receptionistUnchanged = JSON.stringify(bindingSnapshot(receptionistBefore)) === JSON.stringify(bindingSnapshot(receptionistAfter));
  if (!receptionistUnchanged) throw new Error("Receptionist phone binding changed unexpectedly; investigate immediately.");
  console.log(JSON.stringify({
    mode: "directional_binding_updated",
    before: bindingSnapshot(before),
    after: bindingSnapshot(after),
    receptionist: bindingSnapshot(receptionistAfter),
    receptionist_unchanged: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

