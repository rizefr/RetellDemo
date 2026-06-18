import { parse } from "csv-parse/sync";
import { DateTime } from "luxon";
import { isValidE164, normalizeOutboundTimezone } from "./outboundEligibility";

export const OUTBOUND_CSV_COLUMNS = [
  "customer_id",
  "first_name",
  "last_name",
  "phone_number",
  "email",
  "mailing_address",
  "timezone",
  "amount_due",
  "original_due_date",
  "service_description",
  "invoice_id",
  "business_name",
  "status",
  "outreach_paused",
  "notes",
] as const;

const IMPORTABLE_STATUSES = new Set([
  "unpaid",
  "payment_link_sent",
  "paid",
  "disputed",
  "manual_review",
  "cancelled",
]);

export type OutboundCsvRow = {
  external_customer_id: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
  mailing_address: string;
  timezone: string;
  amount_due_cents: number;
  original_due_date: string;
  service_description: string;
  invoice_id: string;
  business_name: string;
  status: string;
  outreach_paused: boolean;
  notes: string;
};

export type OutboundCsvError = { row: number; message: string };

function dollarsToCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [dollars, cents = ""] = value.trim().split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}

export function parseOutboundCsv(input: string): { rows: OutboundCsvRow[]; errors: OutboundCsvError[] } {
  let records: Record<string, string>[];
  try {
    records = parse(input, { columns: true, skip_empty_lines: true, trim: true });
  } catch (error) {
    return { rows: [], errors: [{ row: 1, message: error instanceof Error ? error.message : "Invalid CSV" }] };
  }

  const rows: OutboundCsvRow[] = [];
  const errors: OutboundCsvError[] = [];
  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const missingColumn = OUTBOUND_CSV_COLUMNS.find((column) => !(column in record));
    if (missingColumn) {
      errors.push({ row: rowNumber, message: `Missing required column: ${missingColumn}` });
      return;
    }
    if (!record.customer_id || !record.invoice_id || !record.business_name) {
      errors.push({ row: rowNumber, message: "customer_id, invoice_id, and business_name are required" });
      return;
    }
    if (!isValidE164(record.phone_number)) {
      errors.push({ row: rowNumber, message: "phone_number must use E.164 format" });
      return;
    }
    const amount = dollarsToCents(record.amount_due);
    if (amount === null || amount <= 0) {
      errors.push({ row: rowNumber, message: "amount_due must be a positive amount with at most two decimals" });
      return;
    }
    if (!DateTime.fromISO(record.original_due_date).isValid) {
      errors.push({ row: rowNumber, message: "original_due_date must be an ISO date" });
      return;
    }
    if (!IMPORTABLE_STATUSES.has(record.status)) {
      errors.push({ row: rowNumber, message: `Unsupported invoice status: ${record.status}` });
      return;
    }
    if (!["true", "false"].includes(record.outreach_paused.toLowerCase())) {
      errors.push({ row: rowNumber, message: "outreach_paused must be true or false" });
      return;
    }

    rows.push({
      external_customer_id: record.customer_id,
      first_name: record.first_name,
      last_name: record.last_name,
      phone_number: record.phone_number,
      email: record.email,
      mailing_address: record.mailing_address,
      timezone: normalizeOutboundTimezone(record.timezone),
      amount_due_cents: amount,
      original_due_date: record.original_due_date,
      service_description: record.service_description,
      invoice_id: record.invoice_id,
      business_name: record.business_name,
      status: record.status,
      outreach_paused: record.outreach_paused.toLowerCase() === "true",
      notes: record.notes,
    });
  });

  return { rows, errors };
}
