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
  it("uses a tool-capable subagent with required safety rules without phone binding operations", () => {
    const serialized = JSON.stringify(buildOutboundConversationFlow("https://example.com"));
    const setupScript = fs.readFileSync(
      path.resolve(process.cwd(), "src/scripts/setupOutboundRetell.ts"),
      "utf8",
    );
    const envConfig = fs.readFileSync(path.resolve(process.cwd(), "src/config/env.ts"), "utf8");
    const envExample = fs.readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
    const flow = buildOutboundConversationFlow("https://example.com");
    const mainNode = flow.nodes.find((node) => node.id === "outbound_collections_agent");
    const finalCheckNode = flow.nodes.find((node) => node.id === "outbound_normal_terminal_final_check");
    const hardTerminalNode = flow.nodes.find((node) => node.id === "outbound_hard_terminal_end");
    const wrongNumberTerminalNode = flow.nodes.find((node) => node.id === "outbound_wrong_number_terminal_end");
    expect(flow.start_node_id).toBe("outbound_collections_agent");
    expect(flow.nodes.length).toBeGreaterThanOrEqual(4);
    expect(serialized).toContain('"type":"subagent"');
    expect(serialized).toContain('"tool_ids"');
    expect(serialized).toContain("Do not leave voicemail");
    expect(serialized).toContain("Do not accept card details verbally");
    expect(serialized).toContain("Never collect card details verbally");
    expect(serialized).not.toContain('"args_at_root":true');
    expect(serialized).toContain('"type":"end"');
    expect(serialized).toContain('"type":"transfer_call"');
    expect(serialized).toContain('"tool_id":"outbound_log_outcome"');
    expect(serialized).toContain('"tool_id":"outbound_create_payment_link"');
    expect(serialized).toContain('"tool_id":"outbound_send_payment_sms"');
    expect(serialized).toContain('"tool_id":"outbound_send_payment_email"');
    expect(serialized).toContain('"tool_id":"outbound_request_human_transfer"');
    expect(serialized).toContain('"tool_id":"outbound_schedule_followup"');
    expect(serialized).toContain('"tool_id":"outbound_schedule_callback"');
    expect(serialized).toContain("confirmed_payment_link_requested");
    expect(serialized).toContain("sms_pending_manual");
    expect(serialized).toContain("email_pending_manual");
    expect(serialized).toContain("email_missing");
    expect(serialized).toContain("Elixis Elevator Systems");
    expect(serialized).toContain("Hello, I'm calling from {{business_name_spoken}}. - Is this {{customer_first_name_spoken}}?");
    expect(serialized).toContain("Speak as if the caller has already asked you to slow down.");
    expect(serialized).toContain("Keep a steady, lower-energy tone and do not rush the opening, names, emails, phone numbers, dates, or payment instructions.");
    expect(String(flow.global_prompt)).toContain('avoid saying the exact phrase "thank you"');
    expect(String(flow.global_prompt)).toContain('do not say "thank you for confirming."');
    expect(String(flow.global_prompt)).not.toMatch(/wrong number[^\n]*hard terminal route/i);
    expect(String(flow.global_prompt)).not.toMatch(/hard terminal outcomes[^\n]*wrong_number/i);
    expect(String(flow.global_prompt)).toContain("use the dedicated wrong-number terminal route");
    expect(serialized).toContain("Nice to meet you, {{customer_first_name_spoken}}. I'm {{agent_display_name}}, calling from {{business_name_spoken}} because our records show the {{inspection_type}} invoice from {{inspection_date_spoken}} is overdue.");
    expect(serialized).toContain("Our records show the {{inspection_type}} invoice from {{inspection_date_spoken}} is overdue");
    expect(serialized).toContain("I can resend the invoice now. Would you prefer text or email?");
    expect(serialized).toContain("Good to hear. Would you like to take care of it now?");
    expect(serialized).toContain("We value our relationship and want to avoid any interruption in service or delays with future inspection filings");
    expect(serialized).toContain("Do not mention virtual assistant or AI status automatically in the normal flow.");
    expect(serialized).toContain("I apologize. Is this not the right number for {{customer_first_name_spoken}}?");
    expect(serialized).toContain("No problem. Are you with {{account_company_name_spoken}}?");
    expect(serialized).toContain("No problem. I may have the wrong contact for this account. Is there someone else who handles elevator inspection invoices?");
    expect(serialized).toContain("company/account confirmed");
    expect(serialized).toContain("inspection_type");
    expect(serialized).toContain("days_after_inspection_first_call");
    expect(serialized).toContain("very_overdue_threshold_days");
    expect(serialized).toContain("expected_payment_date_spoken");
    expect(serialized).not.toContain("my name is Paul from Elixis Elevator Systems");
    expect(serialized).not.toContain("this is Paul from Elixis Elevator Systems");
    expect(serialized).not.toContain("This is Elixis Elevator Systems, your elevator inspection company");
    expect(serialized).not.toContain("Hi, this is calling on behalf of Elixis Elevator Systems about an open invoice");
    expect(serialized).not.toContain("Thanks. I'm an AI voice assistant helping Elixis Elevator Systems");
    expect(serialized).not.toContain("make sure your elevators are operating properly");
    expect(serialized).toContain("ai_disclosure_policy");
    expect(serialized).toContain("Disclosure instruction for this call");
    expect(serialized).toContain("Do not infer or apply a different disclosure policy");
    expect(serialized).toContain("service_issue_reported");
    expect(serialized).toContain("responsible_party_update_requested");
    expect(serialized).toContain("named_contact_requested");
    expect(serialized).toContain("mail_instructions_requested");
    expect(serialized).toContain('"id":"service_issue_logging_example"');
    expect(serialized).toContain('"id":"callback_propose_then_confirm_example"');
    expect(serialized).toContain('"id":"mail_check_missing_instructions_example"');
    expect(serialized).toContain('"id":"do_not_contact_terminal_example"');
    expect(serialized).toContain('"id":"email_sent_terminal_example"');
    expect(serialized).toContain('"id":"human_unavailable_terminal_example"');
    expect(serialized).toContain("your next action must be the schedule_callback tool");
    expect(serialized).toContain('"id":"outbound_normal_terminal_final_check"');
    expect(serialized).toContain('"id":"outbound_polite_final_check_end_edge"');
    expect(serialized).toContain('"id":"outbound_hard_terminal_end"');
    expect(serialized).toContain('"id":"outbound_wrong_number_terminal_edge"');
    expect(serialized).toContain('"id":"outbound_wrong_number_terminal_end"');
    expect(serialized).toContain("Is there anything else I can help you with?");
    expect(serialized).toContain("Have a good day. Goodbye");
    expect(serialized).toContain("all required custom tool calls for the terminal outcome are complete");
    expect(serialized).toContain("When sent is true, confirm delivery once and route to the normal final-check step");
    expect(serialized).toContain("Do not leave a confirmed email preference as a future team delivery when send_payment_email is available");
    expect(serialized).toContain("If create_payment_link returns created=false, reused=false, or no payment_url, do not call send_payment_email or send_payment_sms.");
    expect(serialized).toContain('"id":"payment_link_failure_terminal_example"');
    expect(serialized).toContain("\\\"sent\\\":true");
    expect(serialized).toContain("\\\"status\\\":\\\"email_sent\\\"");
    expect(serialized).toContain("I sent the secure payment link to {{customer_email_spoken_slow}}");
    expect(serialized).toContain("If the person says \\\"hello\\\"");
    expect(serialized).toContain("State the inspection type, inspection date, and selected balance only when the caller asks");
    expect(serialized).toContain("amount_due_spoken");
    expect(serialized).toContain("total_amount_due_spoken");
    expect(serialized).toContain("invoice_id_spoken");
    expect(serialized).toContain("open_invoice_count_spoken");
    expect(serialized).toContain("Yes, I'm an AI voice assistant connected to {{business_name}}'s account records to help with invoice follow-up.");
    expect(serialized).toContain("I'm following up at the time you requested about your elevator inspection invoice");
    expect(serialized).toContain("Do not direct them to make an inbound call");
    expect(serialized).not.toMatch(/call us back later|please call the office/i);
    expect(serialized).toContain("Normal terminal outcomes must route to the normal final-check node");
    expect(serialized).toContain("Never close a service-issue call before the tool invocation and final-check routing");
    expect(serialized).toContain("Do not call log_outcome for service_issue_reported until the caller has provided the concise issue description");
    expect(serialized).toContain("This isolated final-check node owns defensive terminal logging, the goodbye, and hangup");
    expect(JSON.stringify(mainNode)).toContain("end_polite_final_check_call");
    expect(JSON.stringify(mainNode)).toContain("Use only after the assistant has already asked: Is there anything else I can help you with?");
    expect(JSON.stringify(mainNode)).toContain("end_hard_terminal_call_from_main");
    expect(JSON.stringify(mainNode)).toContain("Use only after explicit do-not-contact, attorney represented, or hostile/abusive hard terminal outcome has already been acknowledged and logged.");
    expect(JSON.stringify(finalCheckNode)).toContain('"type":"end_call"');
    expect(JSON.stringify(finalCheckNode)).toContain("end_final_check_call");
    expect(JSON.stringify(finalCheckNode)).toContain('"tool_ids":["outbound_log_outcome"]');
    expect(JSON.stringify(finalCheckNode)).toContain("defensive terminal node");
    expect(JSON.stringify(finalCheckNode)).toContain('"execution_message_description":"Have a good day. Goodbye."');
    expect(JSON.stringify(wrongNumberTerminalNode)).toContain('"type":"subagent"');
    expect(JSON.stringify(wrongNumberTerminalNode)).toContain('"tool_ids":["outbound_log_outcome"]');
    expect(JSON.stringify(wrongNumberTerminalNode)).toContain("end_wrong_number_call");
    expect(JSON.stringify(wrongNumberTerminalNode)).toContain("Sorry about that. We'll review the contact information. Goodbye.");
    expect(JSON.stringify(hardTerminalNode)).toContain('"type":"subagent"');
    expect(JSON.stringify(hardTerminalNode)).toContain('"tool_ids":["outbound_log_outcome"]');
    expect(JSON.stringify(hardTerminalNode)).toContain('"type":"end_call"');
    expect(JSON.stringify(hardTerminalNode)).toContain("end_hard_terminal_call");
    expect(serialized).toContain('"speak_during_execution":true');
    expect(serialized).toContain("Payment provider: {{payment_provider}}");
    expect(serialized).toContain("QuickBooks connected: {{quickbooks_connected}}");
    expect(serialized).toContain("Only call a link a QuickBooks payment link when the backend returns a real connected-provider link");
    expect(serialized).toContain("Customer email spoken slowly");
    expect(serialized).toContain("Customer email spoken phonetic");
    expect(serialized).toContain("Customer phone spoken in chunks");
    expect(serialized).toContain("Is {{customer_email_spoken_slow}} still the best email for the secure payment link?");
    expect(serialized).toContain("Is e l i x i s agency, at gmail, dot com still the best email for the secure payment link?");
    expect(serialized).toContain("If the caller asks you to repeat the email, says it is wrong, or sounds confused, the second readback must use {{customer_email_spoken_phonetic}}");
    expect(serialized).toContain("If the caller asks you to repeat the phone number or corrects it, use {{customer_phone_spoken_chunked}}");
    expect(serialized).toContain('"id":"email_second_readback_phonetic_example"');
    expect(serialized).toContain('"id":"email_correction_contact_update_example"');
    expect(serialized).toContain('"id":"phone_correction_contact_update_example"');
    expect(serialized).toContain("For payment-link creation, do not generate your own separate bridge line");
    expect(serialized).toContain('"execution_message_description":"One moment."');
    expect(serialized).toContain("One moment.");
    expect(serialized).not.toContain("One moment while I prepare that.");
    expect(serialized).not.toContain("One moment while I pull that up.");
    expect(serialized).not.toContain("One moment while I send that.");
    expect(serialized).toContain("Inspection date: {{inspection_date_spoken}}");
    expect(serialized).toContain("Our records show the {{inspection_type}} invoice from {{inspection_date_spoken}} is overdue");
    expect(serialized).toContain("Do not treat goodbye, bye, no thanks, that's all, have a good day, or a polite call ending as do_not_contact.");
    expect(serialized).toContain("Only explicit opt-out phrases such as stop calling, don't call me again, or remove me from your call list trigger do_not_contact.");
    expect(serialized).toContain("the caller replies with no, goodbye, bye, no thanks, that's all, or another polite no-further-help ending");
    expect(serialized).toContain("May I ask the reason, so I can note it correctly for the team?");
    expect(serialized).toContain("I'm a digital assistant, so I don't have an age.");
    expect(serialized).toContain("I'm a digital assistant, so I'm not physically located at an office.");
    expect(serialized).toContain("The contact information is listed on the account record for this invoice.");
    expect(serialized).toContain("We can be. Before I let you go, were you able to receive the invoice, or should I note that it needs to be resent?");
    expect(serialized).toContain("Yes. I have what I need. Have a good day. Goodbye.");
    expect(serialized).toContain("I'm doing well, thanks for asking.");
    expect(serialized).toContain("Who is the best person for payments now?");
    expect(serialized).toContain("your next action must be log_outcome with outcome responsible_party_update_requested");
    expect(serialized).toContain("Your next action must be log_outcome with named_contact_requested");
    expect(serialized).toContain("do not transition until log_outcome has already been called with the confirmed name");
    expect(serialized).toContain('"id":"same_turn_payment_request_example"');
    expect(serialized).toContain("The team will follow up with the secure link");
    expect(serialized).not.toContain("invoke end_call immediately in the same turn");
    expect(serialized).not.toContain("Demo Elevator Inspections");
    expect(serialized).not.toMatch(/\bI'm Sophia\b|this is Sophia|Agent name: Sophia/);
    expect(serialized).toContain("tool_call_invocation");
    expect(serialized).not.toContain("phoneNumber.update");
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
    expect(serialized).toContain("I'll pull that up.");
    expect(serialized).toContain("I'll prepare that now.");
    expect(serialized).toContain("Do not overuse the bridge line for quick background logging");
    expect(serialized).toContain("Never mention tools, APIs, systems, or databases");
  });

  it("prevents SMS-to-email delivery without email confirmation and avoids repeated invoice details", () => {
    const flow = buildOutboundConversationFlow("https://elixis.agency");
    const prompt = String(flow.global_prompt);
    expect(prompt).toContain("If the caller switches from text to email, confirm {{customer_email_spoken_slow}} before calling send_payment_email");
    expect(prompt).toContain('If the invoice was received, say: "Good to hear. Would you like to take care of it now?"');
    expect(prompt).toContain("Only repeat the inspection type, date, amount, or secure-link explanation when the caller asks what the invoice is about, asks how payment works, or asks for the amount.");
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
