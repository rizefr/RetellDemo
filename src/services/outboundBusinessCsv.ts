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
  ai_disclosure_policy: "after_identity" | "on_request" | "opening";
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
    if (!["true", "false"].includes(record.sms_enabled) || !["true", "false"].includes(record.email_enabled)) {
      return void errors.push({ row, message: "sms_enabled and email_enabled must be true or false" });
    }
    rows.push({
      business_name: record.business_name,
      industry: record.industry || "elevator_inspection",
      default_timezone: record.default_timezone,
      callback_number: record.business_callback_number || null,
      human_transfer_number: record.human_transfer_number || null,
      agent_display_name: record.agent_display_name || "Paul",
      ai_disclosure_policy: record.ai_disclosure_policy as OutboundBusinessCsvRow["ai_disclosure_policy"],
      payment_mailing_instructions: record.payment_mailing_instructions || null,
      email_from: record.email_from || null,
      retell_sms_enabled: record.sms_enabled === "true",
      payment_email_enabled: record.email_enabled === "true",
    });
  });
  return { rows, errors };
}
