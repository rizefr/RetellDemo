alter table public.outbound_call_attempts
  drop constraint if exists outbound_call_attempts_outcome;

alter table public.outbound_call_attempts
  add constraint outbound_call_attempts_outcome check (
    outcome is null or outcome in (
      'confirmed_payment_link_requested',
      'no_answer',
      'voicemail_detected_no_message',
      'already_paid_claim',
      'wrong_number',
      'unable_to_pay',
      'callback_requested',
      'do_not_contact',
      'proof_requested',
      'dispute',
      'attorney_represented',
      'scam_concern',
      'human_requested',
      'human_transferred',
      'payment_link_issue',
      'sms_failed',
      'sms_pending_manual',
      'email_requested',
      'email_sent',
      'email_pending_manual',
      'email_failed',
      'email_missing',
      'manual_review',
      'unknown'
    )
  );

alter table public.outbound_call_attempts enable row level security;
revoke all on public.outbound_call_attempts from anon, authenticated;
