import { describe, expect, it } from "vitest";
import { createLead } from "../services/leads";
import { sendBookingSms } from "../services/sms";
import { storeTransferEvent } from "../services/callEvents";

describe("lead flow", () => {
  it("normalizes phone numbers and captures a lead without Supabase configured", async () => {
    const result = await createLead({
      caller_name: "Alex",
      caller_phone: "(718) 555-1212",
      pest_issue: "ants in kitchen",
      urgency_level: "low",
      preferred_booking_method: "sms_link",
      service_area: "Brooklyn",
      zip_code: "11215",
      alternate_phone: "917-555-3434",
      property_address: "25 Pine Street, Brooklyn, NY 11215",
      property_street: "25 Pine Street",
      property_city: "Brooklyn",
      property_state: "NY",
      property_zip: "11215",
      preferred_datetime: "Friday morning",
      call_summary: "Caller wants help with ants.",
      retell_call_id: null,
      source: "retell_voice_agent",
    });

    expect(result.success).toBe(true);
    expect(result.caller_phone).toBe("+17185551212");
    expect(result.alternate_phone).toBe("+19175553434");
  });

  it("simulates SMS by default and tells the agent not to claim the text was sent", async () => {
    const result = await sendBookingSms({
      caller_name: "Alex",
      caller_phone: "(718) 555-1212",
      pest_issue: "ants in kitchen",
      booking_url: "https://example.com/book",
      business_name: "Elijah's Pest Control",
      lead_id: null,
    });

    expect(result.success).toBe(true);
    expect(result.sms_sent).toBe(false);
    expect(result.sms_simulated).toBe(true);
    expect(result.sent).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.message_for_agent).toContain("Do not say the text was sent");
  });

  it("logs transfer requests and reports transfer config state safely", async () => {
    const result = await storeTransferEvent({
      reason: "Caller asked for a live person",
      caller_name: "Alex",
      caller_phone: "7185551212",
      pest_issue: "hornets",
      urgency_level: "high",
      retell_call_id: null,
    });

    expect(result.success).toBe(result.transfer_number_configured);
    expect(result.message_for_agent).toContain(
      result.transfer_number_configured ? "Use the Retell transfer_call control now" : "Transfer number is not configured",
    );
  });
});
