import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { buildConversationFlowConfig, conversationFlowNodeGuide } from "../retell/conversationFlow";
import { getRetellClient } from "../retell/retellClient";
import { listRetellPhoneNumbersV2, listRetellVoiceAgentsV2 } from "../retell/retellList";
import { validateSetupEnv } from "../services/envValidation";

type AnyRecord = Record<string, any>;

const OLD_STALE_BASE_URL = "https://ae22-72-89-30-91.ngrok-free.app";
const TARGET_VOICE_SPEED = 1.12;
const TARGET_AGENT_SETTINGS = {
  ambient_sound: "coffee-shop",
  ambient_sound_volume: 1,
  responsiveness: 0.95,
  interruption_sensitivity: 0.75,
  denoising_mode: "noise-and-background-speech-cancellation",
  stt_mode: "accurate",
  end_call_after_silence_ms: 120000,
  max_call_duration_ms: 1020000,
  ring_duration_ms: 20000,
  enable_dynamic_responsiveness: true,
  enable_dynamic_voice_speed: true,
  voice_model: "eleven_v3",
  voice_temperature: 1.2,
} as const;
const DELETE_CANDIDATES = new Set([
  "agent_e184c8e476fb258a91f1c43b5f",
  "agent_21ba810cc8dabd9cdfc9a12720",
  "agent_a18d8c5f1a3703e9f882d9a568",
  "agent_31e6f030a3e7282171ae933bcb",
]);

interface SafetyRow {
  agent_id: string;
  agent_name: string;
  published_status_version: string;
  is_env_canonical: boolean;
  bound_to_any_phone_number: boolean;
  referenced_by_active_phone_binding: boolean;
  appears_related_to_pest_demo: boolean;
  action: "DELETE" | "KEEP" | "MANUAL REVIEW";
  reason: string;
}

interface RefineReport {
  readiness: "READY FOR LIVE RE-TEST" | "NOT READY";
  public_base_url: string;
  canonical_agent_id: string;
  canonical_agent_version_before: number | string | null;
  canonical_agent_version_after: number | string | null;
  canonical_conversation_flow_id: string;
  canonical_conversation_flow_version_before: number | string | null;
  canonical_conversation_flow_version_after: number | string | null;
  stale_urls_found: string[];
  webhook_url_after_update: string;
  tool_urls_after_update: Array<{ name: string; url: string }>;
  phone_binding_readback: unknown;
  voice_speed_before: number | null;
  voice_speed_after: number | null;
  voice_id_before: string | null;
  voice_id_after: string | null;
  voice_lookup: unknown;
  note_settings_before: Record<string, unknown>;
  note_settings_after: Record<string, unknown>;
  duplicate_safety_table: SafetyRow[];
  deleted_duplicate_agent_ids: string[];
  manual_review_agent_ids: string[];
  checks: string[];
  warnings: string[];
  canonical_change_reason?: string;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizedError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replaceAll(env.RETELL_API_KEY, "<redacted>")
    .replaceAll(env.RETELL_WEBHOOK_SECRET_OR_API_KEY, "<redacted>")
    .replaceAll(env.SUPABASE_SERVICE_ROLE_KEY, "<redacted>")
    .replaceAll(env.CALCOM_API_KEY, "<redacted>");
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function responseEngineId(agent: AnyRecord): string {
  return agent.response_engine?.conversation_flow_id ?? agent.response_engine?.llm_id ?? "";
}

function agentRows(listResult: unknown): AnyRecord[] {
  const result = listResult as AnyRecord;
  const items = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : [];
  const byId = new Map<string, AnyRecord>();
  for (const item of items) byId.set(item.agent_id, item);
  return Array.from(byId.values());
}

function phoneRows(listResult: unknown): AnyRecord[] {
  const result = listResult as AnyRecord;
  return Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : [];
}

function boundAgentIdsForPhone(phone: AnyRecord): string[] {
  const bindings = [
    ...(phone.inbound_agents ?? []),
    ...(phone.outbound_agents ?? []),
    ...(phone.inbound_sms_agents ?? []),
    ...(phone.outbound_sms_agents ?? []),
  ];
  return bindings.map((binding: AnyRecord) => binding.agent_id).filter(Boolean);
}

async function verifyPublicHealth() {
  const response = await fetch(`${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/health`);
  if (!response.ok) throw new Error(`Public health failed: HTTP ${response.status}`);
  const body = (await response.json()) as AnyRecord;
  if (body.ok !== true) throw new Error("Public health response did not return ok=true.");
  return body;
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
      version_description: "Elijah's Pest Control live refinement",
    }),
  });
  if (!response.ok) throw new Error(`Publish failed: HTTP ${response.status} ${await response.text()}`);
}

async function writeGeneratedConfig() {
  const generatedDir = path.resolve(process.cwd(), "generated");
  await fs.mkdir(generatedDir, { recursive: true });
  const flowConfig = buildConversationFlowConfig();
  await fs.writeFile(
    path.join(generatedDir, "retell-conversation-flow-config.json"),
    JSON.stringify(flowConfig, null, 2),
  );
  await fs.writeFile(
    path.join(generatedDir, "retell-conversation-flow-node-guide.json"),
    JSON.stringify(conversationFlowNodeGuide, null, 2),
  );
  await fs.writeFile(
    path.join(generatedDir, "retell-agent-config.json"),
    JSON.stringify(
      {
        response_engine: {
          type: "conversation-flow",
          conversation_flow_id: env.RETELL_CONVERSATION_FLOW_ID,
        },
        voice_id: env.RETELL_VOICE_ID,
        agent_name: env.RETELL_AGENT_NAME,
        webhook_url: env.RETELL_WEBHOOK_URL,
        phone_binding: {
          phone_number: "<redacted>",
          inbound_agents: [
            {
              agent_id: env.RETELL_AGENT_ID,
              agent_version: "<published_agent_version>",
              weight: 1,
            },
          ],
        },
        sms: {
          simulated: true,
          retell_sms_node_enabled: false,
          retell_outbound_sms_enabled: false,
          rule: "The agent may only say a text was sent when send_booking_sms returns sms_sent=true.",
        },
        calendar: {
          provider: env.CALENDAR_PROVIDER,
          rule: "Do not confirm appointments unless book_appointment_cal returns confirmed=true.",
        },
        note_specified_settings: {
          ...TARGET_AGENT_SETTINGS,
          voice_speed: TARGET_VOICE_SPEED,
          note: "Only these note-requested settings are changed by refine:retell; other agent settings are preserved unless broken.",
        },
        default_dynamic_variables: flowConfig.default_dynamic_variables,
        prompt_source: "src/retell/agentPrompt.ts",
        knowledge_base_source: "src/retell/knowledgeBase.ts",
      },
      null,
      2,
    ),
  );
}

async function backupJson(filename: string, payload: unknown) {
  const backupDir = path.resolve(process.cwd(), "generated", "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, filename);
  await fs.writeFile(backupPath, JSON.stringify(payload, null, 2));
  return backupPath;
}

async function backupGeneratedConfigs(stamp: string) {
  const backupDir = path.resolve(process.cwd(), "generated", "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const files = [
    "generated/retell-agent-config.json",
    "generated/retell-conversation-flow-config.json",
    "generated/retell-conversation-flow-node-guide.json",
  ];
  const written: string[] = [];
  for (const file of files) {
    const sourcePath = path.resolve(process.cwd(), file);
    try {
      const contents = await fs.readFile(sourcePath, "utf8");
      const backupPath = path.join(backupDir, `${stamp}-${path.basename(file)}`);
      await fs.writeFile(backupPath, contents);
      written.push(backupPath);
    } catch {
      // Generated files are helpful context, but missing files should not block live-agent refinement.
    }
  }
  return written;
}

async function relationCheck(agent: AnyRecord): Promise<boolean> {
  const name = String(agent.agent_name ?? "").toLowerCase();
  if (name.includes("elijah") || name.includes("pest") || name.includes("demo")) return true;
  if (!DELETE_CANDIDATES.has(agent.agent_id)) return false;

  const engineId = responseEngineId(agent);
  if (!engineId) return false;
  const client = getRetellClient();
  try {
    if (agent.response_engine?.type === "conversation-flow") {
      const flow = (await client.conversationFlow.retrieve(engineId)) as AnyRecord;
      const prompt = JSON.stringify(flow).toLowerCase();
      return prompt.includes("elijah") || prompt.includes("pest") || prompt.includes("greenshield");
    }
    if (agent.response_engine?.type === "retell-llm") {
      const llm = (await client.llm.retrieve(engineId)) as AnyRecord;
      const prompt = JSON.stringify(llm).toLowerCase();
      return prompt.includes("elijah") || prompt.includes("pest") || prompt.includes("greenshield");
    }
  } catch {
    return false;
  }
  return false;
}

async function buildSafetyTable(agents: AnyRecord[], phones: AnyRecord[], activePhone: AnyRecord) {
  const allBoundIds = new Set(phones.flatMap(boundAgentIdsForPhone));
  const activeBoundIds = new Set(boundAgentIdsForPhone(activePhone));
  const table: SafetyRow[] = [];

  for (const agent of agents) {
    const isCanonical = agent.agent_id === env.RETELL_AGENT_ID;
    const boundAny = allBoundIds.has(agent.agent_id);
    const activeRef = activeBoundIds.has(agent.agent_id);
    const related = await relationCheck(agent);
    let action: SafetyRow["action"] = "KEEP";
    let reason = "Not a duplicate cleanup target.";

    if (isCanonical) {
      action = "KEEP";
      reason = "Canonical .env agent.";
    } else if (boundAny || activeRef) {
      action = "KEEP";
      reason = "Referenced by a Retell phone binding.";
    } else if (DELETE_CANDIDATES.has(agent.agent_id) && related) {
      action = "DELETE";
      reason = "Approved duplicate candidate, unbound, non-canonical, and related to the pest demo.";
    } else if (DELETE_CANDIDATES.has(agent.agent_id) && !related) {
      action = "MANUAL REVIEW";
      reason = "Approved candidate ID but relation to this pest demo was not provable.";
    } else if (related && !boundAny) {
      action = "MANUAL REVIEW";
      reason = "Looks related to the pest demo but was not in the explicit deletion candidate list.";
    }

    table.push({
      agent_id: agent.agent_id,
      agent_name: agent.agent_name ?? "",
      published_status_version: `${agent.is_published ? "published" : "unpublished"} / v${agent.version}`,
      is_env_canonical: isCanonical,
      bound_to_any_phone_number: boundAny,
      referenced_by_active_phone_binding: activeRef,
      appears_related_to_pest_demo: related,
      action,
      reason,
    });
  }

  return table;
}

function findStaleUrls(agent: AnyRecord, flow: AnyRecord) {
  const found: string[] = [];
  if (String(agent.webhook_url ?? "").includes(OLD_STALE_BASE_URL)) found.push(String(agent.webhook_url));
  for (const tool of flow.tools ?? []) {
    if (String(tool.url ?? "").includes(OLD_STALE_BASE_URL)) found.push(String(tool.url));
  }
  return unique(found);
}

function normalizedPostCallAnalysisData(items: unknown) {
  if (!Array.isArray(items)) return undefined;
  const hasSystemCallSummary = items.some(
    (item: AnyRecord) => item?.name === "call_summary" && item?.type === "system-presets",
  );
  const seenNames = new Set<string>();
  const normalized: AnyRecord[] = [];

  for (const item of items as AnyRecord[]) {
    if (!item?.name) continue;
    if (hasSystemCallSummary && item.name === "call_summary" && item.type !== "system-presets") continue;
    if (seenNames.has(item.name)) continue;
    seenNames.add(item.name);
    normalized.push(item);
  }

  return normalized;
}

function noteSettings(agent: AnyRecord) {
  return {
    voice_model: agent.voice_model ?? null,
    voice_temperature: agent.voice_temperature ?? null,
    ambient_sound: agent.ambient_sound ?? null,
    ambient_sound_volume: agent.ambient_sound_volume ?? null,
    responsiveness: agent.responsiveness ?? null,
    interruption_sensitivity: agent.interruption_sensitivity ?? null,
    denoising_mode: agent.denoising_mode ?? null,
    stt_mode: agent.stt_mode ?? null,
    end_call_after_silence_ms: agent.end_call_after_silence_ms ?? null,
    max_call_duration_ms: agent.max_call_duration_ms ?? null,
    ring_duration_ms: agent.ring_duration_ms ?? null,
    allow_dtmf_interruption: agent.allow_dtmf_interruption ?? null,
    allow_user_dtmf: agent.allow_user_dtmf ?? null,
    enable_dynamic_responsiveness: agent.enable_dynamic_responsiveness ?? null,
    enable_dynamic_voice_speed: agent.enable_dynamic_voice_speed ?? null,
    begin_message_delay_ms: agent.begin_message_delay_ms ?? null,
    enable_backchannel: agent.enable_backchannel ?? null,
    backchannel_frequency: agent.backchannel_frequency ?? null,
    backchannel_words: agent.backchannel_words ?? null,
    normalize_for_speech: agent.normalize_for_speech ?? null,
    handbook_config: agent.handbook_config ?? null,
  };
}

async function verifyTargetVoice(client: ReturnType<typeof getRetellClient>) {
  const targetVoiceId = env.RETELL_VOICE_ID || "11labs-Cimo";
  try {
    const voice = await client.voice.retrieve(targetVoiceId);
    return {
      voice_id: voice.voice_id,
      voice_name: voice.voice_name,
      provider: voice.provider,
      gender: voice.gender,
      accent: voice.accent ?? null,
      age: voice.age ?? null,
    };
  } catch (error) {
    const voices = await client.voice.list();
    const cimoMatches = voices
      .filter((voice: AnyRecord) => /cimo/i.test(`${voice.voice_id} ${voice.voice_name}`))
      .map((voice: AnyRecord) => ({
        voice_id: voice.voice_id,
        voice_name: voice.voice_name,
        provider: voice.provider,
        gender: voice.gender,
        accent: voice.accent ?? null,
        age: voice.age ?? null,
      }));
    throw new Error(
      `RETELL_VOICE_ID ${targetVoiceId} could not be retrieved: ${sanitizedError(error)}. Cimo matches: ${JSON.stringify(
        cimoMatches,
      )}`,
    );
  }
}

async function main() {
  const report: RefineReport = {
    readiness: "NOT READY",
    public_base_url: env.PUBLIC_BASE_URL,
    canonical_agent_id: env.RETELL_AGENT_ID,
    canonical_agent_version_before: null,
    canonical_agent_version_after: null,
    canonical_conversation_flow_id: env.RETELL_CONVERSATION_FLOW_ID,
    canonical_conversation_flow_version_before: null,
    canonical_conversation_flow_version_after: null,
    stale_urls_found: [],
    webhook_url_after_update: "",
    tool_urls_after_update: [],
    phone_binding_readback: null,
    voice_speed_before: null,
    voice_speed_after: null,
    voice_id_before: null,
    voice_id_after: null,
    voice_lookup: null,
    note_settings_before: {},
    note_settings_after: {},
    duplicate_safety_table: [],
    deleted_duplicate_agent_ids: [],
    manual_review_agent_ids: [],
    checks: [],
    warnings: [],
    canonical_change_reason:
      "Canonical source of truth is the Retell agent currently bound to the phone number, per user instruction after a successful live phone connection.",
  };

  const validation = validateSetupEnv();
  if (validation.missing.length > 0) throw new Error(`Missing required env lines: ${validation.missing.join(", ")}`);
  if (!env.RETELL_AGENT_ID || !env.RETELL_CONVERSATION_FLOW_ID) {
    throw new Error("RETELL_AGENT_ID and RETELL_CONVERSATION_FLOW_ID are required for refinement.");
  }
  if (env.RETELL_SMS_NODE_ENABLED || env.RETELL_OUTBOUND_SMS_ENABLED || env.SMS_MODE !== "retell") {
    throw new Error("SMS safety flags are not in the approved simulated state.");
  }
  if (env.CALENDAR_PROVIDER !== "none") throw new Error("CALENDAR_PROVIDER must remain none for this refinement.");

  await verifyPublicHealth();
  report.checks.push(`Public health OK at ${env.PUBLIC_BASE_URL}/health.`);

  const client = getRetellClient();
  report.voice_lookup = await verifyTargetVoice(client);
  report.checks.push(`Verified Retell voice ${env.RETELL_VOICE_ID || "11labs-Cimo"} exists before mutation.`);
  const [agentBefore, flowBefore, phoneBefore, phoneListResult, agentListResult] = await Promise.all([
    client.agent.retrieve(env.RETELL_AGENT_ID) as Promise<AnyRecord>,
    client.conversationFlow.retrieve(env.RETELL_CONVERSATION_FLOW_ID) as Promise<AnyRecord>,
    client.phoneNumber.retrieve(env.RETELL_PHONE_NUMBER) as Promise<AnyRecord>,
    listRetellPhoneNumbersV2({ apiKey: env.RETELL_API_KEY }),
    listRetellVoiceAgentsV2({ apiKey: env.RETELL_API_KEY }),
  ]);

  report.canonical_agent_version_before = agentBefore.version;
  report.canonical_conversation_flow_version_before = flowBefore.version;
  report.voice_speed_before = typeof agentBefore.voice_speed === "number" ? agentBefore.voice_speed : null;
  report.voice_id_before = agentBefore.voice_id ?? null;
  report.note_settings_before = noteSettings(agentBefore);
  report.stale_urls_found = findStaleUrls(agentBefore, flowBefore);

  const activeInbound = phoneBefore.inbound_agents ?? [];
  const activeBinding = activeInbound.find((binding: AnyRecord) => binding.agent_id === env.RETELL_AGENT_ID);
  if (!activeBinding) throw new Error("Phone binding does not point to RETELL_AGENT_ID; refusing to refine.");
  if (agentBefore.response_engine?.type !== "conversation-flow") {
    throw new Error("Canonical agent is not using Conversation Flow; refusing to refine without explicit approval.");
  }
  if (agentBefore.response_engine?.conversation_flow_id !== env.RETELL_CONVERSATION_FLOW_ID) {
    throw new Error("Canonical agent response engine does not match RETELL_CONVERSATION_FLOW_ID.");
  }

  const stamp = timestamp();
  const agentBackupPath = await backupJson(`${stamp}-${env.RETELL_AGENT_ID}-before-refine.json`, agentBefore);
  const flowBackupPath = await backupJson(`${stamp}-${env.RETELL_CONVERSATION_FLOW_ID}-before-refine.json`, flowBefore);
  const phoneBackupPath = await backupJson(`${stamp}-${env.RETELL_PHONE_NUMBER.replace(/^\+/, "")}-phone-before-refine.json`, phoneBefore);
  const generatedBackups = await backupGeneratedConfigs(stamp);
  report.checks.push(`Backed up canonical agent to ${agentBackupPath}.`);
  report.checks.push(`Backed up canonical flow to ${flowBackupPath}.`);
  report.checks.push(`Backed up phone binding to ${phoneBackupPath}.`);
  if (generatedBackups.length > 0) {
    report.checks.push(`Backed up generated configs: ${generatedBackups.join(", ")}.`);
  }

  const flowConfig = buildConversationFlowConfig();
  let targetAgentVersion = agentBefore.version;
  let targetFlowVersion = flowBefore.version;
  let updatedFlow: AnyRecord;
  try {
    updatedFlow = (await client.conversationFlow.update(
      env.RETELL_CONVERSATION_FLOW_ID,
      flowConfig as never,
    )) as AnyRecord;
  } catch (error) {
    const message = sanitizedError(error);
    if (!message.includes("Cannot update published conversation flow")) throw error;
    const draftAgent = (await client.agent.createVersion(env.RETELL_AGENT_ID, {
      base_version: agentBefore.version,
    })) as AnyRecord;
    targetAgentVersion = draftAgent.version;
    targetFlowVersion = draftAgent.response_engine?.version ?? targetAgentVersion;
    report.checks.push(
      `Created draft agent version ${targetAgentVersion} from published version ${agentBefore.version} so the Conversation Flow draft can be updated.`,
    );
    updatedFlow = (await client.conversationFlow.update(
      env.RETELL_CONVERSATION_FLOW_ID,
      { ...(flowConfig as AnyRecord), version: targetFlowVersion } as never,
    )) as AnyRecord;
  }
  report.canonical_conversation_flow_version_after = updatedFlow.version;

  const agentUpdatePayload: AnyRecord = {
    response_engine: {
      type: "conversation-flow",
      conversation_flow_id: env.RETELL_CONVERSATION_FLOW_ID,
      version: targetFlowVersion,
    },
    agent_name: agentBefore.agent_name,
    voice_id: env.RETELL_VOICE_ID || agentBefore.voice_id,
    voice_speed: TARGET_VOICE_SPEED,
    webhook_url: env.RETELL_WEBHOOK_URL,
    webhook_events: agentBefore.webhook_events,
    webhook_timeout_ms: agentBefore.webhook_timeout_ms,
    ...TARGET_AGENT_SETTINGS,
    enable_backchannel: agentBefore.enable_backchannel,
    backchannel_frequency: agentBefore.backchannel_frequency,
    backchannel_words: agentBefore.backchannel_words,
    normalize_for_speech: agentBefore.normalize_for_speech,
    handbook_config: {
      ...(agentBefore.handbook_config ?? {}),
      high_empathy: true,
    },
    post_call_analysis_data: normalizedPostCallAnalysisData(agentBefore.post_call_analysis_data),
    analysis_summary_prompt: agentBefore.analysis_summary_prompt,
    analysis_user_sentiment_prompt: agentBefore.analysis_user_sentiment_prompt,
    timezone: agentBefore.timezone,
    language: agentBefore.language,
    version_description: "Elijah's Pest Control live refinement",
    version: targetAgentVersion,
  };
  Object.keys(agentUpdatePayload).forEach((key) => {
    if (agentUpdatePayload[key] === undefined) delete agentUpdatePayload[key];
  });

  const updatedAgent = (await client.agent.update(env.RETELL_AGENT_ID, agentUpdatePayload as never)) as AnyRecord;
  report.canonical_agent_version_after = updatedAgent.version;
  if (typeof targetAgentVersion !== "number") throw new Error("Target agent version is not numeric.");

  await publishAgentVersion(env.RETELL_AGENT_ID, targetAgentVersion);
  await client.phoneNumber.update(env.RETELL_PHONE_NUMBER, {
    inbound_agents: [{ agent_id: env.RETELL_AGENT_ID, agent_version: targetAgentVersion, weight: 1 }],
  });

  await writeGeneratedConfig();

  const [agentAfter, flowAfter, phoneAfter] = await Promise.all([
    client.agent.retrieve(env.RETELL_AGENT_ID) as Promise<AnyRecord>,
    client.conversationFlow.retrieve(env.RETELL_CONVERSATION_FLOW_ID) as Promise<AnyRecord>,
    client.phoneNumber.retrieve(env.RETELL_PHONE_NUMBER) as Promise<AnyRecord>,
  ]);

  report.webhook_url_after_update = agentAfter.webhook_url ?? "";
  report.tool_urls_after_update = (flowAfter.tools ?? []).map((tool: AnyRecord) => ({ name: tool.name, url: tool.url }));
  report.phone_binding_readback = {
    inbound_agents: phoneAfter.inbound_agents,
  };
  report.voice_speed_after = typeof agentAfter.voice_speed === "number" ? agentAfter.voice_speed : null;
  report.voice_id_after = agentAfter.voice_id ?? null;
  report.note_settings_after = noteSettings(agentAfter);

  const phones = phoneRows(phoneListResult);
  const agents = agentRows(agentListResult);
  const safetyTable = await buildSafetyTable(agents, phones.length > 0 ? phones : [phoneAfter], phoneAfter);
  report.duplicate_safety_table = safetyTable;

  const deleteDuplicates = process.env.RETELL_DELETE_DUPLICATES === "true";
  for (const row of safetyTable.filter((item) => item.action === "DELETE")) {
    if (!deleteDuplicates) {
      row.action = "MANUAL REVIEW";
      row.reason = `${row.reason} Deletion skipped because RETELL_DELETE_DUPLICATES is not true.`;
      report.manual_review_agent_ids.push(row.agent_id);
      continue;
    }
    try {
      await client.agent.delete(row.agent_id);
      report.deleted_duplicate_agent_ids.push(row.agent_id);
    } catch (error) {
      row.action = "MANUAL REVIEW";
      row.reason = `Delete failed: ${sanitizedError(error)}`;
      report.manual_review_agent_ids.push(row.agent_id);
    }
  }
  report.manual_review_agent_ids.push(
    ...safetyTable.filter((item) => item.action === "MANUAL REVIEW").map((item) => item.agent_id),
  );
  report.manual_review_agent_ids = unique(report.manual_review_agent_ids);

  const staleAfter = findStaleUrls(agentAfter, flowAfter);
  if (staleAfter.length > 0) report.warnings.push(`Stale URLs still present: ${staleAfter.join(", ")}`);
  if (agentAfter.webhook_url !== env.RETELL_WEBHOOK_URL) report.warnings.push("Agent webhook URL does not match .env.");
  if (report.tool_urls_after_update.some((tool) => !tool.url.startsWith(env.TOOLS_BASE_URL))) {
    report.warnings.push("One or more flow tool URLs do not match TOOLS_BASE_URL.");
  }
  const finalBinding = (phoneAfter.inbound_agents ?? []).find((binding: AnyRecord) => binding.agent_id === env.RETELL_AGENT_ID);
  if (!finalBinding) report.warnings.push("Phone binding readback does not include canonical agent.");

  report.readiness = report.warnings.length === 0 ? "READY FOR LIVE RE-TEST" : "NOT READY";

  const reportPath = path.resolve(process.cwd(), "generated", "refine-retell-report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`Retell refinement failed: ${sanitizedError(error)}`);
  process.exitCode = 1;
});
