import { z } from "zod";

export const urgencyLevelSchema = z.enum(["low", "medium", "high", "emergency"]);
export const preferredBookingMethodSchema = z.enum([
  "sms_link",
  "phone_booking",
  "transfer",
  "callback",
  "unknown",
]);

export const createLeadSchema = z.object({
  caller_name: z.string().trim().min(1).default("Unknown caller"),
  caller_phone: z.string().trim().min(7),
  alternate_phone: z.string().trim().nullable().default(null),
  pest_issue: z.string().trim().min(1).default("unspecified pest issue"),
  urgency_level: urgencyLevelSchema.default("low"),
  preferred_booking_method: preferredBookingMethodSchema.default("unknown"),
  service_area: z.string().trim().nullable().default(null),
  zip_code: z.string().trim().nullable().default(null),
  property_address: z.string().trim().nullable().default(null),
  property_street: z.string().trim().nullable().default(null),
  property_city: z.string().trim().nullable().default(null),
  property_state: z.string().trim().nullable().default(null),
  property_zip: z.string().trim().nullable().default(null),
  preferred_datetime: z.string().trim().nullable().default(null),
  call_summary: z.string().trim().default("Pest-control service inquiry."),
  retell_call_id: z.string().trim().nullable().default(null),
  source: z.string().trim().default("retell_voice_agent"),
});

export const sendBookingSmsSchema = z.object({
  caller_name: z.string().trim().min(1).default("there"),
  caller_phone: z.string().trim().min(7),
  pest_issue: z.string().trim().min(1).default("pest-control service"),
  booking_url: z.string().trim().optional().default(""),
  business_name: z.string().trim().optional().default(""),
  lead_id: z.string().uuid().nullable().optional(),
  retell_call_id: z.string().trim().nullable().optional(),
});

export const checkServiceAreaSchema = z.object({
  zip_code: z.string().trim().nullable().default(null),
  city: z.string().trim().nullable().default(null),
  state: z.string().trim().nullable().default(null),
  address: z.string().trim().nullable().default(null),
  property_address: z.string().trim().nullable().default(null),
  property_street: z.string().trim().nullable().default(null),
  property_city: z.string().trim().nullable().default(null),
  property_state: z.string().trim().nullable().default(null),
  property_zip: z.string().trim().nullable().default(null),
});

export const transferCallSchema = z.object({
  reason: z.string().trim().min(1),
  caller_name: z.string().trim().nullable().default(null),
  caller_phone: z.string().trim().nullable().default(null),
  pest_issue: z.string().trim().nullable().default(null),
  urgency_level: z.enum(["medium", "high", "emergency"]).default("high"),
  retell_call_id: z.string().trim().nullable().optional(),
});

export const checkAvailabilitySchema = z.object({
  preferred_date: z.string().trim().min(1),
  preferred_time: z.string().trim().min(1),
  timezone: z.string().trim().default("America/New_York"),
  appointment_type: z.string().trim().default("pest_control_service"),
  pest_issue: z.string().trim().min(1).default("pest-control service"),
});

export const bookAppointmentSchema = z.object({
  caller_name: z.string().trim().min(1),
  caller_phone: z.string().trim().min(7),
  alternate_phone: z.string().trim().nullable().optional(),
  email: z.union([z.literal(""), z.string().email()]).optional().default(""),
  pest_issue: z.string().trim().min(1),
  selected_datetime: z.string().trim().min(1),
  timezone: z.string().trim().default("America/New_York"),
  notes: z.string().trim().default(""),
  property_address: z.string().trim().nullable().optional(),
  property_street: z.string().trim().nullable().optional(),
  property_city: z.string().trim().nullable().optional(),
  property_state: z.string().trim().nullable().optional(),
  property_zip: z.string().trim().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
  dry_run: z.boolean().optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type SendBookingSmsInput = z.infer<typeof sendBookingSmsSchema>;
export type CheckServiceAreaInput = z.infer<typeof checkServiceAreaSchema>;
export type TransferCallInput = z.infer<typeof transferCallSchema>;
export type CheckAvailabilityInput = z.infer<typeof checkAvailabilitySchema>;
export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;
