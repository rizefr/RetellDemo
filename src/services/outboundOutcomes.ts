export const OUTBOUND_OUTCOMES = [
  "confirmed_payment_link_requested",
  "no_answer",
  "voicemail_detected_no_message",
  "already_paid_claim",
  "wrong_number",
  "unable_to_pay",
  "callback_requested",
  "callback_scheduled",
  "service_issue_reported",
  "mail_check_requested",
  "mail_instructions_requested",
  "do_not_contact",
  "proof_requested",
  "dispute",
  "attorney_represented",
  "scam_concern",
  "human_requested",
  "human_transferred",
  "payment_link_issue",
  "sms_failed",
  "sms_pending_manual",
  "email_requested",
  "email_sent",
  "email_pending_manual",
  "email_failed",
  "email_missing",
  "contact_update_requested",
  "manual_review",
  "unknown",
] as const;

export type OutboundOutcome = (typeof OUTBOUND_OUTCOMES)[number];
export type OutcomePolicy = {
  pauseOutreach: boolean;
  invoiceStatus?: "payment_link_sent" | "disputed" | "manual_review";
  scheduleFollowups: boolean;
};

export function isOutboundOutcome(value: string): value is OutboundOutcome {
  return (OUTBOUND_OUTCOMES as readonly string[]).includes(value);
}

export function applyOutcomePolicy(outcome: OutboundOutcome): OutcomePolicy {
  if (["wrong_number", "do_not_contact", "attorney_represented"].includes(outcome)) {
    return { pauseOutreach: true, invoiceStatus: "manual_review", scheduleFollowups: false };
  }
  if (outcome === "dispute") {
    return { pauseOutreach: true, invoiceStatus: "disputed", scheduleFollowups: false };
  }
  if (outcome === "service_issue_reported") {
    return { pauseOutreach: true, invoiceStatus: "manual_review", scheduleFollowups: false };
  }
  if (outcome === "callback_scheduled") {
    return { pauseOutreach: false, scheduleFollowups: false };
  }
  if (["mail_check_requested", "mail_instructions_requested"].includes(outcome)) {
    return { pauseOutreach: false, invoiceStatus: "manual_review", scheduleFollowups: false };
  }
  if (outcome === "contact_update_requested") {
    return { pauseOutreach: false, scheduleFollowups: false };
  }
  if (outcome === "confirmed_payment_link_requested") {
    return { pauseOutreach: false, invoiceStatus: "payment_link_sent", scheduleFollowups: true };
  }
  if (["no_answer", "voicemail_detected_no_message", "callback_requested"].includes(outcome)) {
    return { pauseOutreach: false, scheduleFollowups: true };
  }
  return { pauseOutreach: false, invoiceStatus: "manual_review", scheduleFollowups: false };
}
