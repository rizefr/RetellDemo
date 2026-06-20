import { OUTBOUND_CSV_COLUMNS, OUTBOUND_OPTIONAL_CSV_COLUMNS } from "./outboundCsv";

function stringify(rows: Array<Array<string>>): string {
  const encode = (value: string) => /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return `${rows.map((row) => row.map(encode).join(",")).join("\n")}\n`;
}

export const OUTBOUND_BUSINESS_CSV_COLUMNS = [
  "business_name",
  "industry",
  "default_timezone",
  "business_callback_number",
  "human_transfer_number",
  "agent_display_name",
  "ai_disclosure_policy",
  "payment_mailing_instructions",
  "email_from",
  "sms_enabled",
  "email_enabled",
] as const;

export function customerCsvTemplate(): string {
  return stringify(
    [
      [...OUTBOUND_CSV_COLUMNS, ...OUTBOUND_OPTIONAL_CSV_COLUMNS],
      [
        "REPLACE-WITH-YOUR-ID",
        "Test",
        "Customer",
        "+13475850249",
        "test@example.test",
        "100 Demo Plaza",
        "America/New_York",
        "150.00",
        "2026-05-20",
        "annual elevator inspection",
        "ELV-TEST-OWN-NUMBER",
        "Elixis Elevator Systems",
        "unpaid",
        "false",
        "Replace the phone and email with user-controlled test destinations.",
        "",
        "1",
        "150.00",
        "email",
        "",
        "",
      ],
    ],
  );
}

export function businessCsvTemplate(): string {
  return stringify([
    [...OUTBOUND_BUSINESS_CSV_COLUMNS],
    [
      "Elixis Elevator Systems",
      "elevator_inspection",
      "America/New_York",
      "+19842075346",
      "",
      "Paul",
      "after_identity",
      "",
      "Elixis Elevator Systems <billing@elixis.agency>",
      "false",
      "false",
    ],
  ]);
}
