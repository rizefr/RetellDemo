import { parse } from "csv-parse/sync";
import { isValidE164, normalizeOutboundTimezone } from "./outboundEligibility";
import { normalizeOutboundDate } from "./outboundFormatting";

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

export const OUTBOUND_OPTIONAL_CSV_COLUMNS = [
  "last_payment_date",
  "open_invoice_count",
  "total_amount_due",
  "payment_contact_preference",
  "callback_preferred_time",
  "payment_mailing_instructions",
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
  last_payment_date: string | null;
  open_invoice_count_hint: number | null;
  total_amount_due_cents_hint: number | null;
  payment_contact_preference: "none" | "sms" | "email" | "mail_check";
  callback_preferred_time: string;
  payment_mailing_instructions: string;
};

export type OutboundCsvError = { row: number; message: string };

export function dollarsToCents(value: string): number | null {
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
    const originalDueDate = normalizeOutboundDate(record.original_due_date);
    if (!originalDueDate) {
      errors.push({ row: rowNumber, message: "original_due_date must be YYYY-MM-DD or YYYYMMDD" });
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
    const lastPaymentDate = record.last_payment_date ? normalizeOutboundDate(record.last_payment_date) : null;
    if (record.last_payment_date && !lastPaymentDate) {
      errors.push({ row: rowNumber, message: "last_payment_date must be YYYY-MM-DD or YYYYMMDD" });
      return;
    }
    const openInvoiceCount = record.open_invoice_count ? Number(record.open_invoice_count) : null;
    if (openInvoiceCount !== null && (!Number.isInteger(openInvoiceCount) || openInvoiceCount < 0)) {
      errors.push({ row: rowNumber, message: "open_invoice_count must be a non-negative integer" });
      return;
    }
    const totalAmountDue = record.total_amount_due ? dollarsToCents(record.total_amount_due) : null;
    if (record.total_amount_due && (totalAmountDue === null || totalAmountDue < 0)) {
      errors.push({ row: rowNumber, message: "total_amount_due must be a non-negative amount" });
      return;
    }
    const paymentPreference = record.payment_contact_preference || "none";
    if (!["none", "sms", "email", "mail_check"].includes(paymentPreference)) {
      errors.push({ row: rowNumber, message: "payment_contact_preference must be none, sms, email, or mail_check" });
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
      original_due_date: originalDueDate,
      service_description: record.service_description,
      invoice_id: record.invoice_id,
      business_name: record.business_name,
      status: record.status,
      outreach_paused: record.outreach_paused.toLowerCase() === "true",
      notes: record.notes,
      last_payment_date: lastPaymentDate,
      open_invoice_count_hint: openInvoiceCount,
      total_amount_due_cents_hint: totalAmountDue,
      payment_contact_preference: paymentPreference as OutboundCsvRow["payment_contact_preference"],
      callback_preferred_time: record.callback_preferred_time || "",
      payment_mailing_instructions: record.payment_mailing_instructions || "",
    });
  });

  return { rows, errors };
}
