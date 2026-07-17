import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OUTBOUND_SINGLE_PROMPT_AGENT_NAME,
  buildOutboundSinglePromptAgentPayload,
  buildOutboundSinglePromptLlmPayload,
  buildOutboundSinglePromptPrompt,
  buildOutboundSinglePromptTools,
} from "../retell/outboundSinglePrompt";

const baseUrl = "https://elixis.agency";

describe("outbound single-prompt comparison agent", () => {
  it("expresses the outbound collections policy as one prompt without Conversation Flow routing language", () => {
    const prompt = buildOutboundSinglePromptPrompt();

    expect(OUTBOUND_SINGLE_PROMPT_AGENT_NAME).toBe("Elevator Inspection Collections — Paul (Single Prompt Comparison)");
    expect(prompt).toContain("Keep each turn to one or two short sentences");
    expect(prompt).toContain("Ask one question at a time");
    expect(prompt).toContain("{{business_name_spoken}}");
    expect(prompt).toContain("{{customer_first_name_spoken}}");
    expect(prompt).toContain("{{inspection_type}}");
    expect(prompt).toContain("{{inspection_date_spoken}}");
    expect(prompt).toContain("{{amount_due_spoken}}");
    expect(prompt).toContain("wrong person but the company is correct");
    expect(prompt).toContain("May I ask the reason, so I can note it correctly for the team?");
    expect(prompt).toContain("Good to hear. Do you need the secure payment link?");
    expect(prompt).toContain("By what date should we expect payment?");
    expect(prompt).toContain('If the caller answers only yes, ask exactly: "Would you prefer text or email?"');
    expect(prompt).toContain("Even vague phrases such as soon, later, or sometime");
    expect(prompt).toContain("Never decide that a supplied date phrase is too vague before calling schedule_followup");
    expect(prompt).toContain("schedule_callback with confirmed=false");
    expect(prompt).toContain("send_payment_email returns sent=true");
    expect(prompt).toContain("SMS is disabled/manual");
    expect(prompt).toContain("Do not stop after log_outcome");
    expect(prompt).toContain("I sent the secure payment link to {{customer_email_spoken_slow}}.");
    expect(prompt).toContain("Do not mention that SMS is disabled or manual");
    expect(prompt).toContain("Do not add words such as right now");
    expect(prompt).toContain("Never collect card or bank details over the phone");
    expect(prompt).toContain("This is first-party B2B invoice follow-up");
    expect(prompt).toContain("Is there anything else I can help you with?");
    expect(prompt).toContain("end_polite_call");
    expect(prompt).toContain("end_wrong_number_call");
    expect(prompt).toContain("end_hard_terminal_call");
    expect(prompt).not.toMatch(/route to .*node|conversation flow/i);
    expect(prompt).not.toContain("Demo Pest KB");
  });

  it("attaches the seven existing wrapped backend tools and native terminal controls", () => {
    const tools = buildOutboundSinglePromptTools(baseUrl);
    const customTools = tools.filter((tool) => tool.type === "custom");

    expect(customTools.map((tool) => tool.name)).toEqual([
      "log_outcome",
      "create_payment_link",
      "send_payment_sms",
      "send_payment_email",
      "request_human_transfer",
      "schedule_followup",
      "schedule_callback",
    ]);
    expect(customTools.every((tool) => tool.args_at_root === false)).toBe(true);
    expect(customTools.map((tool) => tool.url)).toEqual([
      `${baseUrl}/api/outbound/retell/log-outcome`,
      `${baseUrl}/api/outbound/retell/create-payment-link`,
      `${baseUrl}/api/outbound/retell/send-payment-sms`,
      `${baseUrl}/api/outbound/retell/send-payment-email`,
      `${baseUrl}/api/outbound/retell/request-human-transfer`,
      `${baseUrl}/api/outbound/retell/schedule-followup`,
      `${baseUrl}/api/outbound/retell/schedule-callback`,
    ]);
    expect(customTools.find((tool) => tool.name === "create_payment_link")).toMatchObject({
      speak_during_execution: true,
      execution_message_type: "static_text",
      execution_message_description: "One moment.",
    });
    expect(customTools.find((tool) => tool.name === "schedule_followup")).toMatchObject({
      parameters: {
        properties: expect.objectContaining({
          expected_payment_date_phrase: { type: "string" },
        }),
      },
      response_variables: expect.objectContaining({
        expected_payment_date_spoken: "$.expected_payment_date_spoken",
      }),
    });
    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "end_call", name: "end_polite_call" }),
      expect.objectContaining({ type: "end_call", name: "end_wrong_number_call" }),
      expect.objectContaining({ type: "end_call", name: "end_hard_terminal_call" }),
      expect.objectContaining({ type: "transfer_call", name: "transfer_call" }),
    ]));
  });

  it("builds a strict Retell LLM payload with safe demo defaults and no pest knowledge base", () => {
    const payload = buildOutboundSinglePromptLlmPayload(baseUrl);

    expect(payload).toMatchObject({
      model: "gpt-4.1",
      model_temperature: 0.2,
      tool_call_strict_mode: true,
      start_speaker: "agent",
      begin_message: "Hello, I'm calling from {{business_name_spoken}}. Is this {{customer_first_name_spoken}}?",
    });
    expect(payload.general_tools).toHaveLength(11);
    expect(payload).not.toHaveProperty("states");
    expect(payload).not.toHaveProperty("knowledge_base_ids");
    expect(payload.default_dynamic_variables).toMatchObject({
      business_name: "Elixis Elevator Systems",
      business_name_spoken: "Elixis Elevator Systems",
      agent_display_name: "Paul",
      sms_effective: "false",
      payment_provider: "stripe",
    });
  });

  it("copies the published outbound runtime settings while changing only the response engine and identity", () => {
    const reference = {
      voice_id: "11labs-Gilfoy",
      voice_model: "eleven_flash_v2_5",
      voice_speed: 0.82,
      voice_temperature: 1.06,
      ambient_sound: "coffee-shop",
      ambient_sound_volume: 0.7,
      enable_dynamic_voice_speed: false,
      enable_dynamic_responsiveness: false,
      enable_backchannel: false,
      responsiveness: 0.95,
      interruption_sensitivity: 0.77,
      begin_message_delay_ms: 1550,
      voicemail_option: { action: { type: "hangup" } },
      webhook_timeout_ms: 10000,
      data_storage_setting: "everything_except_pii",
      pii_config: { mode: "post_call", categories: [] },
      language: "en-US",
      timezone: "America/New_York",
      post_call_analysis_data: [{ name: "identity_confirmed", type: "boolean", required: false }],
      response_engine: { type: "conversation-flow", conversation_flow_id: "conversation_flow_existing" },
    };

    const payload = buildOutboundSinglePromptAgentPayload(reference, "llm_candidate", baseUrl);

    expect(payload).toMatchObject({
      agent_name: OUTBOUND_SINGLE_PROMPT_AGENT_NAME,
      response_engine: { type: "retell-llm", llm_id: "llm_candidate" },
      voice_id: "11labs-Gilfoy",
      voice_model: "eleven_flash_v2_5",
      voice_speed: 0.82,
      voice_temperature: 1.06,
      ambient_sound: "coffee-shop",
      ambient_sound_volume: 0.7,
      begin_message_delay_ms: 1550,
      webhook_url: `${baseUrl}/api/outbound/webhooks/retell`,
      webhook_events: ["call_started", "call_ended", "call_analyzed", "transcript_updated"],
      voicemail_option: { action: { type: "hangup" } },
    });
    expect(payload).not.toHaveProperty("conversation_flow_id");
    expect(JSON.stringify(payload)).not.toContain("conversation_flow_existing");
  });

  it("keeps provider creation explicit and never updates phone bindings", () => {
    const setupScript = fs.readFileSync(
      path.resolve(process.cwd(), "src/scripts/setupOutboundSinglePrompt.ts"),
      "utf8",
    );

    expect(setupScript).toContain("CONFIRM_CREATE_RETELL_OUTBOUND_SINGLE_PROMPT_AGENT");
    expect(setupScript).toContain("CONFIRM_UPDATE_RETELL_OUTBOUND_SINGLE_PROMPT_AGENT");
    expect(setupScript).toContain("listRetellVoiceAgentsV2");
    expect(setupScript).toContain("OUTBOUND_RETELL_SINGLE_PROMPT_AGENT_ID");
    expect(setupScript).toContain("OUTBOUND_RETELL_SINGLE_PROMPT_LLM_ID");
    expect(setupScript).toContain("agent_4aa8074d7eabe311109ed6da89");
    expect(setupScript).toContain("agent_16b324c0e55f21c0a5f914c169");
    expect(setupScript).toContain("configuredCandidateLlmId ? await client.llm.retrieve");
    expect(setupScript).toContain("Configured candidate must remain unbound");
    expect(setupScript).toContain("/publish-agent-version/");
    expect(setupScript).not.toMatch(/client\.agent\.publish\s*\(/);
    expect(setupScript).not.toMatch(/\.phoneNumber\.update\s*\(/);
    expect(setupScript).not.toMatch(/\.agent\.list\s*\(/);
  });
});
