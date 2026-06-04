import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { buildConversationFlowConfig, conversationFlowNodeGuide } from "../retell/conversationFlow";
import { createOrUpdateRetellAgent, RetellSetupReport } from "../retell/createAgent";
import { discoverCalComBookingUrl, CalComDiscoveryResult } from "../services/calcomDiscovery";
import { validateSetupEnv } from "../services/envValidation";

function printList(title: string, items: string[]) {
  if (items.length === 0) return;
  console.log(`\n${title}:`);
  items.forEach((item, index) => {
    const prefix = title.includes("steps") || title.includes("action") ? `${index + 1}.` : "-";
    console.log(`${prefix} ${item}`);
  });
}

function printReport(report: RetellSetupReport, calcom: CalComDiscoveryResult) {
  console.log("\nRetell setup result:", report.status);

  printList("Existing resource notes", report.old_resource_notes);
  printList("Automated", report.automated);
  printList("Failed", report.failed);
  printList("Manual Retell dashboard steps", report.manual_steps);
  printList("Verification checklist", report.verification_checklist);

  console.log("\nCal.com booking URL discovery:");
  console.log(`- Source: ${calcom.source}`);
  console.log(`- Status: ${calcom.status}`);
  console.log(`- Event types inspected: ${calcom.inspected_event_types}`);
  console.log(`- Booking URL verified: ${Boolean(calcom.booking_url)}`);
  printList("Cal.com warnings", calcom.warnings);
  if (!calcom.booking_url) printList("Cal.com setup steps", calcom.manual_steps);

  console.log("\nLive setup values:");
  console.log(`- Retell Agent ID: ${report.agent_id ?? ""}`);
  console.log(`- Conversation Flow ID: ${report.conversation_flow_id ?? ""}`);
  console.log(`- LLM ID: ${report.llm_id ?? ""}`);
  console.log(`- Response engine: ${report.response_engine_type ?? ""}`);
  console.log(`- Model used: ${report.model_used}`);
  console.log(`- Agent version: ${report.agent_version ?? ""}`);
  console.log(`- Published: ${report.published}`);
  console.log(`- Phone number bound: ${report.phone_bound}`);
  console.log(`- Webhook configured: ${report.webhook_configured}`);
  console.log(`- SMS mode: ${report.sms_mode}`);
  console.log(`- Calendar mode: ${report.calendar_mode}`);
  console.log(`- Booking URL status: ${report.booking_url_status}`);
}

async function writeGeneratedConfig(bookingUrlOverride = "") {
  const generatedDir = path.resolve(process.cwd(), "generated");
  await fs.mkdir(generatedDir, { recursive: true });
  const flowConfig = buildConversationFlowConfig({ bookingUrlOverride });
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
          conversation_flow_id: "<created_conversation_flow_id>",
        },
        voice_id: env.RETELL_VOICE_ID,
        agent_name: env.RETELL_AGENT_NAME,
        webhook_url: env.RETELL_WEBHOOK_URL,
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
        phone_binding: {
          phone_number: env.RETELL_PHONE_NUMBER || "<retell_phone_number>",
          inbound_agents: [
            {
              agent_id: "<created_agent_id>",
              agent_version: "<published_agent_version>",
              weight: 1,
            },
          ],
        },
        sms: {
          simulated: !env.RETELL_SMS_NODE_ENABLED && !env.RETELL_OUTBOUND_SMS_ENABLED,
          retell_sms_node_enabled: env.RETELL_SMS_NODE_ENABLED,
          retell_outbound_sms_enabled: env.RETELL_OUTBOUND_SMS_ENABLED,
          rule: "The agent may only say a text was sent when send_booking_sms returns sms_sent=true.",
        },
        calendar: {
          provider: env.CALENDAR_PROVIDER,
          rule: "Do not confirm appointments unless book_appointment_cal returns confirmed=true.",
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

async function main() {
  const validation = validateSetupEnv();
  printList("Env warnings", validation.warnings);
  printList("Env recommendations", validation.recommendations);

  const calcom = await discoverCalComBookingUrl();
  const bookingUrlOverride = calcom.booking_url || "";
  await writeGeneratedConfig(bookingUrlOverride);

  if (validation.missing.length > 0) {
    console.log("Retell setup result: PARTIALLY_MANUAL");
    console.log(`Missing required env lines:\n${validation.missing.join("\n")}`);
    console.log("Generated config files in generated/. Fill .env and rerun npm run setup:retell.");
    process.exitCode = 1;
    return;
  }

  const report = await createOrUpdateRetellAgent({
    bookingUrlOverride,
    bookingUrlStatus: calcom.status,
  });
  calcom.warnings.forEach((warning) => {
    if (!report.manual_steps.includes(warning)) report.manual_steps.push(warning);
    report.status = "PARTIALLY_MANUAL";
  });
  if (!bookingUrlOverride) {
    calcom.manual_steps.forEach((step) => {
      if (!report.manual_steps.includes(step)) report.manual_steps.push(step);
    });
    report.status = "PARTIALLY_MANUAL";
  }
  printReport(report, calcom);

  if (!report.agent_id || !report.published) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Retell setup failed unexpectedly", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
