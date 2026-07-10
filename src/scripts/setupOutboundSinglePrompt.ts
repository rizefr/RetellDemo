import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import {
  OUTBOUND_SINGLE_PROMPT_AGENT_NAME,
  buildOutboundSinglePromptAgentPayload,
  buildOutboundSinglePromptLlmPayload,
} from "../retell/outboundSinglePrompt";
import { getRetellClient } from "../retell/retellClient";
import { listRetellVoiceAgentsV2 } from "../retell/retellList";

type AnyRecord = Record<string, any>;

const OUTBOUND_AGENT_ID = "agent_4aa8074d7eabe311109ed6da89";
const OUTBOUND_FLOW_ID = "conversation_flow_bebdceabc801";
const INBOUND_SINGLE_PROMPT_AGENT_ID = "agent_16b324c0e55f21c0a5f914c169";
const OUTBOUND_PHONE_NUMBER = "+19842075346";
const RECEPTIONIST_PHONE_NUMBER = "+18887809963";
const partialProviderState: { candidate_llm_id?: string; candidate_agent_id?: string } = {};

function sanitizeError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [env.RETELL_API_KEY, env.SUPABASE_SERVICE_ROLE_KEY, env.EMAIL_PROVIDER_API_KEY].filter(Boolean)) {
    message = message.replaceAll(secret, "<redacted>");
  }
  return message;
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function publishedAgent(client: ReturnType<typeof getRetellClient>, agentId: string) {
  const versions = (await client.agent.getVersions(agentId)) as AnyRecord[];
  const published = versions
    .filter((version) => version.is_published === true)
    .sort((left, right) => Number(right.version) - Number(left.version))[0];
  if (!published) throw new Error(`No published Retell version exists for ${agentId}`);
  return client.agent.retrieve(agentId, { version: published.version });
}

function hasBinding(phone: AnyRecord, agentId: string) {
  return Array.isArray(phone.inbound_agents) && phone.inbound_agents.some((binding: AnyRecord) => binding.agent_id === agentId);
}

function bindingSummary(phone: AnyRecord) {
  return (phone.inbound_agents ?? []).map((binding: AnyRecord) => ({
    agent_id: binding.agent_id,
    agent_version: binding.agent_version,
    weight: binding.weight,
  }));
}

async function publishAgentVersion(agentId: string, version: number) {
  const baseUrl = (env.RETELL_BASE_URL || "https://api.retellai.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/publish-agent-version/${encodeURIComponent(agentId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RETELL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version,
      version_description: "Initial outbound Single Prompt comparison candidate",
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Retell publish failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
  }
}

async function main() {
  const client = getRetellClient();
  const baseUrl = (env.APP_BASE_URL || env.PRODUCTION_BASE_URL || "https://elixis.agency").replace(/\/$/, "");
  const outputPath = path.resolve(process.cwd(), "generated", "outbound-single-prompt-report.json");
  const llmPayloadPath = path.resolve(process.cwd(), "generated", "outbound-single-prompt-llm-payload.json");
  const agentPayloadPath = path.resolve(process.cwd(), "generated", "outbound-single-prompt-agent-payload.json");

  const [outbound, inbound, outboundPhone, receptionistPhone, agents] = await Promise.all([
    publishedAgent(client, OUTBOUND_AGENT_ID),
    publishedAgent(client, INBOUND_SINGLE_PROMPT_AGENT_ID),
    client.phoneNumber.retrieve(OUTBOUND_PHONE_NUMBER),
    client.phoneNumber.retrieve(RECEPTIONIST_PHONE_NUMBER),
    listRetellVoiceAgentsV2({ apiKey: env.RETELL_API_KEY, baseUrl: env.RETELL_BASE_URL }),
  ]);

  if (outbound.response_engine?.type !== "conversation-flow") {
    throw new Error("The explicit outbound reference agent is not a Conversation Flow agent");
  }
  if (outbound.response_engine.conversation_flow_id !== OUTBOUND_FLOW_ID) {
    throw new Error("The outbound reference agent is not attached to the expected explicit flow ID");
  }
  if (inbound.response_engine?.type !== "retell-llm") {
    throw new Error("The explicit inbound reference agent is not a Single Prompt agent");
  }
  if (!hasBinding(outboundPhone, OUTBOUND_AGENT_ID)) {
    throw new Error("The outbound phone no longer points to the explicit outbound reference agent");
  }
  if (!hasBinding(receptionistPhone, INBOUND_SINGLE_PROMPT_AGENT_ID)) {
    throw new Error("The receptionist phone no longer points to the explicit inbound reference agent");
  }

  const configuredCandidateAgentId = env.OUTBOUND_RETELL_SINGLE_PROMPT_AGENT_ID;
  const configuredCandidateLlmId = env.OUTBOUND_RETELL_SINGLE_PROMPT_LLM_ID;
  const sameNameAgents = agents.filter((agent) => agent.agent_name === OUTBOUND_SINGLE_PROMPT_AGENT_NAME);
  const unexpectedSameName = sameNameAgents.find((agent) => agent.agent_id !== configuredCandidateAgentId);
  if (unexpectedSameName) {
    throw new Error(
      `A Retell agent named ${OUTBOUND_SINGLE_PROMPT_AGENT_NAME} already exists as ${unexpectedSameName.agent_id}. Set its explicit candidate ID before any further action.`,
    );
  }

  const llmPayload = buildOutboundSinglePromptLlmPayload(baseUrl);
  const provisionalAgentPayload = buildOutboundSinglePromptAgentPayload(outbound as AnyRecord, "<new-llm-id>", baseUrl);
  await writeJson(llmPayloadPath, llmPayload);
  await writeJson(agentPayloadPath, provisionalAgentPayload);

  const report: AnyRecord = {
    created_at: new Date().toISOString(),
    mode: env.CONFIRM_UPDATE_RETELL_OUTBOUND_SINGLE_PROMPT_AGENT
      ? "update_confirmed"
      : env.CONFIRM_CREATE_RETELL_OUTBOUND_SINGLE_PROMPT_AGENT
        ? "create_confirmed"
        : "dry_run",
    candidate_name: OUTBOUND_SINGLE_PROMPT_AGENT_NAME,
    reference: {
      outbound_agent_id: outbound.agent_id,
      outbound_agent_version: outbound.version,
      outbound_flow_id: OUTBOUND_FLOW_ID,
      inbound_single_prompt_agent_id: inbound.agent_id,
      inbound_single_prompt_version: inbound.version,
    },
    phone_bindings_before: {
      outbound: bindingSummary(outboundPhone),
      receptionist: bindingSummary(receptionistPhone),
    },
    payloads: { llm: llmPayloadPath, agent: agentPayloadPath },
    configured_candidate: {
      agent_id: configuredCandidateAgentId || null,
      llm_id: configuredCandidateLlmId || null,
    },
    provider_resources_created: false,
    phone_binding_changed: false,
  };

  if (configuredCandidateAgentId) {
    const candidate = await publishedAgent(client, configuredCandidateAgentId);
    if (candidate.response_engine?.type !== "retell-llm") {
      throw new Error("Configured outbound Single Prompt candidate is not a retell-llm agent");
    }
    if (candidate.agent_name !== OUTBOUND_SINGLE_PROMPT_AGENT_NAME) {
      throw new Error("Configured outbound Single Prompt candidate does not have the expected explicit name");
    }
    if (configuredCandidateLlmId && candidate.response_engine.llm_id !== configuredCandidateLlmId) {
      throw new Error("Configured outbound Single Prompt LLM ID does not match the candidate agent readback");
    }
    const candidateBound = hasBinding(outboundPhone, candidate.agent_id) || hasBinding(receptionistPhone, candidate.agent_id);
    if (candidateBound) throw new Error("Configured candidate must remain unbound from production phone numbers");
    const candidateLlmId = configuredCandidateLlmId || candidate.response_engine.llm_id;
    const candidateLlm = (await client.llm.retrieve(candidateLlmId)) as AnyRecord;
    if (env.CONFIRM_UPDATE_RETELL_OUTBOUND_SINGLE_PROMPT_AGENT) {
      const draft = (await client.agent.createVersion(candidate.agent_id, {
        base_version: candidate.version,
      })) as AnyRecord;
      const targetVersion = Number(draft.version);
      const updatedLlm = (await client.llm.update(candidateLlmId, {
        version: targetVersion,
        ...llmPayload,
      } as never)) as AnyRecord;
      const updatedAgent = (await client.agent.update(candidate.agent_id, {
        version: targetVersion,
        ...buildOutboundSinglePromptAgentPayload(outbound as AnyRecord, updatedLlm.llm_id, baseUrl),
        response_engine: {
          type: "retell-llm",
          llm_id: updatedLlm.llm_id,
          version: targetVersion,
        },
        version_description: "Outbound Single Prompt comparison prompt refinement",
      } as never)) as AnyRecord;
      await publishAgentVersion(candidate.agent_id, targetVersion);
      const [candidateAfter, llmAfter, outboundPhoneAfter, receptionistPhoneAfter] = (await Promise.all([
        publishedAgent(client, candidate.agent_id),
        client.llm.retrieve(updatedLlm.llm_id, { version: targetVersion }),
        client.phoneNumber.retrieve(OUTBOUND_PHONE_NUMBER),
        client.phoneNumber.retrieve(RECEPTIONIST_PHONE_NUMBER),
      ])) as AnyRecord[];
      const bindingsPreserved =
        hasBinding(outboundPhoneAfter, OUTBOUND_AGENT_ID) &&
        hasBinding(receptionistPhoneAfter, INBOUND_SINGLE_PROMPT_AGENT_ID) &&
        !hasBinding(outboundPhoneAfter, candidate.agent_id) &&
        !hasBinding(receptionistPhoneAfter, candidate.agent_id);
      if (!bindingsPreserved) throw new Error("Candidate update changed a production phone binding");
      report.status = "candidate_updated_and_published";
      report.provider_resources_created = false;
      report.candidate = {
        agent_id: candidateAfter.agent_id,
        llm_id: llmAfter.llm_id,
        version: candidateAfter.version,
        is_published: candidateAfter.is_published,
        phone_bound: false,
        webhook_url: candidateAfter.webhook_url,
        tool_names: (llmAfter.general_tools ?? []).map((tool: AnyRecord) => tool.name),
      };
      report.phone_bindings_after = {
        outbound: bindingSummary(outboundPhoneAfter),
        receptionist: bindingSummary(receptionistPhoneAfter),
      };
      await writeJson(outputPath, report);
      console.log(JSON.stringify({ output_path: outputPath, ...report.candidate, status: report.status }, null, 2));
      return;
    }
    report.status = "existing_candidate_verified";
    report.candidate = {
      agent_id: candidate.agent_id,
      llm_id: candidate.response_engine.llm_id,
      version: candidate.version,
      is_published: candidate.is_published,
      phone_bound: false,
      webhook_url: candidate.webhook_url,
      tool_names: (candidateLlm.general_tools ?? []).map((tool: AnyRecord) => tool.name),
    };
    await writeJson(outputPath, report);
    console.log(JSON.stringify({ output_path: outputPath, ...report.candidate, status: report.status }, null, 2));
    return;
  }

  if (!env.CONFIRM_CREATE_RETELL_OUTBOUND_SINGLE_PROMPT_AGENT) {
    report.status = "dry_run_ready";
    report.next_step = "Set CONFIRM_CREATE_RETELL_OUTBOUND_SINGLE_PROMPT_AGENT=true for one deliberate creation run.";
    await writeJson(outputPath, report);
    console.log(JSON.stringify({ output_path: outputPath, status: report.status, provider_resources_created: false }, null, 2));
    return;
  }

  const llm = configuredCandidateLlmId ? await client.llm.retrieve(configuredCandidateLlmId) :
    ((await client.llm.create(llmPayload as never)) as AnyRecord);
  partialProviderState.candidate_llm_id = llm.llm_id;
  report.status = configuredCandidateLlmId ? "configured_llm_verified_agent_pending" : "llm_created_agent_pending";
  report.candidate = { llm_id: llm.llm_id };
  await writeJson(outputPath, report);
  const agentPayload = buildOutboundSinglePromptAgentPayload(outbound as AnyRecord, llm.llm_id, baseUrl);
  await writeJson(agentPayloadPath, agentPayload);
  const candidate = (await client.agent.create(agentPayload as never)) as AnyRecord;
  partialProviderState.candidate_agent_id = candidate.agent_id;
  report.status = "agent_created_publish_pending";
  report.candidate = { agent_id: candidate.agent_id, llm_id: llm.llm_id, version: candidate.version };
  await writeJson(outputPath, report);
  await publishAgentVersion(candidate.agent_id, candidate.version);

  const [candidateAfter, llmAfter, outboundPhoneAfter, receptionistPhoneAfter] = (await Promise.all([
    client.agent.retrieve(candidate.agent_id, { version: candidate.version }),
    client.llm.retrieve(llm.llm_id),
    client.phoneNumber.retrieve(OUTBOUND_PHONE_NUMBER),
    client.phoneNumber.retrieve(RECEPTIONIST_PHONE_NUMBER),
  ])) as AnyRecord[];
  const candidateBound = hasBinding(outboundPhoneAfter, candidate.agent_id) || hasBinding(receptionistPhoneAfter, candidate.agent_id);
  const bindingsPreserved =
    hasBinding(outboundPhoneAfter, OUTBOUND_AGENT_ID) &&
    hasBinding(receptionistPhoneAfter, INBOUND_SINGLE_PROMPT_AGENT_ID) &&
    !candidateBound;
  if (!bindingsPreserved) {
    throw new Error("Post-create phone binding readback did not preserve the two existing phone assignments");
  }

  report.status = "candidate_created_and_published";
  report.provider_resources_created = true;
  report.phone_binding_changed = false;
  report.candidate = {
    agent_id: candidateAfter.agent_id,
    llm_id: llmAfter.llm_id,
    version: candidateAfter.version,
    is_published: candidateAfter.is_published,
    response_engine: candidateAfter.response_engine,
    phone_bound: candidateBound,
    voice_id: candidateAfter.voice_id,
    voice_model: candidateAfter.voice_model,
    voice_speed: candidateAfter.voice_speed,
    begin_message_delay_ms: candidateAfter.begin_message_delay_ms,
    webhook_url: candidateAfter.webhook_url,
    tool_names: (llmAfter.general_tools ?? []).map((tool: AnyRecord) => tool.name),
  };
  report.phone_bindings_after = {
    outbound: bindingSummary(outboundPhoneAfter),
    receptionist: bindingSummary(receptionistPhoneAfter),
  };
  await writeJson(outputPath, report);
  console.log(
    JSON.stringify(
      {
        output_path: outputPath,
        status: report.status,
        candidate_agent_id: candidateAfter.agent_id,
        candidate_llm_id: llmAfter.llm_id,
        candidate_version: candidateAfter.version,
        candidate_phone_bound: candidateBound,
        phone_binding_changed: false,
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  const outputPath = path.resolve(process.cwd(), "generated", "outbound-single-prompt-report.json");
  const failure = {
    created_at: new Date().toISOString(),
    status: "failed",
    error: sanitizeError(error),
    ...partialProviderState,
  };
  await writeJson(outputPath, failure).catch(() => undefined);
  console.error(JSON.stringify({ output_path: outputPath, error: failure.error }, null, 2));
  process.exitCode = 1;
});
