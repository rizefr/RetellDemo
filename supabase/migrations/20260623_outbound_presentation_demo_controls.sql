alter table public.outbound_businesses
  add column if not exists payment_provider text not null default 'stripe',
  add column if not exists quickbooks_realm_id text,
  add column if not exists quickbooks_environment text not null default 'sandbox',
  add column if not exists quickbooks_connected boolean not null default false,
  add column if not exists quickbooks_access_token_present boolean not null default false,
  add column if not exists quickbooks_refresh_token_present boolean not null default false,
  add column if not exists quickbooks_connected_at timestamptz,
  add column if not exists quickbooks_disconnected_at timestamptz;

alter table public.outbound_businesses drop constraint if exists outbound_businesses_payment_provider;
alter table public.outbound_businesses add constraint outbound_businesses_payment_provider
  check (payment_provider in ('stripe', 'quickbooks', 'manual'));
alter table public.outbound_businesses drop constraint if exists outbound_businesses_quickbooks_environment;
alter table public.outbound_businesses add constraint outbound_businesses_quickbooks_environment
  check (quickbooks_environment in ('sandbox', 'production'));

alter table public.outbound_customers
  add column if not exists preferred_email text,
  add column if not exists preferred_phone_number text,
  add column if not exists contact_update_note text,
  add column if not exists outreach_status text not null default 'active';

alter table public.outbound_customers drop constraint if exists outbound_customers_outreach_status;
alter table public.outbound_customers add constraint outbound_customers_outreach_status
  check (outreach_status in ('active', 'callback_scheduled', 'do_not_contact', 'manual_review'));
alter table public.outbound_customers drop constraint if exists outbound_customers_preferred_phone_e164;
alter table public.outbound_customers add constraint outbound_customers_preferred_phone_e164
  check (preferred_phone_number is null or preferred_phone_number ~ '^\+[1-9][0-9]{7,14}$');

alter table public.outbound_invoices
  add column if not exists demo_call_mode text not null default 'first_reminder',
  add column if not exists previous_call_date date,
  add column if not exists followup_reason text,
  add column if not exists prior_concern_note text,
  add column if not exists preferred_payment_method text,
  add column if not exists callback_details text;

alter table public.outbound_invoices drop constraint if exists outbound_invoices_demo_call_mode;
alter table public.outbound_invoices add constraint outbound_invoices_demo_call_mode
  check (demo_call_mode in ('first_reminder', 'follow_up', 'callback_followup', 'scam_recovery', 'service_issue'));
alter table public.outbound_invoices drop constraint if exists outbound_invoices_preferred_payment_method;
alter table public.outbound_invoices add constraint outbound_invoices_preferred_payment_method
  check (preferred_payment_method is null or preferred_payment_method in ('none', 'sms', 'email', 'mail_check'));

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
    'contact_update_requested', 'manual_review', 'unknown'
  )
);

create table if not exists public.outbound_demo_call_authorizations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.outbound_businesses(id) on delete cascade,
  phone_number text not null,
  demo_call_mode text not null default 'first_reminder',
  scenario text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  uses_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by text not null default 'admin',
  constraint outbound_demo_call_authorizations_phone_e164 check (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  constraint outbound_demo_call_authorizations_mode check (
    demo_call_mode in ('first_reminder', 'follow_up', 'callback_followup', 'scam_recovery', 'service_issue')
  ),
  constraint outbound_demo_call_authorizations_uses_nonnegative check (uses_count >= 0)
);

create index if not exists outbound_demo_call_auth_active_idx
  on public.outbound_demo_call_authorizations (business_id, phone_number, expires_at)
  where revoked_at is null;

alter table public.outbound_demo_call_authorizations enable row level security;
revoke all on public.outbound_demo_call_authorizations from anon, authenticated;
revoke all on public.outbound_businesses from anon, authenticated;
revoke all on public.outbound_customers from anon, authenticated;
revoke all on public.outbound_invoices from anon, authenticated;
revoke all on public.outbound_call_attempts from anon, authenticated;
revoke all on public.outbound_payment_links from anon, authenticated;
revoke all on public.outbound_events from anon, authenticated;
revoke all on public.outbound_followup_tasks from anon, authenticated;
