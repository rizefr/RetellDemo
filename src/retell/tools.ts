import { env } from "../config/env";

function toolUrl(baseUrl: string, name: string): string {
  return `${baseUrl.replace(/\/$/, "")}/tools/${name}`;
}

export interface CustomToolDefinitionOptions {
  candidateCalendar?: boolean;
}

export interface RetellControlToolOptions {
  quietTransferExecution?: boolean;
}

export interface NativeCalComToolOptions {
  apiKey?: string;
  eventTypeId?: string | number;
  timezone?: string;
}

export function buildCustomToolDefinitions(
  baseUrl = env.TOOLS_BASE_URL || env.PUBLIC_BASE_URL,
  options: CustomToolDefinitionOptions = {},
) {
  const calendarPrefix = options.candidateCalendar ? "candidate/" : "";
  return [
    {
      type: "custom",
      name: "check_service_area",
      tool_id: "tool_check_service_area",
      description:
        "Check whether a city, ZIP, or state appears in the pest-control company's filled-in knowledge-base service area. If the KB service area is blank, return maybe.",
      url: toolUrl(baseUrl, "check-service-area"),
      method: "POST",
      args_at_root: true,
      timeout_ms: 10000,
      speak_during_execution: false,
      speak_after_execution: true,
      parameters: {
        type: "object",
        properties: {
          zip_code: { type: "string", nullable: true },
          city: { type: "string", nullable: true },
          state: { type: "string", nullable: true },
        },
        required: [],
      },
    },
    {
      type: "custom",
      name: "create_lead",
      tool_id: "tool_create_lead",
      description:
        "Save a meaningful pest-control caller as a lead. Call this before SMS booking, phone booking fallback, or transfer follow-up.",
      url: toolUrl(baseUrl, "create-lead"),
      method: "POST",
      args_at_root: true,
      timeout_ms: 15000,
      speak_during_execution: false,
      speak_after_execution: true,
      response_variables: {
        lead_id: "$.lead_id",
        normalized_caller_phone: "$.caller_phone",
      },
      parameters: {
        type: "object",
        properties: {
          caller_name: { type: "string" },
          caller_phone: { type: "string", default: "{{user_number}}" },
          alternate_phone: { type: "string", nullable: true },
          pest_issue: { type: "string" },
          urgency_level: { type: "string", enum: ["low", "medium", "high", "emergency"] },
          preferred_booking_method: {
            type: "string",
            enum: ["sms_link", "phone_booking", "transfer", "callback", "unknown"],
          },
          service_area: { type: "string", nullable: true },
          zip_code: { type: "string", nullable: true },
          property_address: { type: "string", nullable: true },
          property_street: { type: "string", nullable: true },
          property_city: { type: "string", nullable: true },
          property_state: { type: "string", nullable: true },
          property_zip: { type: "string", nullable: true },
          preferred_datetime: { type: "string", nullable: true },
          call_summary: { type: "string" },
          retell_call_id: { type: "string", nullable: true, default: "{{call_id}}" },
          source: { type: "string", const: "retell_voice_agent" },
        },
        required: ["caller_name", "caller_phone", "pest_issue", "urgency_level", "preferred_booking_method"],
      },
    },
    {
      type: "custom",
      name: "send_booking_sms",
      tool_id: "tool_send_booking_sms",
      description:
        "Send or simulate the pest-control booking link SMS. Only tell the caller a text was sent when the response says sms_sent=true.",
      url: toolUrl(baseUrl, "send-booking-sms"),
      method: "POST",
      args_at_root: true,
      timeout_ms: 15000,
      speak_during_execution: true,
      execution_message_type: "static_text",
      execution_message_description: "One moment while I handle that.",
      speak_after_execution: true,
      response_variables: {
        sms_sent: "$.sms_sent",
        sms_simulated: "$.sms_simulated",
      },
      parameters: {
        type: "object",
        properties: {
          caller_name: { type: "string" },
          caller_phone: { type: "string", default: "{{user_number}}" },
          pest_issue: { type: "string" },
          booking_url: { type: "string", default: "{{booking_url}}" },
          business_name: { type: "string", default: "{{business_name}}" },
          lead_id: { type: "string", nullable: true },
          retell_call_id: { type: "string", nullable: true, default: "{{call_id}}" },
        },
        required: ["caller_name", "caller_phone", "pest_issue"],
      },
    },
    {
      type: "custom",
      name: "log_transfer_request",
      tool_id: "tool_log_transfer_request",
      description:
        "Log an urgent or human-requested transfer before using Retell's transfer_call tool when time allows.",
      url: toolUrl(baseUrl, "transfer-call"),
      method: "POST",
      args_at_root: true,
      timeout_ms: 10000,
      speak_during_execution: false,
      speak_after_execution: false,
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          caller_name: { type: "string", nullable: true },
          caller_phone: { type: "string", nullable: true, default: "{{user_number}}" },
          pest_issue: { type: "string", nullable: true },
          urgency_level: { type: "string", enum: ["medium", "high", "emergency"] },
          retell_call_id: { type: "string", nullable: true, default: "{{call_id}}" },
        },
        required: ["reason", "urgency_level"],
      },
    },
    {
      type: "custom",
      name: "check_availability_cal",
      tool_id: "tool_check_availability_cal",
      description:
        options.candidateCalendar
          ? "Check real Cal.com availability for the single-prompt candidate. Offer returned slots only; do not confirm until booking succeeds."
          : "Check appointment availability through the configured calendar adapter. If disabled, do not promise a confirmed slot.",
      url: toolUrl(baseUrl, `${calendarPrefix}check-availability-cal`),
      method: "POST",
      args_at_root: true,
      timeout_ms: 15000,
      speak_during_execution: true,
      speak_after_execution: true,
      parameters: {
        type: "object",
        properties: {
          preferred_date: { type: "string" },
          preferred_time: { type: "string" },
          timezone: { type: "string" },
          appointment_type: { type: "string", const: "pest_control_service" },
          pest_issue: { type: "string" },
        },
        required: ["preferred_date", "preferred_time", "pest_issue"],
      },
    },
    {
      type: "custom",
      name: "book_appointment_cal",
      tool_id: "tool_book_appointment_cal",
      description:
        options.candidateCalendar
          ? "Book a Cal.com appointment for the single-prompt candidate. Only confirm the appointment when confirmed=true."
          : "Book an appointment through the configured calendar adapter. Only confirm the appointment when confirmed=true.",
      url: toolUrl(baseUrl, `${calendarPrefix}book-appointment-cal`),
      method: "POST",
      args_at_root: true,
      timeout_ms: 20000,
      speak_during_execution: true,
      speak_after_execution: true,
      parameters: {
        type: "object",
        properties: {
          caller_name: { type: "string" },
          caller_phone: { type: "string", default: "{{user_number}}" },
          alternate_phone: { type: "string", nullable: true },
          email: { type: "string", default: "{{booking_placeholder_email}}" },
          pest_issue: { type: "string" },
          selected_datetime: { type: "string" },
          timezone: { type: "string" },
          notes: { type: "string" },
          property_address: { type: "string", nullable: true },
          property_street: { type: "string", nullable: true },
          property_city: { type: "string", nullable: true },
          property_state: { type: "string", nullable: true },
          property_zip: { type: "string", nullable: true },
          lead_id: { type: "string", nullable: true },
        },
        required: ["caller_name", "caller_phone", "pest_issue", "selected_datetime"],
      },
    },
  ];
}

export function buildRetellControlTools(options: RetellControlToolOptions = {}) {
  const tools: Array<Record<string, unknown>> = [
    {
      type: "transfer_call",
      name: "transfer_call",
      description:
        "Transfer urgent, dangerous, angry, confused, unsupported, or live-person-request calls.",
      transfer_destination: {
        type: "predefined",
        number: env.RETELL_TRANSFER_PHONE_NUMBER || "{{transfer_number}}",
      },
      transfer_option: {
        type: "cold_transfer",
        cold_transfer_mode: "sip_invite",
        show_transferee_as_caller: false,
        transfer_ring_duration_ms: 45000,
      },
      speak_during_execution: !options.quietTransferExecution,
      execution_message_type: "static_text",
      execution_message_description:
        "One moment - I'm going to connect you with someone who can help right away.",
    },
    {
      type: "end_call",
      name: "end_call",
      description: "End the call after the caller has no other questions and the closing line has been said.",
      speak_during_execution: false,
    },
  ];

  if (env.RETELL_SMS_NODE_ENABLED) {
    tools.push({
      type: "send_sms",
      name: "send_booking_sms_retell",
      description:
        "Send the booking link by SMS during the active call. Only use this if the Retell number is verified as SMS-capable.",
      sms_content: {
        type: "predefined",
        content: env.SMS_BOOKING_MESSAGE_TEMPLATE,
      },
      speak_during_execution: true,
      execution_message_type: "static_text",
      execution_message_description: "One moment while I send that booking link.",
    });
  }

  return tools;
}

export function buildNativeCalComTools(options: NativeCalComToolOptions = {}) {
  const apiKey = options.apiKey ?? env.CALCOM_API_KEY;
  const eventTypeId = options.eventTypeId ?? env.CALCOM_EVENT_TYPE_ID;
  const timezone = options.timezone ?? env.DEFAULT_BUSINESS_TIMEZONE;
  if (!apiKey || !eventTypeId) return [];
  return [
    {
      type: "check_availability_cal",
      name: "check_availability_cal",
      description:
        "Retell native Cal.com availability check. Use after collecting first name, phone confirmation, pest issue, address when available, and preferred day/time. Offer returned slots only.",
      cal_api_key: apiKey,
      event_type_id: Number.isNaN(Number(eventTypeId)) ? eventTypeId : Number(eventTypeId),
      timezone,
    },
    {
      type: "book_appointment_cal",
      name: "book_appointment_cal",
      description:
        "Retell native Cal.com booking tool. Use only after the caller chooses a returned slot and confirms the final echo verification. Confirm the appointment only after this tool succeeds.",
      cal_api_key: apiKey,
      event_type_id: Number.isNaN(Number(eventTypeId)) ? eventTypeId : Number(eventTypeId),
      timezone,
    },
  ];
}
