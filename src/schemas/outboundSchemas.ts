import { z } from "zod";
import { OUTBOUND_OUTCOMES } from "../services/outboundOutcomes";

export const uuidSchema = z.string().uuid();
export const outboundInvoiceStatusSchema = z.enum([
  "unpaid",
  "payment_link_sent",
  "paid",
  "disputed",
  "manual_review",
  "cancelled",
]);
export const outboundDemoCallModeSchema = z.enum([
  "first_reminder",
  "follow_up",
  "callback_followup",
  "scam_recovery",
  "service_issue",
]);
export const outboundOutcomeSchema = z.enum(OUTBOUND_OUTCOMES);

export const customerPatchSchema = z
  .object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
    email: z.string().email().or(z.literal("")).optional(),
    mailing_address: z.string().max(500).optional(),
    timezone: z.string().max(100).optional(),
    notes: z.string().max(5000).optional(),
    payment_contact_preference: z.enum(["none", "sms", "email", "mail_check"]).optional(),
    preferred_email: z.string().email().or(z.literal("")).optional(),
    preferred_phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/).or(z.literal("")).optional(),
    contact_update_note: z.string().max(1000).optional(),
  })
  .strict();

export const invoicePatchSchema = z
  .object({
    status: outboundInvoiceStatusSchema.optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();

export const importCsvSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  dry_run: z.boolean().default(true),
});

export const afterHoursOverrideSchema = z
  .object({
    acknowledged: z.literal(true),
    confirmation: z.string().max(100),
    reason: z.literal("self_test"),
  })
  .strict();
export const startCallSchema = z
  .object({
    invoice_id: uuidSchema,
    followup_task_id: uuidSchema.optional(),
    demo_call_authorization_id: uuidSchema.optional(),
    after_hours_override: afterHoursOverrideSchema.optional(),
  })
  .strict();
export const startBatchSchema = z.object({
  mode: z.enum(["dry_run", "test", "real"]).default("dry_run"),
  invoice_ids: z.array(uuidSchema).min(1).max(25),
  confirmation: z.string().optional().default(""),
}).strict();

export const retellToolEnvelopeSchema = z.object({
  name: z.string().optional(),
  call: z.record(z.string(), z.unknown()),
  args: z.record(z.string(), z.unknown()).default({}),
});

const nullableToolString = (schema: z.ZodType<string>) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional().default(""));

export const logOutcomeArgsSchema = z.object({
  outcome: outboundOutcomeSchema,
  notes: nullableToolString(z.string().max(5000)),
  responsible_party_name: nullableToolString(z.string().max(200)),
  responsible_party_phone: nullableToolString(z.string().regex(/^\+[1-9]\d{7,14}$/).or(z.literal(""))),
  responsible_party_email: nullableToolString(z.string().email().or(z.literal(""))),
  named_contact_name: nullableToolString(z.string().max(200)),
});

export const scheduleFollowupArgsSchema = z.object({
  reason: z.string().max(500).optional().default("agent_requested_followup"),
  expected_payment_date_phrase: nullableToolString(z.string().max(100)),
});

export const scheduleCallbackArgsSchema = z.object({
  date_phrase: z.string().min(1).max(100),
  time_phrase: z.string().min(1).max(100),
  reason: z.string().max(500).optional().default("callback_requested"),
  confirmation_text: z.string().max(1000).optional().default(""),
  confirmed: z.boolean(),
});

export const businessSettingsPatchSchema = z
  .object({
    business_name: z.string().min(1).max(200).optional(),
    agent_display_name: z.string().min(1).max(100).optional(),
    ai_disclosure_policy: z.enum(["after_identity", "on_request", "opening"]).optional(),
    default_timezone: z.string().min(1).max(100).optional(),
    callback_number: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional(),
    human_transfer_number: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional(),
    payment_mailing_instructions: z.string().max(2000).nullable().optional(),
    test_mode: z.boolean().optional(),
    test_phone_allowlist: z.array(z.string()).max(25).optional(),
    max_batch_size: z.number().int().min(1).max(25).optional(),
    allow_after_hours_test_override: z.boolean().optional(),
    payment_email_enabled: z.boolean().optional(),
    retell_sms_enabled: z.boolean().optional(),
    email_from: z.string().max(300).nullable().optional(),
    email_test_recipient_allowlist: z.array(z.string().email()).max(25).optional(),
    callback_rules: z.record(z.string(), z.unknown()).optional(),
    product_type: z.enum(["elevator_inspection", "elevator_service"]).optional(),
    default_inspection_type: z.enum(["Category 1", "Category 5", "Acceptance Test", "Periodic Inspection"]).optional(),
    days_after_inspection_first_call: z.number().int().min(0).max(365).optional(),
    very_overdue_threshold_days: z.number().int().min(1).max(365).optional(),
    retell_voice_id: z.string().max(100).nullable().optional(),
    payment_provider: z.enum(["stripe", "quickbooks", "quickbooks_read_only", "quickbooks_payment_link_enabled", "manual"]).optional(),
    production_mode_confirmation: z.string().max(100).optional(),
    batch_limit_confirmation: z.string().max(100).optional(),
  })
  .strict();

export const followupPatchSchema = z
  .object({
    scheduled_for: z.string().datetime().optional(),
    scheduled_for_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
    callback_timezone: z.string().max(100).optional(),
    callback_reason: z.string().max(500).optional(),
    callback_confirmation_text: z.string().max(1000).optional(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled", "failed"]).optional(),
  })
  .strict();

export const businessImportSchema = z.object({
  csv: z.string().min(1).max(500_000),
  dry_run: z.boolean().default(true),
});

export const demoCallAuthorizationSchema = z
  .object({
    business_id: uuidSchema,
    phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/),
    demo_call_mode: outboundDemoCallModeSchema.default("first_reminder"),
    scenario: z.string().max(200).optional(),
    ttl_minutes: z.number().int().min(5).max(480).optional().default(240),
    acknowledged: z.literal(true),
    confirmation: z.string().max(100),
  })
  .strict();

export const demoCallRunSchema = startCallSchema.extend({
  demo_call_authorization_id: uuidSchema,
});

export const demoDetailsPatchSchema = z
  .object({
    business_id: uuidSchema,
    customer_id: uuidSchema,
    invoice_id: uuidSchema,
    first_name: z.string().min(1).max(100).optional(),
    last_name: z.string().min(1).max(100).optional(),
    account_company_name: z.string().max(200).nullable().optional(),
    phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
    email: z.string().email().or(z.literal("")).optional(),
    business_name: z.string().min(1).max(200).optional(),
    service_description: z.string().min(1).max(500).optional(),
    amount_due: z.union([z.string(), z.number()]).optional(),
    original_due_date: z.string().min(8).max(20).optional(),
    external_invoice_id: z.string().min(1).max(100).optional(),
    demo_call_mode: outboundDemoCallModeSchema.optional(),
    previous_call_date: z.string().min(8).max(20).nullable().optional(),
    followup_reason: z.string().max(1000).nullable().optional(),
    prior_concern_note: z.string().max(1000).nullable().optional(),
    preferred_payment_method: z.enum(["none", "sms", "email", "mail_check"]).nullable().optional(),
    callback_details: z.string().max(1000).nullable().optional(),
    preferred_email: z.string().email().or(z.literal("")).optional(),
    preferred_phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/).or(z.literal("")).optional(),
    payment_mailing_instructions: z.string().max(2000).nullable().optional(),
    inspection_type: z.enum(["Category 1", "Category 5", "Acceptance Test", "Periodic Inspection"]).optional(),
    expected_payment_date: z.string().min(8).max(20).nullable().optional(),
  })
  .strict();

export const quickBooksBusinessQuerySchema = z.object({
  business_id: uuidSchema,
});

export const quickBooksInvoiceLinkSchema = z.object({
  business_id: uuidSchema,
  invoice_id: uuidSchema,
});
