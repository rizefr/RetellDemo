import dotenv from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "test") {
  dotenv.config();
}

const booleanFromString = z
  .union([z.boolean(), z.string(), z.undefined()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (!value) return false;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  VERCEL_ENV: z.string().optional().default(""),
  PORT: z.coerce.number().int().positive().default(3000),

  RETELL_API_KEY: z.string().optional().default(""),
  RETELL_AGENT_ID: z.string().optional().default(""),
  RETELL_CONVERSATION_FLOW_ID: z.string().optional().default(""),
  RETELL_PHONE_NUMBER: z.string().optional().default(""),
  RETELL_WEBHOOK_SECRET_OR_API_KEY: z.string().optional().default(""),
  RETELL_TRANSFER_PHONE_NUMBER: z.string().optional().default(""),
  RETELL_AGENT_NAME: z.string().default("Elijah's Pest Control Demo Receptionist"),
  RETELL_VOICE_ID: z.string().default("11labs-Cimo"),
  RETELL_KNOWLEDGE_BASE_ID: z.string().optional().default("knowledge_base_5c6a5b20b1a9ed4f"),
  RETELL_SINGLE_PROMPT_CANDIDATE_AGENT_ID: z.string().optional().default(""),
  RETELL_SINGLE_PROMPT_CANDIDATE_LLM_ID: z.string().optional().default(""),
  RETELL_SMS_NODE_ENABLED: booleanFromString.default(false),
  RETELL_OUTBOUND_SMS_ENABLED: booleanFromString.default(false),
  RETELL_SMS_CHAT_AGENT_ID: z.string().optional().default(""),

  APP_BASE_URL: z.string().optional().default(""),
  OUTBOUND_ADMIN_TOKEN: z.string().optional().default(""),
  OUTBOUND_TEST_MODE: booleanFromString.default(true),
  OUTBOUND_TEST_PHONE_ALLOWLIST: z.string().optional().default(""),
  OUTBOUND_MAX_BATCH_SIZE: z.coerce.number().int().positive().max(25).default(3),
  OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE: booleanFromString.default(false),
  OUTBOUND_RETELL_AGENT_ID: z.string().optional().default(""),
  OUTBOUND_RETELL_CONVERSATION_FLOW_ID: z.string().optional().default(""),
  OUTBOUND_RETELL_PHONE_NUMBER_ID: z.string().optional().default(""),
  OUTBOUND_RETELL_AGENT_NAME: z.string().default("Elevator Inspection Collections — Sophia"),
  OUTBOUND_RETELL_VOICE_ID: z.string().optional().default(""),
  OUTBOUND_RETELL_WEBHOOK_SECRET: z.string().optional().default(""),
  OUTBOUND_RETELL_SMS_ENABLED: booleanFromString.default(false),
  OUTBOUND_RETELL_SMS_CHAT_AGENT_ID: z.string().optional().default(""),
  RETELL_FROM_NUMBER: z.string().optional().default("+19842075346"),
  CONFIRM_CREATE_RETELL_OUTBOUND_AGENT: booleanFromString.default(false),

  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  HUMAN_TRANSFER_NUMBER: z.string().optional().default(""),
  BUSINESS_CALLBACK_NUMBER: z.string().optional().default(""),
  EMAIL_PROVIDER_API_KEY: z.string().optional().default(""),
  EMAIL_PROVIDER: z.enum(["none", "resend"]).default("none"),
  OUTBOUND_PAYMENT_EMAIL_FROM: z.string().optional().default(""),
  OUTBOUND_PAYMENT_EMAIL_ENABLED: booleanFromString.default(false),

  QUICKBOOKS_CLIENT_ID: z.string().optional().default(""),
  QUICKBOOKS_CLIENT_SECRET: z.string().optional().default(""),
  QUICKBOOKS_REDIRECT_URI: z.string().optional().default(""),
  QUICKBOOKS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),

  PUBLIC_BASE_URL: z.string().optional().default(""),
  RETELL_WEBHOOK_URL: z.string().optional().default(""),
  TOOLS_BASE_URL: z.string().optional().default(""),

  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  SUPABASE_ANON_KEY: z.string().optional().default(""),
  SUPABASE_DB_URL: z.string().optional().default(""),

  BOOKING_URL: z.string().optional().default(""),
  DEFAULT_BUSINESS_NAME: z.string().default("Elijah's Pest Control"),
  DEFAULT_BUSINESS_PHONE: z.string().optional().default(""),
  DEFAULT_BUSINESS_TIMEZONE: z.string().default("America/New_York"),

  SMS_MODE: z.enum(["retell", "mock", "simulated", "off"]).default("retell"),
  SMS_FROM_NUMBER: z.string().optional().default(""),
  SMS_BOOKING_MESSAGE_TEMPLATE: z
    .string()
    .default(
      "Hi {{caller_name}}, here is the booking link for {{business_name}} pest control service: {{booking_url}}. Please choose a time and enter your service details there.",
    ),

  CALENDAR_PROVIDER: z.enum(["none", "mock", "calcom"]).default("none"),
  CALCOM_API_KEY: z.string().optional().default(""),
  CALCOM_EVENT_TYPE_ID: z.string().optional().default(""),
  CALCOM_USERNAME: z.string().optional().default(""),
  CALCOM_EVENT_SLUG: z.string().optional().default(""),
  BOOKING_PLACEHOLDER_EMAIL: z.string().email().default("demo@example.com"),

  GOOGLE_SHEETS_ENABLED: booleanFromString.default(false),
  GOOGLE_SHEET_ID: z.string().optional().default(""),
  GOOGLE_SHEETS_CLIENT_EMAIL: z.string().optional().default(""),
  GOOGLE_SHEETS_PRIVATE_KEY: z.string().optional().default(""),
  GOOGLE_SHEETS_TAB_NAME: z.string().default("Call Logs"),
  GOOGLE_SHEETS_WEBHOOK_URL: z.string().optional().default(""),
  GOOGLE_SHEETS_WEBHOOK_SECRET: z.string().optional().default(""),

  ALLOW_UNVERIFIED_WEBHOOKS: booleanFromString.default(false),
});

export const env = envSchema.parse(process.env);

export type Env = typeof env;

export function requireEnv(keys: Array<keyof Env>): string[] {
  return keys.filter((key) => {
    const value = env[key];
    return value === undefined || value === null || value === "";
  });
}

export function isProduction(): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

export function getWebhookSecret(): string {
  return env.RETELL_WEBHOOK_SECRET_OR_API_KEY || env.RETELL_API_KEY;
}
