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

export const logOutcomeArgsSchema = z.object({
  outcome: outboundOutcomeSchema,
  notes: z.string().max(5000).optional().default(""),
});

export const scheduleFollowupArgsSchema = z.object({
  reason: z.string().max(500).optional().default("agent_requested_followup"),
});
