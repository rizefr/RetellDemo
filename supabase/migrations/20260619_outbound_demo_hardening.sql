alter table public.outbound_call_attempts
  add column if not exists duration_ms integer,
  add column if not exists analysis jsonb not null default '{}'::jsonb;

alter table public.outbound_call_attempts
  drop constraint if exists outbound_call_attempts_duration_nonnegative;
alter table public.outbound_call_attempts
  add constraint outbound_call_attempts_duration_nonnegative
  check (duration_ms is null or duration_ms >= 0);

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

alter table public.outbound_payment_links
  drop constraint if exists outbound_payment_links_sent_via;
alter table public.outbound_payment_links
  add constraint outbound_payment_links_sent_via check (
    sent_via is null or sent_via in ('admin', 'sms', 'email', 'email_placeholder', 'manual')
  );

create index if not exists outbound_call_attempts_status_created_idx
  on public.outbound_call_attempts (status, created_at desc);

alter table public.outbound_call_attempts enable row level security;
revoke all on public.outbound_call_attempts from anon, authenticated;
