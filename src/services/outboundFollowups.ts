import { DateTime } from "luxon";
import { normalizeOutboundTimezone } from "./outboundEligibility";

export type OutboundFollowupSeed = {
  task_type: "call" | "email_placeholder" | "final_reminder_placeholder" | "manual_review";
  scheduled_for: string;
  status: "pending";
  attempt_number: number;
  reason: string;
};

export function nextEligibleOutboundTime(baseIso: string, daysAfter: number, timezone?: string | null): string {
  const zone = normalizeOutboundTimezone(timezone);
  let local = DateTime.fromISO(baseIso, { setZone: true }).setZone(zone).plus({ days: daysAfter }).startOf("day");
  while (local.weekday > 5) {
    local = local.plus({ days: 1 });
  }
  return local.set({ hour: 10 }).toUTC().toISO() as string;
}

export function buildBaselineFollowups(
  baseIso: string,
  timezone?: string | null,
  currentAttempt = 1,
): OutboundFollowupSeed[] {
  return [
    {
      task_type: "call",
      scheduled_for: nextEligibleOutboundTime(baseIso, 2, timezone),
      status: "pending",
      attempt_number: currentAttempt + 1,
      reason: "day_2_second_call",
    },
    {
      task_type: "email_placeholder",
      scheduled_for: nextEligibleOutboundTime(baseIso, 2, timezone),
      status: "pending",
      attempt_number: currentAttempt + 1,
      reason: "day_2_email_placeholder",
    },
    {
      task_type: "final_reminder_placeholder",
      scheduled_for: nextEligibleOutboundTime(baseIso, 7, timezone),
      status: "pending",
      attempt_number: currentAttempt + 2,
      reason: "day_7_final_reminder",
    },
    {
      task_type: "manual_review",
      scheduled_for: nextEligibleOutboundTime(baseIso, 14, timezone),
      status: "pending",
      attempt_number: currentAttempt + 3,
      reason: "day_14_escalation_or_mailing_review",
    },
  ];
}
