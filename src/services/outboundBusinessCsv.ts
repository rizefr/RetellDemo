import { parse } from "csv-parse/sync";
import { DateTime } from "luxon";
import { OUTBOUND_BUSINESS_CSV_COLUMNS } from "./outboundTemplates";
import { isValidE164 } from "./outboundEligibility";

export type OutboundBusinessCsvRow = {
  business_name: string;
  industry: string;
  default_timezone: string;
  callback_number: string | null;
  human_transfer_number: string | null;
  agent_display_name: string;
  product_type: "elevator_inspection" | "elevator_service";
  default_inspection_type: "Category 1" | "Category 5" | "Acceptance Test" | "Periodic Inspection";
  days_after_inspection_first_call: number;
  very_overdue_threshold_days: number;
  ai_disclosure_policy: "after_identity" | "on_request" | "opening";
  payment_provider: "stripe" | "quickbooks" | "quickbooks_read_only" | "quickbooks_payment_link_enabled" | "manual";
  payment_mailing_instructions: string | null;
  email_from: string | null;
  retell_sms_enabled: boolean;
  payment_email_enabled: boolean;
};

export function parseOutboundBusinessCsv(input: string): {
  rows: OutboundBusinessCsvRow[];
  errors: Array<{ row: number; message: string }>;
} {
  let records: Record<string, string>[];
  try {
    records = parse(input, { columns: true, skip_empty_lines: true, trim: true });
  } catch (error) {
    return { rows: [], errors: [{ row: 1, message: error instanceof Error ? error.message : "Invalid CSV" }] };
  }
  const rows: OutboundBusinessCsvRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  records.forEach((record, index) => {
    const row = index + 2;
    const missing = OUTBOUND_BUSINESS_CSV_COLUMNS.find((column) => !(column in record));
    if (missing) return void errors.push({ row, message: `Missing required column: ${missing}` });
    if (!record.business_name) return void errors.push({ row, message: "business_name is required" });
    if (!DateTime.local().setZone(record.default_timezone).isValid) {
      return void errors.push({ row, message: "default_timezone must be a valid IANA timezone" });
    }
    if (record.business_callback_number && !isValidE164(record.business_callback_number)) {
      return void errors.push({ row, message: "business_callback_number must use E.164 format" });
    }
    if (record.human_transfer_number && !isValidE164(record.human_transfer_number)) {
      return void errors.push({ row, message: "human_transfer_number must use E.164 format" });
    }
    if (!["after_identity", "on_request", "opening"].includes(record.ai_disclosure_policy)) {
      return void errors.push({ row, message: "ai_disclosure_policy is invalid" });
    }
    if (!["elevator_inspection", "elevator_service"].includes(record.product_type || "elevator_inspection")) {
      return void errors.push({ row, message: "product_type is invalid" });
    }
    if (
      !["Category 1", "Category 5", "Acceptance Test", "Periodic Inspection"].includes(
        record.default_inspection_type || "Category 1",
      )
    ) {
      return void errors.push({ row, message: "default_inspection_type is invalid" });
    }
    const daysAfterInspection = Number(record.days_after_inspection_first_call || 14);
    const veryOverdueThreshold = Number(record.very_overdue_threshold_days || 45);
    if (!Number.isInteger(daysAfterInspection) || daysAfterInspection < 0 || daysAfterInspection > 365) {
      return void errors.push({ row, message: "days_after_inspection_first_call must be 0 through 365" });
    }
    if (!Number.isInteger(veryOverdueThreshold) || veryOverdueThreshold < 1 || veryOverdueThreshold > 365) {
      return void errors.push({ row, message: "very_overdue_threshold_days must be 1 through 365" });
    }
    if (
      !["stripe", "quickbooks", "quickbooks_read_only", "quickbooks_payment_link_enabled", "manual"].includes(
        record.payment_provider || "stripe",
      )
    ) {
      return void errors.push({ row, message: "payment_provider is invalid" });
    }
    if (!["true", "false"].includes(record.sms_enabled) || !["true", "false"].includes(record.email_enabled)) {
      return void errors.push({ row, message: "sms_enabled and email_enabled must be true or false" });
    }
    rows.push({
      business_name: record.business_name,
      industry: record.industry || "elevator_inspection",
      default_timezone: record.default_timezone,
      callback_number: record.business_callback_number || null,
      human_transfer_number: record.human_transfer_number || null,
      agent_display_name: record.agent_display_name || "Sophia",
      product_type: (record.product_type || "elevator_inspection") as OutboundBusinessCsvRow["product_type"],
      default_inspection_type: (record.default_inspection_type || "Category 1") as OutboundBusinessCsvRow["default_inspection_type"],
      days_after_inspection_first_call: daysAfterInspection,
      very_overdue_threshold_days: veryOverdueThreshold,
      ai_disclosure_policy: record.ai_disclosure_policy as OutboundBusinessCsvRow["ai_disclosure_policy"],
      payment_provider: (record.payment_provider || "stripe") as OutboundBusinessCsvRow["payment_provider"],
      payment_mailing_instructions: record.payment_mailing_instructions || null,
      email_from: record.email_from || null,
      retell_sms_enabled: record.sms_enabled === "true",
      payment_email_enabled: record.email_enabled === "true",
    });
  });
  return { rows, errors };
}
