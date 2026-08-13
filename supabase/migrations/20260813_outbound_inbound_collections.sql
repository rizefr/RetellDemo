alter table public.outbound_businesses
  add column if not exists inbound_retell_agent_id text,
  add column if not exists inbound_retell_conversation_flow_id text;

alter table public.outbound_call_attempts
  drop constraint if exists outbound_call_attempts_direction;
alter table public.outbound_call_attempts
  add constraint outbound_call_attempts_direction
  check (direction in ('outbound', 'inbound'));

alter table public.outbound_call_attempts
  drop constraint if exists outbound_call_attempts_outcome;
alter table public.outbound_call_attempts
  add constraint outbound_call_attempts_outcome check (
    outcome is null or outcome in (
      'confirmed_payment_link_requested', 'no_answer', 'voicemail_detected_no_message',
      'voicemail_message_left', 'already_paid_claim', 'wrong_number', 'unable_to_pay',
      'callback_requested', 'callback_scheduled', 'service_issue_reported',
      'mail_check_requested', 'mail_instructions_requested', 'do_not_contact',
      'proof_requested', 'dispute', 'attorney_represented', 'scam_concern',
      'human_requested', 'human_transferred', 'payment_link_issue', 'sms_failed',
      'sms_pending_manual', 'email_requested', 'email_sent', 'email_pending_manual',
      'email_failed', 'email_missing', 'contact_update_requested',
      'responsible_party_update_requested', 'named_contact_requested',
      'manual_review', 'unknown'
    )
  );

create index if not exists outbound_customers_business_name_lookup_idx
  on public.outbound_customers (business_id, lower(first_name), lower(last_name));
create index if not exists outbound_customers_business_phone_lookup_idx
  on public.outbound_customers (business_id, phone_number);
create index if not exists outbound_businesses_callback_number_idx
  on public.outbound_businesses (callback_number)
  where callback_number is not null;

alter table public.outbound_businesses enable row level security;
alter table public.outbound_customers enable row level security;
alter table public.outbound_invoices enable row level security;
alter table public.outbound_call_attempts enable row level security;
alter table public.outbound_events enable row level security;
alter table public.outbound_followup_tasks enable row level security;

revoke all on public.outbound_businesses from anon, authenticated;
revoke all on public.outbound_customers from anon, authenticated;
revoke all on public.outbound_invoices from anon, authenticated;
revoke all on public.outbound_call_attempts from anon, authenticated;
revoke all on public.outbound_events from anon, authenticated;
revoke all on public.outbound_followup_tasks from anon, authenticated;

