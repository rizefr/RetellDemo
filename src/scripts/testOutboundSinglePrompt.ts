import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { buildOutboundSinglePromptLlmPayload } from "../retell/outboundSinglePrompt";
import { getRetellClient } from "../retell/retellClient";

type AnyRecord = Record<string, any>;

type Scenario = {
  name: string;
  messages: AnyRecord[];
  expectText?: RegExp[];
  rejectText?: RegExp[];
  expectTools?: string[];
  rejectTools?: string[];
  expectCallEnded?: boolean;
};

const toolMocks = [
  ["log_outcome", { logged: true, outcome: "manual_review", outreach_paused: false }],
  ["create_payment_link", { created: true, reused: false, status: "open", url: "https://checkout.example.test/demo" }],
  ["send_payment_email", { sent: true, status: "email_sent" }],
  ["send_payment_sms", { sent: false, status: "sms_pending_manual" }],
  ["request_human_transfer", { transfer_available: false, status: "human_requested" }],
  ["schedule_followup", { scheduled: true, task_count: 1 }],
  [
    "schedule_callback",
    {
      scheduled: false,
      needs_confirmation: true,
      scheduled_for_spoken: "Friday, July tenth, twenty twenty-six at 2:00 PM Eastern",
      message_for_agent: "Ask the caller to confirm Friday at 2:00 PM Eastern.",
    },
  ],
].map(([tool_name, output]) => ({
  tool_name,
  input_match_rule: { type: "any" as const },
  output: JSON.stringify(output),
}));

const opening = "Hello, I'm calling from Pinnacle Elevator Inspections. Is this Taylor?";
const invoiceContext =
  "Nice to meet you, Taylor. I'm Paul. Our records show the Category 1 invoice from May twentieth, twenty twenty-six is overdue. I'm following up to make sure it was received.";

const scenarios: Scenario[] = [
  {
    name: "opening uses dynamic business and customer",
    messages: [{ role: "user", content: "Hello?" }],
    expectText: [/Pinnacle Elevator Inspections/i, /Taylor/i],
    rejectText: [/Elixis Elevator Systems/i, /virtual assistant/i],
  },
  {
    name: "email preference confirms address before tools",
    messages: [
      { role: "agent", content: opening },
      { role: "user", content: "Yes." },
      { role: "agent", content: invoiceContext },
      { role: "user", content: "We received it. I want to pay now by email." },
    ],
    expectText: [/b i l l i n g.*at example.*dot com/i, /best email|correct/i],
    rejectText: [/I sent/i, /virtual assistant/i],
    rejectTools: ["create_payment_link", "send_payment_email"],
  },
  {
    name: "confirmed email creates and sends exact link",
    messages: [
      { role: "agent", content: opening },
      { role: "user", content: "Yes." },
      { role: "agent", content: invoiceContext },
      { role: "user", content: "We received it. Email the payment link." },
      { role: "agent", content: "Is b i l l i n g, at example, dot com still the best email for the secure payment link?" },
      { role: "user", content: "Yes, that's correct." },
    ],
    expectText: [/sent|email/i],
    rejectText: [/@/],
    expectTools: ["log_outcome", "create_payment_link", "send_payment_email"],
    rejectTools: ["send_payment_sms"],
  },
  {
    name: "SMS disabled never creates a payment link first",
    messages: [
      { role: "agent", content: opening },
      { role: "user", content: "Yes." },
      { role: "agent", content: invoiceContext },
      { role: "user", content: "We received it. Text the link to this number." },
      { role: "agent", content: "Is the number I'm calling, area code three four seven, then five eight five, then zero two four nine, the best number to text the secure link?" },
      { role: "user", content: "Yes." },
    ],
    expectText: [/team|follow up|note/i],
    rejectText: [/SMS|disabled|manual/i],
    expectTools: ["log_outcome", "send_payment_sms"],
    rejectTools: ["create_payment_link", "send_payment_email"],
  },
  {
    name: "callback uses resolver before speaking a normalized time",
    messages: [
      { role: "agent", content: opening },
      { role: "user", content: "Yes, call me back tomorrow at 2 PM." },
    ],
    expectText: [/Friday|2:00|confirm/i],
    expectTools: ["schedule_callback"],
  },
  {
    name: "human request uses availability tool and safe fallback",
    messages: [
      { role: "agent", content: opening },
      { role: "user", content: "I want to speak with a person." },
    ],
    expectText: [/team|follow up|person/i],
    expectTools: ["request_human_transfer"],
    rejectTools: ["transfer_call"],
  },
  {
    name: "wrong number logs and ends without opt-out language",
    messages: [
      { role: "agent", content: opening },
      { role: "user", content: "No, this is the wrong number and not that company." },
    ],
    expectText: [/sorry|review the contact/i],
    rejectText: [/stop calling|remove.*list/i],
    expectTools: ["log_outcome", "end_wrong_number_call"],
    expectCallEnded: true,
  },
  {
    name: "explicit opt out logs and hard ends",
    messages: [
      { role: "agent", content: opening },
      { role: "user", content: "Stop calling me and remove this number from your list." },
    ],
    expectText: [/understood|goodbye/i],
    expectTools: ["log_outcome", "end_hard_terminal_call"],
    expectCallEnded: true,
  },
];

function transcriptText(messages: AnyRecord[]) {
  return messages
    .filter((message) => message.role === "agent")
    .map((message) => String(message.content || ""))
    .join(" ");
}

function invokedTools(messages: AnyRecord[]) {
  return messages
    .filter((message) => message.role === "tool_call_invocation")
    .map((message) => String(message.name));
}

function evaluate(scenario: Scenario, result: AnyRecord) {
  const text = transcriptText(result.messages ?? []);
  const tools = invokedTools(result.messages ?? []);
  const failures: string[] = [];
  for (const pattern of scenario.expectText ?? []) {
    if (!pattern.test(text)) failures.push(`missing text ${pattern}`);
  }
  for (const pattern of scenario.rejectText ?? []) {
    if (pattern.test(text)) failures.push(`forbidden text ${pattern}`);
  }
  for (const tool of scenario.expectTools ?? []) {
    if (!tools.includes(tool)) failures.push(`missing tool ${tool}`);
  }
  for (const tool of scenario.rejectTools ?? []) {
    if (tools.includes(tool)) failures.push(`forbidden tool ${tool}`);
  }
  if (scenario.expectCallEnded !== undefined && Boolean(result.call_ended) !== scenario.expectCallEnded) {
    failures.push(`call_ended was ${Boolean(result.call_ended)}, expected ${scenario.expectCallEnded}`);
  }
  return { passed: failures.length === 0, failures, text, tools, call_ended: Boolean(result.call_ended) };
}

async function main() {
  const agentId = env.OUTBOUND_RETELL_SINGLE_PROMPT_AGENT_ID;
  if (!agentId) throw new Error("OUTBOUND_RETELL_SINGLE_PROMPT_AGENT_ID is required");
  const client = getRetellClient();
  const versions = (await client.agent.getVersions(agentId)) as AnyRecord[];
  const published = versions
    .filter((version) => version.is_published === true)
    .sort((left, right) => Number(right.version) - Number(left.version))[0];
  if (!published) throw new Error(`No published version exists for ${agentId}`);

  const defaultVariables = buildOutboundSinglePromptLlmPayload("https://elixis.agency").default_dynamic_variables;
  const dynamicVariables = {
    ...defaultVariables,
    business_name: "Pinnacle Elevator Inspections",
    business_name_spoken: "Pinnacle Elevator Inspections",
    customer_first_name: "Taylor",
    customer_first_name_spoken: "Taylor",
    account_company_name: "Pinnacle Demo Building",
    account_company_name_spoken: "Pinnacle Demo Building",
    customer_email_display: "billing@example.com",
    customer_email_spoken_slow: "b i l l i n g, at example, dot com",
    customer_email_spoken_phonetic:
      "b as in Bravo, i as in India, l as in Lima, l as in Lima, i as in India, n as in November, g as in Golf, at example dot com",
    customer_phone_spoken_chunked: "area code three four seven, then five eight five, then zero two four nine",
  };

  const results = [];
  for (const scenario of scenarios) {
    try {
      const completion = (await client.playground.completion(agentId, {
        version: published.version,
        messages: scenario.messages as never,
        dynamic_variables: dynamicVariables,
        tool_mocks: toolMocks as never,
      })) as AnyRecord;
      results.push({ name: scenario.name, ...evaluate(scenario, completion), messages: completion.messages });
    } catch (error) {
      results.push({
        name: scenario.name,
        passed: false,
        failures: [error instanceof Error ? error.message : String(error)],
        text: "",
        tools: [],
        call_ended: false,
      });
    }
  }

  const passed = results.filter((result) => result.passed).length;
  const output = {
    created_at: new Date().toISOString(),
    agent_id: agentId,
    agent_version: published.version,
    scenario_count: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
  const outputPath = path.resolve(process.cwd(), "generated", "outbound-single-prompt-smoke.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ output_path: outputPath, ...output, results: undefined }, null, 2));
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
