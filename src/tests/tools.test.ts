import { describe, expect, it } from "vitest";
import request from "supertest";
import { checkServiceArea } from "../services/serviceArea";
import { calComUtcStart, getCalendarAdapter } from "../services/calendar";
import { buildAgentPrompt } from "../retell/agentPrompt";
import { buildSinglePromptCandidatePrompt, DEMO_PEST_KB_ID, DEMO_PEST_KB_NAME } from "../retell/singlePromptCandidatePrompt";
import { buildConversationFlowConfig } from "../retell/conversationFlow";
import { buildCustomToolDefinitions, buildRetellControlTools } from "../retell/tools";
import {
  elijahPestControlKnowledgeBase,
  genericPestControlKnowledgeBaseTemplate,
  requiredKnowledgeBaseSections,
} from "../retell/knowledgeBase";
import { createApp } from "../app";
import { discoverCalComBookingUrl } from "../services/calcomDiscovery";
import { safeEnvValue } from "../services/envValidation";
import { bookAppointmentSchema } from "../schemas/toolSchemas";

describe("service area checks", () => {
  it("does not invent service coverage when Elijah's KB service area is blank", () => {
    const result = checkServiceArea({ city: "Brooklyn", state: "NY", zip_code: null });
    expect(result.status).toBe("maybe");
    expect(result.message_for_agent).toContain("knowledge base");
  });

  it("marks unknown areas as maybe instead of rejecting the caller", () => {
    const result = checkServiceArea({ city: "Princeton", state: "NJ", zip_code: null });
    expect(result.status).toBe("maybe");
    expect(result.message_for_agent).toContain("Continue");
  });
});

describe("calendar adapters", () => {
  it("does not fake confirmations when calendar is disabled", async () => {
    const adapter = getCalendarAdapter("none");
    const result = await adapter.checkAvailability({
      preferred_date: "2026-06-01",
      preferred_time: "morning",
      timezone: "America/New_York",
      appointment_type: "pest_control_service",
      pest_issue: "ants",
    });
    expect(result.enabled).toBe(false);
    expect(result.available).toBe(false);
  });

  it("returns predictable mock slots and mock booking confirmations", async () => {
    const adapter = getCalendarAdapter("mock");
    const availability = await adapter.checkAvailability({
      preferred_date: "2026-06-01",
      preferred_time: "morning",
      timezone: "America/New_York",
      appointment_type: "pest_control_service",
      pest_issue: "ants",
    });
    expect(availability.slots).toHaveLength(3);

    const booking = await adapter.bookAppointment({
      caller_name: "Jamie",
      caller_phone: "7185551212",
      email: "mail@example.com",
      pest_issue: "ants",
      selected_datetime: availability.slots[0],
      timezone: "America/New_York",
      notes: "test",
      lead_id: null,
    });
    expect(booking.confirmed).toBe(true);
    expect(booking.booking_id).toContain("mock_");
  });

  it("normalizes selected Cal.com slots to UTC before booking", () => {
    expect(calComUtcStart("2026-06-04T11:00:00-04:00")).toBe("2026-06-04T15:00:00.000Z");
    expect(calComUtcStart("not a date")).toBeNull();
  });

  it("accepts candidate booking dry-run validation without requiring Retell to expose it as a tool field", () => {
    const parsed = bookAppointmentSchema.parse({
      caller_name: "Maria",
      caller_phone: "7185550100",
      pest_issue: "ants",
      selected_datetime: "2026-06-04T11:00:00-04:00",
      timezone: "America/New_York",
      dry_run: true,
    });
    expect(parsed.dry_run).toBe(true);
    expect(parsed.email).toBe("");
  });
});

describe("agent prompt guardrails", () => {
  const prompt = buildAgentPrompt({
    businessName: "Elijah's Pest Control",
    timezone: "America/New_York",
    smsModeDescription: "test",
  });

  it("uses the Elijah demo brand and does not contain the legacy demo brand", () => {
    const legacyBrand = ["Green", "Shield"].join("");
    expect(prompt).toContain("Elijah's Pest Control");
    expect(prompt).not.toContain(legacyBrand);
    expect(JSON.stringify(buildConversationFlowConfig())).not.toContain(legacyBrand);
  });

  it("has pricing and unknown-question safety language", () => {
    expect(prompt).toContain("Pricing depends on the pest");
    expect(prompt).toContain("I don't want to guess");
  });

  it("requires transfer for urgent wasp/hornet and human requests", () => {
    expect(prompt).toContain("active wasp or hornet nest");
    expect(prompt).toContain("direct request for a live person");
    expect(prompt).toContain("complaint, billing issue");
    expect(prompt).toContain("transfer_call");
  });

  it("includes note-requested examples and closing behavior", () => {
    expect(prompt).toContain("Is there anything else I can help you with today?");
    expect(prompt).toContain("Chemical or safety question");
    expect(prompt).toContain("Wrong number for text");
    expect(prompt).toContain("Rambling caller");
    expect(prompt).toContain("Do not ask callers to press digits");
  });

  it("keeps human delivery natural without weakening safety", () => {
    expect(prompt).toContain("Match the caller's energy while staying calm and capable");
    expect(prompt).toContain("Avoid robotic confirmations");
    expect(prompt).toContain("Use light acknowledgments");
    expect(prompt).toContain("If the caller repeats an unsafe or unsupported claim");
    expect(prompt).toContain("Never claim SMS was sent unless send_booking_sms returns sms_sent true");
    expect(prompt).toContain("Never claim an appointment is booked unless book_appointment_cal returns confirmed true");
  });

  it("does not generate stale ngrok tool URLs", () => {
    const generated = JSON.stringify(buildConversationFlowConfig());
    expect(generated).not.toContain("https://ae22-72-89-30-91.ngrok-free.app");
    expect(generated).toContain("/tools/create-lead");
    expect(generated).toContain("/tools/send-booking-sms");
    expect(generated).toContain("preferred_datetime");
  });

  it("contains the required production prompt sections", () => {
    [
      "# Role",
      "# Personality",
      "# Primary Objective",
      "# Available Tool Calls",
      "# Rules",
      "# Speech Normalization Rules",
      "# Conversation Flow",
      "# Error Handling",
      "# Full Sample Calls",
      "# Post-Call Analysis Intent",
    ].forEach((section) => expect(prompt).toContain(section));
  });
});

describe("single-prompt candidate prompt", () => {
  const prompt = buildSinglePromptCandidatePrompt({
    businessName: "Elijah's Pest Control",
    timezone: "America/New_York",
    calendarStatus: "Candidate Cal.com routes are configured for tests.",
    smsStatus: "SMS is simulated for tests.",
  });

  it("uses the exact Demo Pest KB and required compact sections", () => {
    expect(DEMO_PEST_KB_ID).toBe("knowledge_base_5c6a5b20b1a9ed4f");
    expect(DEMO_PEST_KB_NAME).toBe("Demo Pest KB");
    [
      "# Critical Overrides",
      "# Role",
      "# Personality",
      "# Primary Objective",
      "# Knowledge Base Rules",
      "# Available Tools",
      "# Required Lead Fields",
      "# Core Flow",
      "# Phone Booking / Cal.com Flow",
      "# Follow-Up Request Flow",
      "# Transfer Rules",
      "# Pricing / Safety / Unknown Rules",
      "# Example Dialogues",
      "# Closing",
    ].forEach((section) => expect(prompt).toContain(section));
    expect(prompt).toContain(DEMO_PEST_KB_ID);
    expect(prompt).toContain(DEMO_PEST_KB_NAME);
  });

  it("prioritizes Cal.com phone booking and keeps SMS follow-up safe", () => {
    expect(prompt).toContain("I can help get that booked over the phone now. Can I have your first name?");
    expect(prompt).toContain("Do not offer SMS booking or a text booking link as a normal option");
    expect(prompt).toContain("Retell native Cal.com tools as the primary");
    expect(prompt).toContain("native book_appointment_cal tool confirms success");
    expect(prompt).toContain("Give me a second while I check the schedule");
    expect(prompt).toContain("Okay, give me one moment while I book that");
    expect(prompt).toContain("Before calling book_appointment_cal");
    expect(prompt).toContain("Let me make sure I have this right");
    expect(prompt).toContain("Do not call book_appointment_cal until the caller confirms");
    expect(prompt).toContain("Do not call send_booking_sms in the normal inbound flow");
    expect(prompt).toContain("I saved your request. The team can follow up from there.");
    expect(prompt).not.toContain("mail@example.com");
  });

  it("strictly deflects demo pricing and blank prep questions", () => {
    expect(prompt).toContain("do not speak exact prices or price ranges");
    expect(prompt).toContain("even if a KB entry appears to contain pricing");
    expect(prompt).toContain("I don't want to guess or quote the wrong number");
    expect(prompt).toContain("I don't have specific prep instructions here");
    expect(prompt).toContain("Do not fill gaps with common-sense advice");
  });

  it("handles repeated unsafe claims without getting stuck", () => {
    expect(prompt).toContain("If the caller repeats a false confirmation");
    expect(prompt).toContain("move to follow-up, transfer, or closing instead of arguing");
    expect(prompt).toContain("I can't confirm a text or appointment unless the tool confirms it");
    expect(prompt).toContain("do not have a specific person or department");
    expect(prompt).toContain("Do not say \"confirm your appointment\"");
    expect(prompt).toContain("Do not keep asking the same question");
  });

  it("requires address capture without getting stuck", () => {
    expect(prompt).toContain("Property address");
    expect(prompt).toContain("If refused or still unclear, continue");
    expect(prompt).toContain("ask once for clarification");
  });

  it("keeps pest-control safety behaviors specific", () => {
    expect(prompt).toContain("Hornet/sting urgent");
    expect(prompt).toContain("Roach pricing");
    expect(prompt).toContain("Baby/chemical");
    expect(prompt).toContain("Raccoon/wildlife");
    expect(prompt).toContain("Do not diagnose pests or severity");
  });
});

describe("knowledge base template", () => {
  it("includes all required section headers in the generic template and Elijah KB", () => {
    for (const section of requiredKnowledgeBaseSections) {
      expect(genericPestControlKnowledgeBaseTemplate).toContain(`# ${section}`);
      expect(elijahPestControlKnowledgeBase).toContain(`# ${section}`);
    }
  });

  it("uses the approved customer-preparation and unknown-answer wording", () => {
    expect(genericPestControlKnowledgeBaseTemplate).toContain("## Before Appointment:");
    expect(genericPestControlKnowledgeBaseTemplate).toContain("## After Treatment:");
    expect(genericPestControlKnowledgeBaseTemplate).toContain(
      "If the answer is not listed, transfer the call or capture a lead for follow-up.",
    );
    expect(elijahPestControlKnowledgeBase).toContain("## Before Appointment:");
    expect(elijahPestControlKnowledgeBase).toContain("## After Treatment:");
  });

  it("treats blank knowledge-base fields as unknown in the prompt", () => {
    const prompt = buildAgentPrompt({
      businessName: "Elijah's Pest Control",
      timezone: "America/New_York",
      smsModeDescription: "test",
    });
    expect(prompt).toContain("Blank knowledge-base fields mean unknown");
    expect(prompt).toContain("Never invent service areas, warranties, packages, discounts, or availability");
    expect(prompt).toContain("Do not diagnose a pest species or severity");
  });
});

describe("tool route aliases", () => {
  it("supports hyphenated service-area tool route aliases", async () => {
    const response = await request(createApp())
      .post("/tools/check-service-area")
      .send({ city: "Brooklyn", state: "NY", zip_code: null });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("maybe");
  });
});

describe("candidate Retell tool definitions", () => {
  it("uses candidate-scoped Cal.com routes and extended lead fields", () => {
    const tools = buildCustomToolDefinitions("https://example.ngrok-free.app", { candidateCalendar: true });
    const createLead = tools.find((tool) => tool.name === "create_lead") as any;
    const checkAvailability = tools.find((tool) => tool.name === "check_availability_cal") as any;
    const bookAppointment = tools.find((tool) => tool.name === "book_appointment_cal") as any;

    expect(createLead.parameters.properties.alternate_phone).toBeTruthy();
    expect(createLead.parameters.properties.property_address).toBeTruthy();
    expect(createLead.parameters.properties.property_zip).toBeTruthy();
    expect(checkAvailability.url).toBe("https://example.ngrok-free.app/tools/candidate/check-availability-cal");
    expect(bookAppointment.url).toBe("https://example.ngrok-free.app/tools/candidate/book-appointment-cal");
    expect(bookAppointment.parameters.properties.email.default).toBe("{{booking_placeholder_email}}");
  });

  it("can quiet transfer execution speech for the single-prompt candidate", () => {
    const tools = buildRetellControlTools({ quietTransferExecution: true });
    const transfer = tools.find((tool) => tool.name === "transfer_call") as any;
    expect(transfer.speak_during_execution).toBe(false);
  });
});

describe("setup safety helpers", () => {
  it("does not expose secret-like env values in setup reports", () => {
    expect(safeEnvValue("SUPABASE_DB_URL", "postgres://user:pass@example.com/db")).toBe("<set>");
    expect(safeEnvValue("RETELL_API_KEY", "key_secret")).toBe("<set>");
  });

  it("does not create a Cal.com event type when no verified event exists", async () => {
    const fetchStub = async () =>
      new Response(JSON.stringify({ status: "success", data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const result = await discoverCalComBookingUrl(fetchStub as typeof fetch);
    if (!process.env.BOOKING_URL) {
      expect(result.booking_url).toBe("");
      expect(result.manual_steps.join(" ")).toContain("create an event type");
    }
  });
});
