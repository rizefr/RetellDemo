import { env } from "../config/env";
import { CreateLeadInput } from "../schemas/toolSchemas";
import { normalizeUSPhone } from "./phone";
import { insertRecord } from "./supabase";

export async function createLead(input: CreateLeadInput): Promise<{
  success: boolean;
  persisted: boolean;
  lead_id: string | null;
  caller_phone: string;
  alternate_phone: string | null;
  message_for_agent: string;
}> {
  const callerPhone = normalizeUSPhone(input.caller_phone);
  const alternatePhone = input.alternate_phone ? normalizeUSPhone(input.alternate_phone) : null;
  const addressParts = [
    input.property_address ? `Address: ${input.property_address}` : "",
    input.property_street ? `Street: ${input.property_street}` : "",
    input.property_city ? `City: ${input.property_city}` : "",
    input.property_state ? `State: ${input.property_state}` : "",
    input.property_zip ? `ZIP: ${input.property_zip}` : "",
  ].filter(Boolean);
  const callSummary = input.preferred_datetime
    ? `${input.call_summary} Preferred date/time: ${input.preferred_datetime}.`
    : input.call_summary;
  const enrichedCallSummary = addressParts.length ? `${callSummary} Property ${addressParts.join(", ")}.` : callSummary;
  const record = {
    caller_name: input.caller_name,
    caller_phone: callerPhone,
    alternate_phone: alternatePhone,
    pest_issue: input.pest_issue,
    urgency_level: input.urgency_level,
    preferred_booking_method: input.preferred_booking_method,
    service_area: input.service_area,
    zip_code: input.zip_code,
    property_address: input.property_address,
    property_street: input.property_street,
    property_city: input.property_city,
    property_state: input.property_state,
    property_zip: input.property_zip ?? input.zip_code,
    preferred_datetime: input.preferred_datetime,
    call_summary: enrichedCallSummary,
    retell_call_id: input.retell_call_id,
    source: input.source,
    booking_url: env.BOOKING_URL || null,
    transferred: input.preferred_booking_method === "transfer",
  };

  let result = await insertRecord("leads", record);
  if (result.error && /column .* does not exist|schema cache/i.test(result.error)) {
    const legacyRecord = {
      caller_name: record.caller_name,
      caller_phone: record.caller_phone,
      pest_issue: record.pest_issue,
      urgency_level: record.urgency_level,
      preferred_booking_method: record.preferred_booking_method,
      service_area: record.service_area,
      zip_code: record.zip_code ?? record.property_zip,
      call_summary: enrichedCallSummary,
      retell_call_id: record.retell_call_id,
      source: record.source,
      booking_url: record.booking_url,
      transferred: record.transferred,
    };
    result = await insertRecord("leads", legacyRecord);
  }
  if (result.error) {
    console.error("Failed to persist lead", { error: result.error });
    return {
      success: false,
      persisted: false,
      lead_id: null,
      caller_phone: callerPhone,
      alternate_phone: alternatePhone,
      message_for_agent:
        "The lead could not be saved in the backend. Continue politely and offer to transfer or have the team follow up.",
    };
  }

  return {
    success: true,
    persisted: result.persisted,
    lead_id: (result.data?.id as string | undefined) ?? null,
    caller_phone: callerPhone,
    alternate_phone: alternatePhone,
    message_for_agent: result.persisted
      ? "Lead saved. Continue the flow."
      : "Lead captured for local demo only because Supabase is not configured.",
  };
}
