alter table public.outbound_customers
  add column if not exists responsible_party_name text,
  add column if not exists responsible_party_phone text,
  add column if not exists responsible_party_email text,
  add column if not exists responsible_party_note text,
  add column if not exists named_contact_requested text;

alter table public.outbound_customers drop constraint if exists outbound_customers_responsible_party_phone_e164;
alter table public.outbound_customers add constraint outbound_customers_responsible_party_phone_e164
  check (responsible_party_phone is null or responsible_party_phone ~ '^\+[1-9][0-9]{7,14}$');

alter table public.outbound_customers drop constraint if exists outbound_customers_responsible_party_email_format;
alter table public.outbound_customers add constraint outbound_customers_responsible_party_email_format
  check (responsible_party_email is null or responsible_party_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

alter table public.outbound_call_attempts drop constraint if exists outbound_call_attempts_outcome;
alter table public.outbound_call_attempts add constraint outbound_call_attempts_outcome check (
  outcome is null or outcome in (
    'confirmed_payment_link_requested', 'no_answer', 'voicemail_detected_no_message',
    'already_paid_claim', 'wrong_number', 'unable_to_pay', 'callback_requested',
    'callback_scheduled', 'service_issue_reported', 'mail_check_requested',
    'mail_instructions_requested', 'do_not_contact', 'proof_requested', 'dispute',
    'attorney_represented', 'scam_concern', 'human_requested', 'human_transferred',
    'payment_link_issue', 'sms_failed', 'sms_pending_manual', 'email_requested',
    'email_sent', 'email_pending_manual', 'email_failed', 'email_missing',
    'contact_update_requested', 'responsible_party_update_requested',
    'named_contact_requested', 'manual_review', 'unknown'
  )
);

create index if not exists outbound_customers_responsible_party_idx
  on public.outbound_customers (business_id, responsible_party_email, responsible_party_phone)
  where responsible_party_email is not null or responsible_party_phone is not null;

alter table public.outbound_customers enable row level security;
alter table public.outbound_call_attempts enable row level security;
revoke all on public.outbound_customers from anon, authenticated;
revoke all on public.outbound_call_attempts from anon, authenticated;
