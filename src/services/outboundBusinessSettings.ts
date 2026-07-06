export const PRODUCTION_MODE_CONFIRMATION = "ENABLE PRODUCTION OUTBOUND MODE";
export const BATCH_LIMIT_CONFIRMATION = "INCREASE OUTBOUND BATCH LIMIT";

export type OutboundBusinessSettingsPatch = {
  business_name?: string;
  agent_display_name?: string;
  ai_disclosure_policy?: "after_identity" | "on_request" | "opening";
  default_timezone?: string;
  callback_number?: string | null;
  human_transfer_number?: string | null;
  payment_mailing_instructions?: string | null;
  test_mode?: boolean;
  test_phone_allowlist?: string[];
  max_batch_size?: number;
  allow_after_hours_test_override?: boolean;
  payment_email_enabled?: boolean;
  retell_sms_enabled?: boolean;
  email_from?: string | null;
  email_test_recipient_allowlist?: string[];
  callback_rules?: Record<string, unknown>;
  product_type?: "elevator_inspection" | "elevator_service";
  default_inspection_type?: "Category 1" | "Category 5" | "Acceptance Test" | "Periodic Inspection";
  days_after_inspection_first_call?: number;
  very_overdue_threshold_days?: number;
  retell_voice_id?: string | null;
  payment_provider?: "stripe" | "quickbooks" | "quickbooks_read_only" | "quickbooks_payment_link_enabled" | "manual";
};

function e164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export function validateOutboundBusinessSettingsPatch(
  patch: OutboundBusinessSettingsPatch,
  confirmations: { production_mode_confirmation?: string; batch_limit_confirmation?: string },
): OutboundBusinessSettingsPatch {
  if (patch.test_mode === false && confirmations.production_mode_confirmation !== PRODUCTION_MODE_CONFIRMATION) {
    throw new Error(`Type ${PRODUCTION_MODE_CONFIRMATION} to disable test mode.`);
  }
  if (
    patch.max_batch_size !== undefined &&
    (patch.max_batch_size < 1 || patch.max_batch_size > 25 || !Number.isInteger(patch.max_batch_size))
  ) {
    throw new Error("Maximum batch size must be an integer from 1 through 25.");
  }
  if (patch.max_batch_size !== undefined && patch.max_batch_size > 1 && confirmations.batch_limit_confirmation !== BATCH_LIMIT_CONFIRMATION) {
    throw new Error(`Type ${BATCH_LIMIT_CONFIRMATION} to increase the batch limit.`);
  }
  if (patch.test_phone_allowlist?.some((phone) => !e164(phone))) {
    throw new Error("Every test allowlist phone number must use E.164 format.");
  }
  if (
    patch.days_after_inspection_first_call !== undefined &&
    (!Number.isInteger(patch.days_after_inspection_first_call) ||
      patch.days_after_inspection_first_call < 0 ||
      patch.days_after_inspection_first_call > 365)
  ) {
    throw new Error("Days after inspection before first call must be an integer from 0 through 365.");
  }
  if (
    patch.very_overdue_threshold_days !== undefined &&
    (!Number.isInteger(patch.very_overdue_threshold_days) ||
      patch.very_overdue_threshold_days < 1 ||
      patch.very_overdue_threshold_days > 365)
  ) {
    throw new Error("Very-overdue threshold must be an integer from 1 through 365.");
  }
  if (patch.callback_number && !e164(patch.callback_number)) throw new Error("Callback number must use E.164 format.");
  if (patch.human_transfer_number && !e164(patch.human_transfer_number)) {
    throw new Error("Human transfer number must use E.164 format.");
  }
  return patch;
}
