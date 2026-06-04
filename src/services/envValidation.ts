import { env, Env } from "../config/env";

export interface EnvValidationReport {
  missing: string[];
  warnings: string[];
  recommendations: string[];
}

const secretLike = new Set<keyof Env>([
  "RETELL_API_KEY",
  "RETELL_WEBHOOK_SECRET_OR_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "CALCOM_API_KEY",
]);

export function safeEnvValue(key: keyof Env, value = String(env[key] ?? "")): string {
  if (!value) return "";
  if (secretLike.has(key)) return "<set>";
  if (key.includes("PHONE_NUMBER")) return value.replace(/^(\+\d{1,3})\d+(\d{2})$/, "$1***$2");
  return value;
}

function normalizedUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function validateSetupEnv(): EnvValidationReport {
  const required: Array<keyof Env> = [
    "RETELL_API_KEY",
    "RETELL_PHONE_NUMBER",
    "RETELL_TRANSFER_PHONE_NUMBER",
    "PUBLIC_BASE_URL",
    "RETELL_WEBHOOK_URL",
    "TOOLS_BASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DEFAULT_BUSINESS_NAME",
  ];

  const missing = required.filter((key) => !String(env[key] ?? "").trim()).map((key) => `${key}=`);
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!env.BOOKING_URL) {
    warnings.push(
      "BOOKING_URL is not set. The agent will capture leads and use safe follow-up wording instead of claiming a booking link was sent.",
    );
  }

  if (env.DEFAULT_BUSINESS_NAME !== "Elijah's Pest Control") {
    recommendations.push(
      `Set DEFAULT_BUSINESS_NAME=Elijah's Pest Control in .env for this demo. Current value: ${safeEnvValue(
        "DEFAULT_BUSINESS_NAME",
      )}`,
    );
  }

  if (env.CALENDAR_PROVIDER !== "none" && env.CALENDAR_PROVIDER !== "mock") {
    if (!env.CALCOM_EVENT_TYPE_ID && (!env.CALCOM_USERNAME || !env.CALCOM_EVENT_SLUG)) {
      warnings.push(
        "CALENDAR_PROVIDER=calcom but CALCOM_EVENT_TYPE_ID or CALCOM_USERNAME/CALCOM_EVENT_SLUG is missing. Runtime booking must fall back to lead capture.",
      );
    }
  }

  if (env.SMS_MODE !== "retell") {
    recommendations.push("Recommended demo value: SMS_MODE=retell with outbound SMS disabled, so SMS remains simulated.");
  }

  if (env.RETELL_SMS_NODE_ENABLED) {
    warnings.push("RETELL_SMS_NODE_ENABLED=true. Keep this false until a real Retell SMS node test succeeds.");
  }

  if (env.RETELL_OUTBOUND_SMS_ENABLED) {
    warnings.push("RETELL_OUTBOUND_SMS_ENABLED=true. Keep this false until a real outbound SMS test succeeds.");
  }

  const publicBaseUrl = normalizedUrl(env.PUBLIC_BASE_URL);
  const toolsBaseUrl = normalizedUrl(env.TOOLS_BASE_URL);
  const expectedWebhookUrl = `${publicBaseUrl}/retell/webhook`;

  if (publicBaseUrl && !publicBaseUrl.startsWith("https://")) {
    warnings.push("PUBLIC_BASE_URL should be the current HTTPS ngrok URL.");
  }

  if (publicBaseUrl && env.RETELL_WEBHOOK_URL && normalizedUrl(env.RETELL_WEBHOOK_URL) !== expectedWebhookUrl) {
    warnings.push(`RETELL_WEBHOOK_URL should be ${expectedWebhookUrl}`);
  }

  if (publicBaseUrl && toolsBaseUrl && toolsBaseUrl !== publicBaseUrl) {
    warnings.push(`TOOLS_BASE_URL should be ${publicBaseUrl}`);
  }

  return { missing, warnings, recommendations };
}
