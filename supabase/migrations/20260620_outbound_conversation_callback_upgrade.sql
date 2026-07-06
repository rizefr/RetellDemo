alter table public.outbound_businesses
  add column if not exists agent_display_name text not null default 'Paul',
  add column if not exists ai_disclosure_policy text not null default 'after_identity',
  add column if not exists test_mode boolean not null default true,
  add column if not exists test_phone_allowlist text[] not null default '{}'::text[],
  add column if not exists max_batch_size integer not null default 1,
  add column if not exists allow_after_hours_test_override boolean not null default false,
  add column if not exists payment_email_enabled boolean not null default false,
  add column if not exists retell_sms_enabled boolean not null default false,
  add column if not exists email_from text,
  add column if not exists email_test_recipient_allowlist text[] not null default '{}'::text[],
  add column if not exists payment_mailing_instructions text,
  add column if not exists callback_rules jsonb not null default '{"weekday_start":"10:00","weekday_end":"16:00","morning_time":"10:00","afternoon_time":"14:00"}'::jsonb;

alter table public.outbound_businesses drop constraint if exists outbound_businesses_ai_disclosure_policy;
alter table public.outbound_businesses add constraint outbound_businesses_ai_disclosure_policy
  check (ai_disclosure_policy in ('after_identity', 'on_request', 'opening'));
alter table public.outbound_businesses drop constraint if exists outbound_businesses_max_batch_size;
alter table public.outbound_businesses add constraint outbound_businesses_max_batch_size
  check (max_batch_size between 1 and 25);

alter table public.outbound_customers
  add column if not exists payment_contact_preference text not null default 'none',
  add column if not exists imported_last_payment_date date;
alter table public.outbound_customers drop constraint if exists outbound_customers_payment_contact_preference;
alter table public.outbound_customers add constraint outbound_customers_payment_contact_preference
  check (payment_contact_preference in ('none', 'sms', 'email', 'mail_check'));

alter table public.outbound_followup_tasks
  add column if not exists callback_timezone text,
  add column if not exists callback_reason text,
  add column if not exists callback_confirmation_text text,
  add column if not exists source_call_attempt_id uuid references public.outbound_call_attempts(id) on delete set null,
  add column if not exists source_retell_call_id text,
  add column if not exists completed_at timestamptz;

alter table public.outbound_followup_tasks drop constraint if exists outbound_followup_tasks_type;
alter table public.outbound_followup_tasks add constraint outbound_followup_tasks_type check (
  task_type in ('call', 'callback', 'email_placeholder', 'final_reminder_placeholder', 'manual_review')
);
alter table public.outbound_followup_tasks drop constraint if exists outbound_followup_tasks_status;
alter table public.outbound_followup_tasks add constraint outbound_followup_tasks_status check (
  status in ('pending', 'in_progress', 'completed', 'cancelled', 'failed')
);

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
    'manual_review', 'unknown'
  )
);

create index if not exists outbound_followups_pending_callback_idx
  on public.outbound_followup_tasks (business_id, scheduled_for)
  where task_type = 'callback' and status = 'pending';
create index if not exists outbound_followups_source_call_attempt_idx
  on public.outbound_followup_tasks (source_call_attempt_id)
  where source_call_attempt_id is not null;

update public.outbound_businesses
set agent_display_name = 'Paul',
    ai_disclosure_policy = case when business_name = 'Elixis Elevator Systems' and is_demo then 'on_request' else ai_disclosure_policy end,
    test_mode = true,
    test_phone_allowlist = case when business_name = 'Elixis Elevator Systems' then array['+13475850249']::text[] else test_phone_allowlist end,
    max_batch_size = 1,
    allow_after_hours_test_override = case when business_name = 'Elixis Elevator Systems' then true else allow_after_hours_test_override end,
    email_from = coalesce(email_from, 'Elixis Elevator Systems <billing@elixis.agency>')
where is_demo;

alter table public.outbound_businesses enable row level security;
alter table public.outbound_customers enable row level security;
alter table public.outbound_followup_tasks enable row level security;
revoke all on public.outbound_businesses from anon, authenticated;
revoke all on public.outbound_customers from anon, authenticated;
revoke all on public.outbound_followup_tasks from anon, authenticated;
