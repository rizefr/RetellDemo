import { env } from "../config/env";
import { buildAgentPrompt } from "./agentPrompt";
import { buildCustomToolDefinitions, buildRetellControlTools } from "./tools";

export function buildConversationFlowConfig(options: { bookingUrlOverride?: string } = {}) {
  const bookingUrl = options.bookingUrlOverride || env.BOOKING_URL;
  const smsModeDescription = env.RETELL_SMS_NODE_ENABLED
    ? "Retell SMS action may be available, but only use it if setup verification confirms SMS success."
    : "Backend SMS tool is active; it may simulate SMS unless provider configuration is verified.";
  const bookingModeDescription = bookingUrl
    ? "Use the configured booking URL when SMS succeeds."
    : "No verified booking URL is configured. Capture the lead and say the team can follow up.";

  const customTools = buildCustomToolDefinitions();
  const controlTools = buildRetellControlTools();
  const customToolIds = customTools.map((tool) => tool.tool_id);

  return {
    model_choice: { type: "cascading", model: "gpt-4.1" },
    model_temperature: 0.2,
    tool_call_strict_mode: true,
    start_speaker: "agent",
    start_node_id: "receptionist",
    global_prompt: buildAgentPrompt({
      businessName: env.DEFAULT_BUSINESS_NAME,
      timezone: env.DEFAULT_BUSINESS_TIMEZONE,
      smsModeDescription,
      bookingModeDescription,
    }),
    default_dynamic_variables: {
      business_name: env.DEFAULT_BUSINESS_NAME,
      booking_url: bookingUrl,
      transfer_number: env.RETELL_TRANSFER_PHONE_NUMBER,
    },
    tools: customTools,
    nodes: [
      {
        id: "receptionist",
        type: "subagent",
        name: "Pest Control Receptionist",
        instruction: {
          type: "prompt",
          text: "Follow the global receptionist prompt. Greet the caller, classify intent, answer from the knowledge base, collect leads, prefer SMS booking, transfer urgent or human-request calls, and close cleanly.",
        },
        tool_ids: customToolIds,
        tools: controlTools,
      },
    ],
    notes: [
      {
        id: "flow_notes",
        content:
          "Baseline demo flow: Greeting -> Intent Detection -> FAQ/Service Intake -> Urgency Check -> SMS Booking or Phone Booking -> Transfer/Fallback -> Closing.",
        display_position: { x: 0, y: -250 },
        size: { width: 420, height: 120 },
      },
    ],
  } as const;
}

export const conversationFlowNodeGuide = [
  {
    name: "Greeting",
    purpose: "Start the call naturally and ask how to help.",
    behavior: "Thank the caller for calling the business.",
    fallback: "If silence, ask once more how to help.",
  },
  {
    name: "Intent Detection",
    purpose: "Determine FAQ, service request, urgent transfer, human request, or fallback.",
    behavior: "Ask one concise clarifying question when needed.",
    fallback: "Offer transfer or follow-up capture.",
  },
  {
    name: "SMS Booking",
    purpose: "Collect pest issue, first name, phone, optional city/ZIP, create lead, and send or simulate SMS.",
    behavior: "Only claim SMS success when tool result confirms sent.",
    fallback: "If SMS is simulated or failed, say the request is saved and the team can follow up.",
  },
  {
    name: "Phone Booking",
    purpose: "Collect preferred day/time and use calendar adapter if enabled.",
    behavior: "Never confirm without booking API confirmation.",
    fallback: "Create a lead and offer SMS booking link.",
  },
  {
    name: "Transfer",
    purpose: "Handle urgent, dangerous, distressed, unsupported, or live-person requests.",
    behavior: "Say the transfer line and use Retell transfer_call.",
    fallback: "If transfer setup is missing, capture lead for follow-up.",
  },
  {
    name: "Closing",
    purpose: "Ask if anything else is needed and end cleanly.",
    behavior: `Say "Thank you for calling ${env.DEFAULT_BUSINESS_NAME}, have a great day." and use end_call.`,
    fallback: "If the caller asks another question, continue helping.",
  },
];
