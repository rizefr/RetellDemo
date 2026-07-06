create extension if not exists pgcrypto;

create or replace function public.outbound_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.outbound_businesses (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  industry text not null default 'elevator_inspection',
  callback_number text,
  human_transfer_number text,
  default_timezone text not null default 'America/New_York',
  is_demo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_businesses_name_not_blank check (length(trim(business_name)) > 0)
);

create unique index if not exists outbound_businesses_name_unique
  on public.outbound_businesses (lower(business_name));

create table if not exists public.outbound_customers (
  id uuid primary key default gen_random_uuid(),
  external_customer_id text not null,
  first_name text not null default '',
  last_name text not null default '',
  phone_number text not null,
  email text,
  mailing_address text,
  timezone text not null default 'America/New_York',
  business_id uuid not null references public.outbound_businesses(id) on delete restrict,
  outreach_paused boolean not null default false,
  pause_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_customers_external_id_not_blank check (length(trim(external_customer_id)) > 0),
  constraint outbound_customers_e164 check (phone_number ~ '^\+[1-9][0-9]{7,14}$')
);

create unique index if not exists outbound_customers_business_external_unique
  on public.outbound_customers (business_id, external_customer_id);
create index if not exists outbound_customers_business_idx
  on public.outbound_customers (business_id);
create index if not exists outbound_customers_paused_idx
  on public.outbound_customers (outreach_paused);

create table if not exists public.outbound_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.outbound_customers(id) on delete restrict,
  business_id uuid not null references public.outbound_businesses(id) on delete restrict,
  invoice_id text not null,
  amount_due_cents integer not null,
  currency text not null default 'usd',
  original_due_date date not null,
  service_description text not null,
  status text not null default 'unpaid',
  notes text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_invoices_amount_positive check (amount_due_cents > 0),
  constraint outbound_invoices_currency check (currency ~ '^[a-z]{3}$'),
  constraint outbound_invoices_status check (
    status in ('unpaid', 'payment_link_sent', 'paid', 'disputed', 'manual_review', 'cancelled')
  )
);

create unique index if not exists outbound_invoices_business_invoice_unique
  on public.outbound_invoices (business_id, invoice_id);
create index if not exists outbound_invoices_customer_idx
  on public.outbound_invoices (customer_id);
create index if not exists outbound_invoices_business_status_idx
  on public.outbound_invoices (business_id, status);

create table if not exists public.outbound_call_attempts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.outbound_customers(id) on delete restrict,
  invoice_id uuid not null references public.outbound_invoices(id) on delete restrict,
  business_id uuid not null references public.outbound_businesses(id) on delete restrict,
  retell_call_id text,
  attempt_number integer not null default 1,
  direction text not null default 'outbound',
  from_number text not null,
  to_number text not null,
  status text not null default 'starting',
  outcome text,
  transcript text,
  recording_url text,
  summary text,
  notes text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint outbound_call_attempts_attempt_positive check (attempt_number > 0),
  constraint outbound_call_attempts_direction check (direction = 'outbound'),
  constraint outbound_call_attempts_outcome check (
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
      'manual_review',
      'unknown'
    )
  )
);

create unique index if not exists outbound_call_attempts_retell_call_unique
  on public.outbound_call_attempts (retell_call_id)
  where retell_call_id is not null;
create unique index if not exists outbound_call_attempts_active_invoice_unique
  on public.outbound_call_attempts (invoice_id)
  where status in ('starting', 'registered', 'ongoing');
create index if not exists outbound_call_attempts_invoice_created_idx
  on public.outbound_call_attempts (invoice_id, created_at desc);
create index if not exists outbound_call_attempts_customer_created_idx
  on public.outbound_call_attempts (customer_id, created_at desc);

create table if not exists public.outbound_payment_links (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.outbound_customers(id) on delete restrict,
  invoice_id uuid not null references public.outbound_invoices(id) on delete restrict,
  business_id uuid not null references public.outbound_businesses(id) on delete restrict,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_payment_link_id text,
  idempotency_key text not null default gen_random_uuid()::text,
  url text,
  amount_cents integer not null,
  currency text not null default 'usd',
  status text not null default 'creating',
  sent_via text,
  sent_at timestamptz,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint outbound_payment_links_amount_positive check (amount_cents > 0),
  constraint outbound_payment_links_currency check (currency ~ '^[a-z]{3}$'),
  constraint outbound_payment_links_status check (
    status in ('creating', 'open', 'expired', 'paid', 'cancelled', 'failed')
  ),
  constraint outbound_payment_links_sent_via check (
    sent_via is null or sent_via in ('admin', 'sms', 'email_placeholder', 'manual')
  )
);

create unique index if not exists outbound_payment_links_checkout_session_unique
  on public.outbound_payment_links (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create unique index if not exists outbound_payment_links_payment_intent_unique
  on public.outbound_payment_links (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create unique index if not exists outbound_payment_links_idempotency_unique
  on public.outbound_payment_links (idempotency_key);
create unique index if not exists outbound_payment_links_active_invoice_unique
  on public.outbound_payment_links (invoice_id)
  where status in ('creating', 'open');
create index if not exists outbound_payment_links_invoice_created_idx
  on public.outbound_payment_links (invoice_id, created_at desc);

create table if not exists public.outbound_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.outbound_businesses(id) on delete restrict,
  customer_id uuid references public.outbound_customers(id) on delete restrict,
  invoice_id uuid references public.outbound_invoices(id) on delete restrict,
  event_type text not null,
  source text not null,
  external_event_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists outbound_events_provider_id_unique
  on public.outbound_events (source, external_event_id)
  where external_event_id is not null;
create index if not exists outbound_events_invoice_created_idx
  on public.outbound_events (invoice_id, created_at desc);
create index if not exists outbound_events_business_created_idx
  on public.outbound_events (business_id, created_at desc);

create table if not exists public.outbound_followup_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.outbound_businesses(id) on delete restrict,
  customer_id uuid not null references public.outbound_customers(id) on delete restrict,
  invoice_id uuid not null references public.outbound_invoices(id) on delete restrict,
  task_type text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  attempt_number integer not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_followup_tasks_type check (
    task_type in ('call', 'email_placeholder', 'final_reminder_placeholder', 'manual_review')
  ),
  constraint outbound_followup_tasks_status check (
    status in ('pending', 'completed', 'cancelled', 'failed')
  ),
  constraint outbound_followup_tasks_attempt_positive check (attempt_number > 0)
);

create unique index if not exists outbound_followup_tasks_active_unique
  on public.outbound_followup_tasks (invoice_id, task_type, scheduled_for);
create index if not exists outbound_followup_tasks_due_idx
  on public.outbound_followup_tasks (status, scheduled_for);

drop trigger if exists outbound_businesses_set_updated_at on public.outbound_businesses;
create trigger outbound_businesses_set_updated_at
before update on public.outbound_businesses
for each row execute function public.outbound_set_updated_at();

drop trigger if exists outbound_customers_set_updated_at on public.outbound_customers;
create trigger outbound_customers_set_updated_at
before update on public.outbound_customers
for each row execute function public.outbound_set_updated_at();

drop trigger if exists outbound_invoices_set_updated_at on public.outbound_invoices;
create trigger outbound_invoices_set_updated_at
before update on public.outbound_invoices
for each row execute function public.outbound_set_updated_at();

drop trigger if exists outbound_followup_tasks_set_updated_at on public.outbound_followup_tasks;
create trigger outbound_followup_tasks_set_updated_at
before update on public.outbound_followup_tasks
for each row execute function public.outbound_set_updated_at();

alter table public.outbound_businesses enable row level security;
alter table public.outbound_customers enable row level security;
alter table public.outbound_invoices enable row level security;
alter table public.outbound_call_attempts enable row level security;
alter table public.outbound_payment_links enable row level security;
alter table public.outbound_events enable row level security;
alter table public.outbound_followup_tasks enable row level security;

revoke all on table
  public.outbound_businesses,
  public.outbound_customers,
  public.outbound_invoices,
  public.outbound_call_attempts,
  public.outbound_payment_links,
  public.outbound_events,
  public.outbound_followup_tasks
from public, anon, authenticated;

grant all on table
  public.outbound_businesses,
  public.outbound_customers,
  public.outbound_invoices,
  public.outbound_call_attempts,
  public.outbound_payment_links,
  public.outbound_events,
  public.outbound_followup_tasks
to service_role;

create or replace function public.outbound_mark_invoice_paid(
  p_external_event_id text,
  p_invoice_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_payload jsonb
)
returns table(invoice_id uuid, already_paid boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.outbound_invoices%rowtype;
  v_existing_event uuid;
begin
  select id into v_existing_event
  from public.outbound_events
  where source = 'stripe' and external_event_id = p_external_event_id;

  if v_existing_event is not null then
    return query select p_invoice_id, true;
    return;
  end if;

  select * into v_invoice
  from public.outbound_invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Outbound invoice not found';
  end if;

  insert into public.outbound_events (
    business_id,
    customer_id,
    invoice_id,
    event_type,
    source,
    external_event_id,
    payload
  ) values (
    v_invoice.business_id,
    v_invoice.customer_id,
    v_invoice.id,
    'checkout.session.completed',
    'stripe',
    p_external_event_id,
    coalesce(p_payload, '{}'::jsonb)
  );

  update public.outbound_invoices
  set status = 'paid', paid_at = coalesce(paid_at, now())
  where id = v_invoice.id;

  update public.outbound_payment_links as payment_link
  set
    status = 'paid',
    paid_at = coalesce(paid_at, now()),
    stripe_payment_intent_id = coalesce(p_payment_intent_id, payment_link.stripe_payment_intent_id)
  where payment_link.invoice_id = v_invoice.id
    and (
      payment_link.stripe_checkout_session_id = p_checkout_session_id
      or (p_checkout_session_id is null and payment_link.status in ('creating', 'open'))
    );

  update public.outbound_followup_tasks as followup
  set status = 'cancelled', reason = coalesce(followup.reason, 'invoice_paid')
  where followup.invoice_id = v_invoice.id and followup.status = 'pending';

  return query select v_invoice.id, v_invoice.status = 'paid';
end;
$$;

revoke all on function public.outbound_mark_invoice_paid(text, uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.outbound_mark_invoice_paid(text, uuid, text, text, jsonb)
to service_role;
