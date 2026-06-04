import { env } from "../config/env";
import { TransferCallInput } from "../schemas/toolSchemas";
import { RetellWebhookPayload } from "../schemas/webhookSchemas";
import { appendCallSummaryToGoogleSheets } from "./googleSheets";
import { normalizeUSPhone } from "./phone";
import { insertRecord } from "./supabase";

function getString(source: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export async function storeCallEvent(payload: RetellWebhookPayload): Promise<{
  persisted: boolean;
  event_type: string;
}> {
  const call = payload.call as Record<string, unknown> | undefined;
  const chat = payload.chat as Record<string, unknown> | undefined;
  const eventType = payload.event ?? "unknown";
  const record = {
    retell_call_id: getString(call, ["call_id", "id"]) ?? getString(chat, ["chat_id", "id"]),
    event_type: eventType,
    event_payload: payload as Record<string, unknown>,
    caller_phone: normalizeUSPhone(
      getString(call, ["from_number", "from", "user_number", "caller_phone"]) ??
        getString(chat, ["from_number", "to_number"]),
    ),
    agent_id: getString(call, ["agent_id"]) ?? getString(chat, ["agent_id"]),
  };

  const result = await insertRecord("call_events", record);
  if (result.error) console.error("Failed to persist Retell call event", { error: result.error });
  const sheetsResult = await appendCallSummaryToGoogleSheets(payload);
  if (sheetsResult.error) {
    console.error("Google Sheets call-summary mirror failed", { error: sheetsResult.error });
  } else if (sheetsResult.skipped_reason === "missing_credentials") {
    console.info("Google Sheets call-summary mirror skipped: missing credentials");
  }
  return { persisted: result.persisted, event_type: eventType };
}

export async function storeTransferEvent(input: TransferCallInput): Promise<{
  success: boolean;
  transfer_number_configured: boolean;
  message_for_agent: string;
}> {
  const transferNumberConfigured = Boolean(env.RETELL_TRANSFER_PHONE_NUMBER);
  const result = await insertRecord("call_events", {
    retell_call_id: input.retell_call_id ?? null,
    event_type: "transfer_requested",
    event_payload: {
      reason: input.reason,
      caller_name: input.caller_name,
      pest_issue: input.pest_issue,
      urgency_level: input.urgency_level,
      transfer_number_configured: transferNumberConfigured,
    },
    caller_phone: normalizeUSPhone(input.caller_phone),
    agent_id: env.RETELL_AGENT_ID || null,
  });
  if (result.error) console.error("Failed to persist transfer event", { error: result.error });

  return {
    success: transferNumberConfigured,
    transfer_number_configured: transferNumberConfigured,
    message_for_agent: transferNumberConfigured
      ? "Transfer event logged. Use the Retell transfer_call control now."
      : "Transfer number is not configured. Capture the caller information and say the team will follow up.",
  };
}
