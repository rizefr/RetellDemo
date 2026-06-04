import Retell from "retell-sdk";
import { env } from "../config/env";
import { SendBookingSmsInput } from "../schemas/toolSchemas";
import { normalizeUSPhone } from "./phone";
import { insertRecord } from "./supabase";

function renderTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{{${key}}}`, value),
    template,
  );
}

async function storeSmsEvent(input: {
  lead_id?: string | null;
  caller_phone: string;
  message: string;
  booking_url: string;
  status: string;
  provider: string;
  provider_response: Record<string, unknown>;
}) {
  const result = await insertRecord("sms_events", {
    lead_id: input.lead_id ?? null,
    caller_phone: input.caller_phone,
    message: input.message,
    booking_url: input.booking_url,
    status: input.status,
    provider: input.provider,
    provider_response: input.provider_response,
  });
  if (result.error) console.error("Failed to persist SMS event", { error: result.error });
  return result;
}

export async function sendBookingSms(input: SendBookingSmsInput): Promise<{
  success: boolean;
  sms_sent: boolean;
  sms_simulated: boolean;
  sent: boolean;
  simulated: boolean;
  provider: string;
  message: string;
  message_for_agent: string;
}> {
  const callerPhone = normalizeUSPhone(input.caller_phone);
  const bookingUrl = input.booking_url || env.BOOKING_URL;
  const businessName = input.business_name || env.DEFAULT_BUSINESS_NAME;
  const message = renderTemplate(env.SMS_BOOKING_MESSAGE_TEMPLATE, {
    caller_name: input.caller_name,
    caller_phone: callerPhone,
    pest_issue: input.pest_issue,
    booking_url: bookingUrl || "[BOOKING_URL not configured]",
    business_name: businessName,
  });

  if (!bookingUrl) {
    await storeSmsEvent({
      lead_id: input.lead_id,
      caller_phone: callerPhone,
      message,
      booking_url: "",
      status: "simulated_missing_booking_url",
      provider: env.SMS_MODE,
      provider_response: { simulated: true, reason: "BOOKING_URL is not configured" },
    });
    return {
      success: true,
      sms_sent: false,
      sms_simulated: true,
      sent: false,
      simulated: true,
      provider: env.SMS_MODE,
      message,
      message_for_agent:
        "SMS was simulated because no verified booking URL is configured. Do not say the text was sent; say the request is saved and the team can send the link.",
    };
  }

  if (env.SMS_MODE === "mock") {
    await storeSmsEvent({
      lead_id: input.lead_id,
      caller_phone: callerPhone,
      message,
      booking_url: bookingUrl,
      status: "sent_mock",
      provider: "mock",
      provider_response: { mock: true },
    });
    return {
      success: true,
      sms_sent: true,
      sms_simulated: false,
      sent: true,
      simulated: false,
      provider: "mock",
      message,
      message_for_agent:
        "Mock SMS succeeded. In a test call, you may say the booking link was sent.",
    };
  }

  if (env.SMS_MODE === "retell" && env.RETELL_OUTBOUND_SMS_ENABLED) {
    if (!env.RETELL_API_KEY || !env.RETELL_PHONE_NUMBER) {
      await storeSmsEvent({
        lead_id: input.lead_id,
        caller_phone: callerPhone,
        message,
        booking_url: bookingUrl,
        status: "simulated_missing_retell_sms_config",
        provider: "retell",
        provider_response: { reason: "RETELL_API_KEY or RETELL_PHONE_NUMBER missing" },
      });
      return {
        success: true,
        sms_sent: false,
        sms_simulated: true,
        sent: false,
        simulated: true,
        provider: "retell",
        message,
        message_for_agent:
          "SMS was simulated because Retell outbound SMS is not fully configured. Do not say the text was sent.",
      };
    }

    try {
      const client = new Retell({ apiKey: env.RETELL_API_KEY });
      const response = await client.chat.createSMSChat({
        from_number: env.SMS_FROM_NUMBER || env.RETELL_PHONE_NUMBER,
        to_number: callerPhone,
        override_agent_id: env.RETELL_SMS_CHAT_AGENT_ID || undefined,
        retell_llm_dynamic_variables: {
          caller_name: input.caller_name,
          booking_url: bookingUrl,
          business_name: businessName,
          pest_issue: input.pest_issue,
        },
        metadata: {
          source: "retell_pest_control_demo",
          note: "Retell outbound SMS API generates the initial message from the configured chat agent.",
        },
      });
      await storeSmsEvent({
        lead_id: input.lead_id,
        caller_phone: callerPhone,
        message,
        booking_url: bookingUrl,
        status: "sent_retell_outbound_sms",
        provider: "retell",
        provider_response: response as unknown as Record<string, unknown>,
      });
      return {
        success: true,
        sms_sent: true,
        sms_simulated: false,
        sent: true,
        simulated: false,
        provider: "retell",
        message,
        message_for_agent:
          "Retell outbound SMS API returned success. You may say the booking link was sent only if the configured SMS chat agent sends the expected booking-link message.",
      };
    } catch (error) {
      console.error("Retell outbound SMS failed", { error });
      await storeSmsEvent({
        lead_id: input.lead_id,
        caller_phone: callerPhone,
        message,
        booking_url: bookingUrl,
        status: "failed_retell_outbound_sms",
        provider: "retell",
        provider_response: { error: error instanceof Error ? error.message : String(error) },
      });
      return {
        success: false,
        sms_sent: false,
        sms_simulated: false,
        sent: false,
        simulated: false,
        provider: "retell",
        message,
        message_for_agent:
          "SMS provider failed. Do not say the text was sent; say the team has the request and can follow up.",
      };
    }
  }

  await storeSmsEvent({
    lead_id: input.lead_id,
    caller_phone: callerPhone,
    message,
    booking_url: bookingUrl,
    status: env.SMS_MODE === "off" ? "not_sent_sms_off" : "simulated",
    provider: env.SMS_MODE,
    provider_response: { simulated: true, reason: "SMS provider is not enabled for this demo" },
  });

  return {
    success: true,
    sms_sent: false,
    sms_simulated: true,
    sent: false,
    simulated: true,
    provider: env.SMS_MODE,
    message,
    message_for_agent:
      "SMS was simulated and logged. Do not say the text was sent; say the request is saved and the team can send the link once texting is enabled.",
  };
}
