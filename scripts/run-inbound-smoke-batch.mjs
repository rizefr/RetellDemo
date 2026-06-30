import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const env = { ...process.env };
  if (!fs.existsSync(".env")) return env;
  for (const line of fs.readFileSync(".env", "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    env[line.slice(0, index).trim()] ??= line.slice(index + 1).trim();
  }
  return env;
}

const env = loadEnv();
const llmId = env.RETELL_SINGLE_PROMPT_CANDIDATE_LLM_ID || "llm_e8bb285e8cb0fc562f06e2395a78";
const llmVersion = Number(env.RETELL_TEST_LLM_VERSION || "26");

async function retell(method, endpoint, body) {
  const response = await fetch(`https://api.retellai.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.RETELL_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${method} ${endpoint} HTTP ${response.status}: ${text.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

const engine = { type: "retell-llm", llm_id: llmId, version: llmVersion };
const dynamicVariables = {
  business_name: "Elijah's Pest Control",
  booking_placeholder_email: env.BOOKING_PLACEHOLDER_EMAIL || "demo@example.com",
  user_number: "+17185550100",
  call_id: "codex_inbound_smoke",
};

function mocks(name) {
  const bookingFailure = /failure/i.test(name);
  return [
    {
      tool_name: "create_lead",
      input_match_rule: { type: "any" },
      output: JSON.stringify({
        success: true,
        persisted: true,
        lead_id: "test_lead",
        caller_phone: "+17185550100",
        alternate_phone: null,
        message_for_agent: "Lead saved. Continue the flow.",
      }),
    },
    {
      tool_name: "check_availability_cal",
      input_match_rule: { type: "any" },
      output: JSON.stringify({
        success: true,
        enabled: true,
        provider: "calcom",
        available: true,
        slots: ["2026-07-01T09:00:00-04:00", "2026-07-01T11:00:00-04:00", "2026-07-01T14:00:00-04:00"],
      }),
    },
    {
      tool_name: "book_appointment_cal",
      input_match_rule: { type: "any" },
      output: JSON.stringify(
        bookingFailure
          ? { success: false, confirmed: false, message_for_agent: "Booking failed. Do not confirm." }
          : { success: true, confirmed: true, booking_id: "test_booking", confirmed_datetime: "2026-07-01T11:00:00-04:00" },
      ),
    },
    {
      tool_name: "log_transfer_request",
      input_match_rule: { type: "any" },
      output: JSON.stringify({ success: true, transfer_number_configured: true }),
      result: true,
    },
    { tool_name: "end_call", input_match_rule: { type: "any" }, output: JSON.stringify({ success: true }), result: true },
  ];
}

const scenarios = [
  {
    name: "concise service list",
    user_prompt: "What types of services do you have?",
    metric: "Answers with a short ranging-from service summary and asks what pest issue the caller has. Does not read a long list.",
  },
  {
    name: "ants phone booking echo verification",
    user_prompt:
      "I have ants in my kitchen. They are small and mostly by the sink. My name is Maria, this number is best, address is 25 Pine Street Brooklyn 11201, and tomorrow at 11 works.",
    metric: "Shows light empathy, asks a useful ant detail, collects booking fields, checks availability, echo-verifies, and confirms only after book_appointment_cal succeeds.",
  },
  {
    name: "text link request becomes follow-up",
    user_prompt: "Can you just text me a booking link for roach service? My name is Jordan and this number is good.",
    metric: "Does not offer SMS booking or claim a text was sent. Saves a follow-up request instead.",
  },
  {
    name: "immediate transfer objection",
    user_prompt: "I want to be transferred immediately.",
    metric: "For a non-urgent first request, tries once to steer to scheduling because the team may be out in the field; transfers if caller still insists.",
  },
  {
    name: "urgent hornet transfer",
    user_prompt: "There's a hornet nest by my front door and my kid got stung. This is urgent.",
    metric: "Transfers quickly without normal booking intake.",
  },
  {
    name: "booking failure fallback",
    user_prompt:
      "Book me for ants tomorrow at 11. My name is Eli, this number is best, and address is 123 Ocean Parkway Brooklyn.",
    metric: "If booking fails, does not confirm the appointment and says the request was saved for follow-up.",
  },
];

async function cleanup(ids) {
  const results = [];
  for (const id of ids) {
    try {
      await retell("DELETE", `/delete-test-case-definition/${id}`);
      results.push({ id, deleted: true });
    } catch (error) {
      results.push({ id, deleted: false, error: error.message });
    }
  }
  return results;
}

async function waitForBatch(batchId) {
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const batch = await retell("GET", `/get-batch-test/${batchId}`);
    if (batch.status === "complete") return batch;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Timed out waiting for ${batchId}`);
}

async function main() {
  const created = [];
  try {
    for (const scenario of scenarios) {
      const definition = await retell("POST", "/create-test-case-definition", {
        name: `codex inbound final ${scenario.name}`,
        response_engine: engine,
        user_prompt: scenario.user_prompt,
        metrics: [scenario.metric],
        dynamic_variables: dynamicVariables,
        llm_model: "gpt-4.1",
        tool_mocks: mocks(scenario.name),
      });
      created.push(definition.test_case_definition_id);
    }
    const batch = await retell("POST", "/create-batch-test", {
      response_engine: engine,
      test_case_definition_ids: created,
    });
    const completed = await waitForBatch(batch.test_case_batch_job_id);
    const runs = await retell("GET", `/v2/list-test-runs/${batch.test_case_batch_job_id}?limit=50`);
    const deleted = await cleanup(created);
    const output = {
      created_at: new Date().toISOString(),
      response_engine: engine,
      batch: completed,
      runs: runs.items ?? [],
      temporary_test_definitions_deleted: deleted.every((item) => item.deleted),
      deleted,
    };
    const outPath = path.resolve("generated", `inbound-smoke-batch-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(JSON.stringify({
      output_path: outPath,
      status: completed.status,
      result_summary: completed.result_summary ?? null,
      run_count: output.runs.length,
      temporary_test_definitions_deleted: output.temporary_test_definitions_deleted,
    }, null, 2));
  } catch (error) {
    const deleted = await cleanup(created);
    console.error(JSON.stringify({
      status: error.status === 402 ? "BLOCKED_BY_RETELL_QUOTA" : "FAILED",
      error: error.message?.replace(env.RETELL_API_KEY, "<redacted>"),
      created_definition_count: created.length,
      cleanup: deleted,
    }, null, 2));
    process.exit(error.status === 402 ? 0 : 1);
  }
}

main();
