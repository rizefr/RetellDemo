import { DateTime } from "luxon";

export const OUTBOUND_DEFAULT_TIMEZONE = "America/New_York";
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const OUTSTANDING_INVOICE_STATUSES = new Set(["unpaid", "payment_link_sent"]);

export type OutboundEligibilityInput = {
  now: Date;
  timezone?: string | null;
  phoneNumber: string;
  invoiceStatus: string;
  outreachPaused: boolean;
  hasActiveCall: boolean;
  testMode: boolean;
  allowlist: string[];
};

export function normalizeOutboundTimezone(timezone?: string | null): string {
  if (!timezone) return OUTBOUND_DEFAULT_TIMEZONE;
  return DateTime.now().setZone(timezone).isValid ? timezone : OUTBOUND_DEFAULT_TIMEZONE;
}

export function isValidE164(phoneNumber: string): boolean {
  return E164_PATTERN.test(phoneNumber);
}

export function isWithinOutboundCallingWindow(now: Date, timezone?: string | null): boolean {
  const local = DateTime.fromJSDate(now, { zone: normalizeOutboundTimezone(timezone) });
  return local.weekday <= 5 && local.hour >= 10 && local.hour < 16;
}

export function evaluateOutboundCallEligibility(
  input: OutboundEligibilityInput,
): { eligible: true; reason: "eligible" } | { eligible: false; reason: string } {
  if (input.outreachPaused) return { eligible: false, reason: "outreach_paused" };
  if (!OUTSTANDING_INVOICE_STATUSES.has(input.invoiceStatus)) {
    return { eligible: false, reason: "invoice_not_outstanding" };
  }
  if (!isValidE164(input.phoneNumber)) return { eligible: false, reason: "invalid_phone_number" };
  if (input.hasActiveCall) return { eligible: false, reason: "active_call_exists" };
  if (!isWithinOutboundCallingWindow(input.now, input.timezone)) {
    return { eligible: false, reason: "outside_calling_window" };
  }
  if (input.testMode && !input.allowlist.includes(input.phoneNumber)) {
    return { eligible: false, reason: "test_number_not_allowlisted" };
  }
  return { eligible: true, reason: "eligible" };
}

export type OutboundBatchMode = "dry_run" | "test" | "real";

export const AFTER_HOURS_TEST_CONFIRMATION = "I UNDERSTAND THIS IS AN AFTER-HOURS TEST";

export type AfterHoursTestOverrideInput = {
  overrideConfigured: boolean;
  testMode: boolean;
  maxBatchSize: number;
  phoneNumber: string;
  allowlist: string[];
  acknowledged: boolean;
  confirmation: string;
  reason: string;
};

export function evaluateAfterHoursTestOverride(
  input: AfterHoursTestOverrideInput,
): { allowed: boolean; reason: string } {
  if (!input.overrideConfigured) return { allowed: false, reason: "after_hours_override_disabled" };
  if (!input.testMode) return { allowed: false, reason: "after_hours_override_requires_test_mode" };
  if (input.maxBatchSize !== 1) return { allowed: false, reason: "after_hours_override_requires_batch_size_one" };
  if (!input.allowlist.includes(input.phoneNumber)) return { allowed: false, reason: "test_number_not_allowlisted" };
  if (!input.acknowledged) return { allowed: false, reason: "after_hours_warning_not_acknowledged" };
  if (input.confirmation !== AFTER_HOURS_TEST_CONFIRMATION) {
    return { allowed: false, reason: "after_hours_confirmation_mismatch" };
  }
  if (input.reason !== "self_test") return { allowed: false, reason: "after_hours_reason_invalid" };
  return { allowed: true, reason: "after_hours_self_test" };
}

export function validateBatchMode(input: {
  mode: OutboundBatchMode;
  testMode: boolean;
  confirmation?: string;
}): { allowed: boolean; reason: string } {
  if (input.mode === "dry_run") return { allowed: true, reason: "dry_run" };
  if (input.mode === "test") {
    return input.testMode
      ? { allowed: true, reason: "allowlisted_test_mode" }
      : { allowed: false, reason: "test_mode_disabled" };
  }
  if (input.testMode) return { allowed: false, reason: "real_batch_blocked_in_test_mode" };
  if (input.confirmation !== "START_REAL_OUTBOUND_BATCH") {
    return { allowed: false, reason: "missing_real_batch_confirmation" };
  }
  return { allowed: true, reason: "confirmed_real_batch" };
}
