import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sign } from "retell-sdk";
import {
  createOutboundAdminCookie,
  isAuthorizedOutboundAdmin,
  verifyOutboundAdminCookie,
} from "../services/outboundAuth";
import { parseCompletedCheckoutSession } from "../services/outboundStripe";
import { verifyOutboundRetellSignature } from "../services/outboundRetell";
import { buildOutboundConversationFlow } from "../retell/outboundConversationFlow";

describe("outbound admin authorization", () => {
  it("supports bearer auth without exposing the token in a URL", () => {
    expect(isAuthorizedOutboundAdmin({ authorization: "Bearer test-admin", cookie: "" }, "test-admin")).toBe(true);
    expect(isAuthorizedOutboundAdmin({ authorization: "Bearer wrong", cookie: "" }, "test-admin")).toBe(false);
  });

  it("uses HttpOnly SameSite cookies and only requires Secure in production", () => {
    const local = createOutboundAdminCookie("test-admin", new Date("2026-06-09T00:00:00Z"), false);
    const production = createOutboundAdminCookie("test-admin", new Date("2026-06-09T00:00:00Z"), true);
    expect(local).toContain("HttpOnly");
    expect(local).toContain("SameSite=Strict");
    expect(local).not.toContain("Secure");
    expect(production).toContain("Secure");
    expect(verifyOutboundAdminCookie(local.split(";")[0].split("=")[1], "test-admin", new Date("2026-06-09T01:00:00Z"))).toBe(
      true,
    );
  });
});

describe("provider webhook security", () => {
  it("verifies Retell signatures using the installed provider SDK", async () => {
    const body = JSON.stringify({ event: "call_started", call: { call_id: "call_1" } });
    const signature = await sign(body, "retell-api-key-secret");
    await expect(verifyOutboundRetellSignature(body, signature, "retell-api-key-secret")).resolves.toBe(true);
    await expect(verifyOutboundRetellSignature(body, "bad", "retell-api-key-secret")).resolves.toBe(false);
    const fallbackSignature = await sign(body, "legacy-outbound-secret");
    await expect(
      verifyOutboundRetellSignature(body, fallbackSignature, "", "legacy-outbound-secret"),
    ).resolves.toBe(true);
  });

  it("rejects Stripe completion payloads whose trusted metadata or amount do not map", () => {
    const valid = {
      id: "cs_test_1",
      amount_total: 10000,
      currency: "usd",
      payment_status: "paid",
      payment_intent: "pi_test_1",
      metadata: {
        internal_invoice_id: "00000000-0000-4000-8000-000000000001",
        invoice_id: "INV-1",
        customer_id: "00000000-0000-4000-8000-000000000002",
        business_id: "00000000-0000-4000-8000-000000000003",
        business_name: "Demo Elevator Inspections",
      },
    };
    expect(parseCompletedCheckoutSession(valid, { amount_due_cents: 10000, currency: "usd" }).ok).toBe(true);
    expect(parseCompletedCheckoutSession({ ...valid, amount_total: 9999 }, { amount_due_cents: 10000, currency: "usd" }).ok).toBe(
      false,
    );
    expect(
      parseCompletedCheckoutSession({ ...valid, metadata: {} }, { amount_due_cents: 10000, currency: "usd" }).ok,
    ).toBe(false);
  });
});

describe("outbound flow guardrails", () => {
  it("keeps trusted context, provider boundaries and separate native terminal paths", () => {
    const flow = buildOutboundConversationFlow("https://example.com");
    const serialized = JSON.stringify(flow);
    const prompt = String(flow.global_prompt);
    expect(flow.start_node_id).toBe("outbound_collections_agent");
    const main = flow.nodes.find(node => node.id === flow.start_node_id);
    expect(main).toMatchObject({ type: "subagent" });
    expect(serialized).not.toContain('"args_at_root":true');
    for (const name of ["log_outcome", "create_payment_link", "send_payment_sms", "send_payment_email", "request_human_transfer", "schedule_followup", "schedule_callback"]) {
      expect(flow.tools?.some(tool => tool.name === name)).toBe(true);
    }
    for (const variable of ["business_name", "business_name_spoken", "agent_display_name", "customer_first_name_spoken", "account_company_name", "inspection_type", "inspection_date_spoken", "original_due_date_spoken", "amount_due_spoken", "total_amount_due_spoken", "invoice_id_spoken", "ai_disclosure_instruction"]) {
      expect(prompt).toContain("{{" + variable + "}}");
    }
    for (const rule of [
      "Retell handles voicemail using the configured short static provider message",
      "Never collect card details verbally", "Never silently substitute Stripe",
      "Do not pressure after refusal", "no age or physical office", "Do not repeat disclosure",
      "Read digits without plus one or area code", "Do not repeat the same recovery question",
      "Only explicit opt-out phrases",
    ]) expect(prompt).toContain(rule);
    expect(prompt).toContain("Only explicit opt-out phrases such as stop calling, don't call me again, or remove me from your call list trigger do_not_contact.");
    expect(prompt).toContain("Do not treat goodbye, bye, no thanks, that's all, have a good day, or a polite call ending as do_not_contact.");
    expect(prompt).toContain("Never request DOB, ZIP, SSN, account numbers or sensitive identifiers");
    expect(prompt).toContain("An overdue threshold does not authorize service interruption, delayed filings, fees, penalties or other invented consequences");
    expect(prompt).toContain("Second readback uses customer_email_spoken_phonetic");
    expect(prompt).toContain("Use trusted inspection date, due date and balance as separate fields");
    expect(prompt).toContain('avoid saying the exact phrase "thank you"');
    expect(prompt).not.toMatch(/wrong number[^\n]*hard terminal route/i);
    expect(prompt).not.toMatch(/hard terminal outcomes[^\n]*wrong_number/i);
    expect(prompt).not.toMatch(/\bI'm Sophia\b|this is Sophia|Agent name: Sophia|Demo Elevator Inspections/);
    for (const [id, tool, closing] of [
      ["outbound_normal_terminal_final_check", "end_final_check_call", "Have a good day. Goodbye."],
      ["outbound_wrong_number_terminal_end", "end_wrong_number_call", "Sorry about that. We'll review the contact information. Goodbye."],
      ["outbound_hard_terminal_end", "end_hard_terminal_call", "We'll stop calling"],
    ]) {
      const node = flow.nodes.find(item => item.id === id);
      expect(node).toMatchObject({ type: "subagent", tool_ids: ["outbound_log_outcome"] });
      expect(JSON.stringify(node)).toContain('"type":"end_call"');
      expect(JSON.stringify(node)).toContain(tool);
      expect(JSON.stringify(node)).toContain(closing);
    }
    const mainJson = JSON.stringify(main);
    expect(mainJson).toContain("Use only after the assistant has already asked: Is there anything else I can help you with?");
    expect(mainJson).toContain("Use only after explicit do-not-contact, attorney represented, or hostile/abusive hard terminal outcome has already been acknowledged and logged.");
  });

  it("preserves dashboard voice tuning and never updates phone bindings during setup", () => {
    const setupScript = fs.readFileSync(path.resolve(process.cwd(), "src/scripts/setupOutboundRetell.ts"), "utf8");
    const envConfig = fs.readFileSync(path.resolve(process.cwd(), "src/config/env.ts"), "utf8");
    const envExample = fs.readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
    expect(setupScript).not.toMatch(/\.phoneNumber\.update\s*\(/);
    expect(setupScript).toContain('voice_model: "eleven_flash_v2_5"');
    expect(setupScript).toContain('return { voiceId: "11labs-Gilfoy", source: "default_fallback" }');
    expect(setupScript).toContain("resolveOutboundVoiceSettings(existing.agent)");
    expect(setupScript).toContain("voice_speed: numericSetting(current.voice_speed, OUTBOUND_VOICE_SETTINGS.voice_speed)");
    expect(setupScript).toContain("voice_temperature: numericSetting(current.voice_temperature, OUTBOUND_VOICE_SETTINGS.voice_temperature)");
    expect(setupScript).toMatch(/begin_message_delay_ms:\s*numericSetting\(\s*current\.begin_message_delay_ms,\s*OUTBOUND_VOICE_SETTINGS\.begin_message_delay_ms/);
    expect(setupScript).toContain("ambient_sound: stringSetting(current.ambient_sound, OUTBOUND_VOICE_SETTINGS.ambient_sound)");
    expect(setupScript).toMatch(/ambient_sound_volume:\s*numericSetting\(\s*current\.ambient_sound_volume,\s*OUTBOUND_VOICE_SETTINGS\.ambient_sound_volume/);
    expect(envConfig).toContain('OUTBOUND_RETELL_MODEL: z.string().optional().default("")');
    expect(envConfig).toContain('OUTBOUND_RETELL_VOICE_ID: z.string().optional().default("")');
    expect(envConfig).toContain('OUTBOUND_RETELL_AGENT_NAME: z.string().default("Elevator Inspection Collections — Paul")');
    expect(envExample).toContain("OUTBOUND_RETELL_AGENT_NAME=Elevator Inspection Collections — Paul");
    expect(envExample).not.toContain("OUTBOUND_RETELL_AGENT_NAME=Outbound B2B Invoice Collections Demo");
    expect(setupScript).toContain("preserves the current dashboard voice");
    expect(setupScript).toContain("current_dashboard");
  });

  it("accepts the three Retell models used by the comparison suite", () => {
    const originalModel = process.env.OUTBOUND_RETELL_MODEL;
    try {
      for (const model of ["gpt-4.1", "gpt-5.4-mini", "gpt-4.1-mini"]) {
        process.env.OUTBOUND_RETELL_MODEL = model;
        expect(buildOutboundConversationFlow("https://elixis.agency").model_choice).toMatchObject({ model });
      }
    } finally {
      if (originalModel === undefined) delete process.env.OUTBOUND_RETELL_MODEL;
      else process.env.OUTBOUND_RETELL_MODEL = originalModel;
    }
  });

  it("adds subtle tool-wait bridge behavior without exposing internals", () => {
    const flow = buildOutboundConversationFlow("https://elixis.agency");
    const serialized = JSON.stringify(flow);
    const createPaymentLink = (flow.tools || []).find((tool) => tool.name === "create_payment_link");
    expect(createPaymentLink).toMatchObject({
      speak_during_execution: true,
      execution_message_type: "static_text",
      execution_message_description: "One moment.",
    });
    expect(serialized).toContain("One moment.");
    expect(String(flow.global_prompt)).toContain('One complete \"One moment.\" bridge covers the whole tool sequence');
    expect(String(flow.global_prompt)).toContain("do not add a second bridge");
    expect(String(flow.global_prompt)).toContain("Do not mention prompts, APIs, metadata, Retell, Stripe, Supabase, or internal tools");
  });

  it("requires explicit delivery selection, fresh email confirmation and one result-driven date step", () => {
    const flow = buildOutboundConversationFlow("https://elixis.agency");
    const prompt = String(flow.global_prompt);
    for (const rule of [
      "Only choose this route after the caller explicitly selects email, including a text-to-email switch",
      "Full slow on-file readback must be followed by a separate caller confirmation",
      "A later explicit email choice enters full email confirmation even from final-check",
      "Good to hear. Do you need the secure payment link?",
      'After successful delivery OR link declined ask exactly: "When can I expect the payment?"',
      'A bare yes to the link offer requires: "Would you prefer text or email?"',
      "Link declined does not mean payment refused", "No silent method switching",
      "A caller-supplied payment date, even vague, enters the native schedule_followup resolver with their exact phrase",
      "Never calculate, restate or confirm it before the trusted result",
      "On success, the native End states the returned spoken date once and closes without another confirmation",
      "On explicit refusal/inability to provide a date, use the finite no-date function and native End",
      "Only repeat the inspection type, date, amount, or secure-link explanation when the caller asks",
    ]) expect(prompt).toContain(rule);
    expect(JSON.stringify(flow)).not.toContain("I'll note that payment is expected by");
    expect(JSON.stringify(flow)).toContain("Call this tool for every caller-supplied expected payment date phrase, including vague phrases");
    for (const id of ["payment_link_declined_expected_date_example", "payment_link_sent_expected_date_example", "payment_link_yes_asks_delivery_preference_example", "ambiguous_expected_date_uses_tool_example"]) {
      expect(JSON.stringify(flow)).toContain('"id":"' + id + '"');
    }
  });

  it("routes caller-supplied expected payment dates through a native function node", () => {
    const flow = buildOutboundConversationFlow("https://elixis.agency");
    const mainNode = flow.nodes.find((node) => node.id === "outbound_collections_agent");
    const resolverNode = flow.nodes.find((node) => node.id === "outbound_expected_payment_date_function");
    const confirmationNode = flow.nodes.find((node) => node.id === "outbound_expected_payment_date_confirmation");
    const clarificationNode = flow.nodes.find((node) => node.id === "outbound_expected_payment_date_clarification");

    expect(mainNode?.type).toBe("subagent");
    expect(resolverNode?.type).toBe("function");
    expect(confirmationNode?.type).toBe("end");
    expect(clarificationNode?.type).toBe("subagent");
    if (mainNode?.type !== "subagent") throw new Error("Expected main outbound subagent");
    if (resolverNode?.type !== "function") throw new Error("Expected payment-date function node");
    if (confirmationNode?.type !== "end") throw new Error("Expected payment-date native end node");
    if (clarificationNode?.type !== "subagent") throw new Error("Expected payment-date clarification subagent");

    expect(mainNode.edges).toContainEqual(
      expect.objectContaining({
        id: "outbound_expected_payment_date_edge",
        destination_node_id: "outbound_expected_payment_date_function",
      }),
    );
    expect(mainNode.finetune_transition_examples).toContainEqual(
      expect.objectContaining({
        id: "expected_payment_date_transition_example",
        destination_node_id: "outbound_expected_payment_date_function",
      }),
    );
    expect(mainNode.finetune_transition_examples).toContainEqual(
      expect.objectContaining({
        id: "expected_payment_date_after_email_transition_example",
        destination_node_id: "outbound_expected_payment_date_function",
      }),
    );
    expect(resolverNode).toMatchObject({
      type: "function",
      tool_id: "outbound_schedule_followup",
      tool_type: "local",
      wait_for_result: true,
      speak_during_execution: false,
    });
    expect(flow.tools?.find((tool) => tool.name === "schedule_followup")).toMatchObject({
      response_variables: {
        resolved_expected_payment_date_spoken: "expected_payment_date_spoken",
      },
    });
    expect(resolverNode.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "outbound_expected_payment_date_needs_clarification_edge",
        destination_node_id: "outbound_expected_payment_date_clarification",
        transition_condition: expect.objectContaining({
          type: "prompt",
          prompt: expect.stringContaining("most recent schedule_followup tool result"),
        }),
      }),
    ]));
    expect(resolverNode.else_edge).toMatchObject({
      destination_node_id: "outbound_expected_payment_date_confirmation",
      transition_condition: { type: "prompt", prompt: "Else" },
    });
    expect(resolverNode.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ destination_node_id: "outbound_expected_payment_date_confirmation" }),
    ]));
    expect(clarificationNode.edges).toContainEqual(
      expect.objectContaining({ destination_node_id: "outbound_expected_payment_date_function" }),
    );
    const serializedConfirmationNode = JSON.stringify(confirmationNode);
    expect(confirmationNode).toMatchObject({
      type: "end",
      instruction: {
        type: "prompt",
        text: expect.stringContaining("most recent schedule_followup tool result"),
      },
      speak_during_execution: true,
    });
    expect(serializedConfirmationNode).toContain("Got it. I'll expect your payment on");
    expect(serializedConfirmationNode).toContain("Have a good day. Goodbye.");
    expect(serializedConfirmationNode).not.toContain("Can you confirm");
    expect(serializedConfirmationNode).not.toContain("Is there anything else I can help you with?");
  });

  it("keeps Presentation Mode copy professional and surfaces specific demo gate messages", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "web/outbound.html"), "utf8");
    const js = fs.readFileSync(path.resolve(process.cwd(), "public/outbound/outbound.js"), "utf8");
    expect(html).not.toMatch(/tomorrow/i);
    expect(html).toContain("Presentation mode");
    expect(html).toContain("Demo test number and editable call context");
    expect(html).toContain("demo-feedback-badges");
    expect(js).toContain("Invalid phone number format. Use E.164, like +13475850249.");
    expect(js).toContain("Exact confirmation phrase is incorrect");
    expect(js).toContain("Warning checkbox is required");
    expect(js).toContain("Temporary demo authorization expired");
    expect(js).toContain("After-hours override is required");
    expect(js).toContain("Demo number authorized");
    expect(js).toContain("Needs after-hours confirmation");
    expect(js).toContain("QuickBooks is not connected");
    expect(js).toContain("SMS is disabled/manual");
  });
});
