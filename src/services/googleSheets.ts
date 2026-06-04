import crypto from "node:crypto";
import { env } from "../config/env";
import { RetellWebhookPayload } from "../schemas/webhookSchemas";
import { normalizeUSPhone } from "./phone";

export const callLogColumns = [
  "Timestamp",
  "Retell Call ID",
  "Agent ID",
  "Agent Version",
  "Direction",
  "Caller Number",
  "Caller Name",
  "Alternate Phone",
  "Pest Issue",
  "Property Address",
  "Service Area / ZIP",
  "Urgency",
  "Booking Method",
  "Appointment Requested",
  "Appointment Date/Time",
  "Cal.com Booking ID",
  "Cal.com Booking Status",
  "SMS Sent",
  "SMS Simulated",
  "Transfer Requested",
  "Transfer Status",
  "Call Outcome",
  "Lead Quality",
  "User Sentiment",
  "Summary",
  "Full Transcript Link or Notes",
  "Error / Follow-up Needed",
];

type FetchLike = typeof fetch;

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function boolValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  return "";
}

function firstString(sources: Array<Record<string, unknown> | undefined>, keys: string[]): string {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      const asString = stringValue(value);
      if (asString) return asString;
    }
  }
  return "";
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function transcriptNotes(call: Record<string, unknown> | undefined): string {
  if (!call) return "";
  const transcript = stringValue(call.transcript);
  if (transcript) return transcript.slice(0, 30000);
  const transcriptObject = objectValue(call.transcript_object);
  if (transcriptObject) return JSON.stringify(transcriptObject).slice(0, 30000);
  return firstString([call], ["recording_url", "public_log_url", "call_detail_url", "disconnection_reason"]);
}

export function shouldMirrorCallToSheets(payload: RetellWebhookPayload): boolean {
  const eventType = payload.event ?? "";
  return [
    "call_analyzed",
    "call_ended",
    "chat_analyzed",
    "chat_ended",
  ].includes(eventType);
}

export function buildCallLogRow(payload: RetellWebhookPayload): string[] {
  const call = objectValue(payload.call);
  const chat = objectValue(payload.chat);
  const analysis = objectValue(call?.call_analysis) ?? objectValue(chat?.chat_analysis);
  const custom =
    objectValue(analysis?.custom_analysis_data) ??
    objectValue(call?.custom_analysis_data) ??
    objectValue(chat?.custom_analysis_data) ??
    {};
  const sources = [custom, analysis, call, chat].filter(Boolean) as Array<Record<string, unknown>>;
  const callerPhone = normalizeUSPhone(
    firstString(sources, ["caller_phone", "from_number", "from", "user_number", "phone", "to_number"]),
  );
  const propertyAddress =
    firstString(sources, ["property_address", "address", "service_address"]) ||
    [
      firstString(sources, ["property_street"]),
      firstString(sources, ["property_city"]),
      firstString(sources, ["property_state"]),
      firstString(sources, ["property_zip", "zip_code"]),
    ]
      .filter(Boolean)
      .join(", ");
  const serviceArea = firstString(sources, ["service_area", "service_area_or_zip", "zip_code", "property_zip"]);
  const summary = firstString(sources, ["call_summary", "summary", "transcript_summary"]);
  const callId = firstString(sources, ["retell_call_id", "call_id", "id", "chat_id"]);
  const agentId = firstString(sources, ["agent_id"]);
  const timestamp = firstString(sources, ["end_timestamp", "start_timestamp", "created_at"]) || new Date().toISOString();

  return [
    timestamp,
    callId,
    agentId,
    firstString(sources, ["agent_version"]),
    firstString(sources, ["direction"]),
    callerPhone,
    firstString(sources, ["caller_name", "name"]),
    normalizeUSPhone(firstString(sources, ["alternate_phone"])),
    firstString(sources, ["pest_issue", "purpose"]),
    propertyAddress,
    serviceArea,
    firstString(sources, ["urgency_level", "urgency"]),
    firstString(sources, ["booking_method", "preferred_booking_method"]),
    boolValue(custom.appointment_requested ?? analysis?.appointment_requested),
    firstString(sources, ["preferred_datetime", "appointment_datetime", "confirmed_datetime"]),
    firstString(sources, ["calcom_booking_id", "provider_booking_id", "booking_id"]),
    firstString(sources, ["calcom_booking_status", "booking_status"]),
    boolValue(custom.sms_sent ?? analysis?.sms_sent),
    boolValue(custom.sms_simulated ?? analysis?.sms_simulated),
    boolValue(custom.transfer_requested ?? analysis?.transfer_requested),
    firstString(sources, ["transfer_status"]),
    firstString(sources, ["call_outcome", "outcome"]),
    firstString(sources, ["lead_quality_score", "lead_quality"]),
    firstString(sources, ["user_sentiment", "sentiment"]),
    summary,
    transcriptNotes(call ?? chat),
    firstString(sources, ["error", "follow_up_needed", "disconnection_reason"]),
  ];
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKey(): string {
  return env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, "\n");
}

async function getAccessToken(fetchImpl: FetchLike): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - 60 > now) return tokenCache.token;

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64Url(
    JSON.stringify({
      iss: env.GOOGLE_SHEETS_CLIENT_EMAIL,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsigned = `${header}.${claimSet}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey());
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof json.access_token !== "string") {
    throw new Error(`Google OAuth token request failed with status ${response.status}`);
  }

  tokenCache = {
    token: json.access_token,
    expiresAt: now + Number(json.expires_in ?? 3600),
  };
  return tokenCache.token;
}

function hasServiceAccountConfig(): boolean {
  return Boolean(env.GOOGLE_SHEET_ID && env.GOOGLE_SHEETS_CLIENT_EMAIL && env.GOOGLE_SHEETS_PRIVATE_KEY);
}

function appendUrl(): string {
  const range = encodeURIComponent(`${env.GOOGLE_SHEETS_TAB_NAME}!A:AA`);
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    env.GOOGLE_SHEET_ID,
  )}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
}

async function appendWithServiceAccount(row: string[], fetchImpl: FetchLike): Promise<void> {
  const accessToken = await getAccessToken(fetchImpl);
  const response = await fetchImpl(appendUrl(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ values: [row] }),
  });
  if (!response.ok) throw new Error(`Google Sheets append failed with status ${response.status}`);
}

async function appendWithAppsScript(row: string[], fetchImpl: FetchLike): Promise<void> {
  const response = await fetchImpl(env.GOOGLE_SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.GOOGLE_SHEETS_WEBHOOK_SECRET ? { "x-sheets-webhook-secret": env.GOOGLE_SHEETS_WEBHOOK_SECRET } : {}),
    },
    body: JSON.stringify({
      sheet_id: env.GOOGLE_SHEET_ID,
      tab_name: env.GOOGLE_SHEETS_TAB_NAME,
      columns: callLogColumns,
      row,
    }),
  });
  if (!response.ok) throw new Error(`Google Sheets Apps Script append failed with status ${response.status}`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`Google Sheets append timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function appendCallSummaryToGoogleSheets(
  payload: RetellWebhookPayload,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<{ attempted: boolean; appended: boolean; skipped_reason?: string; error?: string }> {
  if (!shouldMirrorCallToSheets(payload)) {
    return { attempted: false, appended: false, skipped_reason: "event_not_mirrored" };
  }
  if (!env.GOOGLE_SHEETS_ENABLED) {
    return { attempted: false, appended: false, skipped_reason: "disabled" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const row = buildCallLogRow(payload);

  try {
    if (env.GOOGLE_SHEETS_WEBHOOK_URL) {
      await withTimeout(appendWithAppsScript(row, fetchImpl), options.timeoutMs ?? 1500);
      return { attempted: true, appended: true };
    }
    if (hasServiceAccountConfig()) {
      await withTimeout(appendWithServiceAccount(row, fetchImpl), options.timeoutMs ?? 1500);
      return { attempted: true, appended: true };
    }
    return { attempted: false, appended: false, skipped_reason: "missing_credentials" };
  } catch (error) {
    return {
      attempted: true,
      appended: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

