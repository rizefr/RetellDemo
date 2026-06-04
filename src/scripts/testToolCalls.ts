import { checkServiceArea } from "../services/serviceArea";
import { createLead } from "../services/leads";
import { sendBookingSms } from "../services/sms";
import { getCalendarAdapter } from "../services/calendar";

async function main() {
  console.log("Service area:", checkServiceArea({ city: "Brooklyn", state: "NY", zip_code: null }));
  const lead = await createLead({
    caller_name: "Demo",
    caller_phone: "(718) 555-1234",
    pest_issue: "ants in kitchen",
    urgency_level: "low",
    preferred_booking_method: "sms_link",
    service_area: "Brooklyn",
    zip_code: "11201",
    alternate_phone: null,
    property_address: "25 Pine Street, Brooklyn, NY 11201",
    property_street: "25 Pine Street",
    property_city: "Brooklyn",
    property_state: "NY",
    property_zip: "11201",
    preferred_datetime: null,
    call_summary: "Demo tool call test.",
    retell_call_id: "local_test",
    source: "retell_voice_agent",
  });
  console.log("Lead:", lead);
  console.log(
    "SMS:",
    await sendBookingSms({
      caller_name: "Demo",
      caller_phone: "(718) 555-1234",
      pest_issue: "ants in kitchen",
      booking_url: "https://example.com/book",
      business_name: "Elijah's Pest Control",
      lead_id: lead.lead_id,
    }),
  );
  console.log(
    "Calendar:",
    await getCalendarAdapter().checkAvailability({
      preferred_date: "2026-06-01",
      preferred_time: "morning",
      timezone: "America/New_York",
      appointment_type: "pest_control_service",
      pest_issue: "ants",
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
