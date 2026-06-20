import { env } from "../config/env";

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : fallback;
}

export function outboundBusinessRuntimeSettings(business: Record<string, unknown>) {
  const envAllowlist = env.OUTBOUND_TEST_PHONE_ALLOWLIST.split(",").map((value) => value.trim()).filter(Boolean);
  const testMode = typeof business.test_mode === "boolean" ? business.test_mode : env.OUTBOUND_TEST_MODE;
  const allowlist = stringArray(business.test_phone_allowlist, envAllowlist);
  const maxBatchSize = Number(business.max_batch_size ?? env.OUTBOUND_MAX_BATCH_SIZE);
  const emailFrom = String(business.email_from || env.OUTBOUND_PAYMENT_EMAIL_FROM || "");
  const emailRequested = Boolean(business.payment_email_enabled);
  const emailProviderReady = Boolean(
    env.OUTBOUND_PAYMENT_EMAIL_ENABLED &&
      env.EMAIL_PROVIDER === "resend" &&
      env.EMAIL_PROVIDER_API_KEY &&
      env.OUTBOUND_PAYMENT_EMAIL_FROM &&
      emailFrom === env.OUTBOUND_PAYMENT_EMAIL_FROM,
  );
  const smsRequested = Boolean(business.retell_sms_enabled);
  const smsProviderReady = Boolean(env.OUTBOUND_RETELL_SMS_ENABLED && env.OUTBOUND_RETELL_SMS_CHAT_AGENT_ID);
  return {
    testMode,
    allowlist,
    maxBatchSize,
    allowAfterHoursTestOverride: Boolean(
      (typeof business.allow_after_hours_test_override === "boolean"
        ? business.allow_after_hours_test_override
        : env.OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE) && env.OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE,
    ),
    emailRequested,
    emailProviderReady,
    emailEffective: emailRequested && emailProviderReady,
    emailFrom,
    emailTestRecipientAllowlist: stringArray(business.email_test_recipient_allowlist, []),
    smsRequested,
    smsProviderReady,
    smsEffective: smsRequested && smsProviderReady,
  };
}
