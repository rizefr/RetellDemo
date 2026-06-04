create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  caller_name text,
  caller_phone text not null,
  alternate_phone text,
  pest_issue text,
  urgency_level text,
  preferred_booking_method text,
  service_area text,
  zip_code text,
  property_address text,
  property_street text,
  property_city text,
  property_state text,
  property_zip text,
  preferred_datetime text,
  call_summary text,
  retell_call_id text,
  source text,
  status text default 'new',
  sms_sent boolean default false,
  booking_url text,
  transferred boolean default false
);

alter table public.leads add column if not exists alternate_phone text;
alter table public.leads add column if not exists property_address text;
alter table public.leads add column if not exists property_street text;
alter table public.leads add column if not exists property_city text;
alter table public.leads add column if not exists property_state text;
alter table public.leads add column if not exists property_zip text;
alter table public.leads add column if not exists preferred_datetime text;

create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  retell_call_id text,
  event_type text,
  event_payload jsonb,
  caller_phone text,
  agent_id text
);

create table if not exists public.sms_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid null references public.leads(id) on delete set null,
  caller_phone text,
  message text,
  booking_url text,
  status text,
  provider text,
  provider_response jsonb
);

create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid null references public.leads(id) on delete set null,
  caller_name text,
  caller_phone text,
  pest_issue text,
  preferred_datetime text,
  confirmed_datetime timestamptz null,
  booking_status text,
  calendar_provider text,
  provider_booking_id text,
  provider_response jsonb
);

create index if not exists leads_caller_phone_idx on public.leads (caller_phone);
create index if not exists leads_alternate_phone_idx on public.leads (alternate_phone);
create index if not exists leads_retell_call_id_idx on public.leads (retell_call_id);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_property_zip_idx on public.leads (property_zip);

create index if not exists call_events_retell_call_id_idx on public.call_events (retell_call_id);
create index if not exists call_events_caller_phone_idx on public.call_events (caller_phone);
create index if not exists call_events_created_at_idx on public.call_events (created_at desc);

create index if not exists sms_events_caller_phone_idx on public.sms_events (caller_phone);
create index if not exists sms_events_created_at_idx on public.sms_events (created_at desc);

create index if not exists booking_requests_caller_phone_idx on public.booking_requests (caller_phone);
create index if not exists booking_requests_created_at_idx on public.booking_requests (created_at desc);

alter table public.leads enable row level security;
alter table public.call_events enable row level security;
alter table public.sms_events enable row level security;
alter table public.booking_requests enable row level security;

comment on table public.leads is 'Server-side Retell pest-control demo leads. Access through service role only by default.';
comment on table public.call_events is 'Retell webhook and transfer events. Access through service role only by default.';
comment on table public.sms_events is 'Outbound or simulated SMS booking-link events. Access through service role only by default.';
comment on table public.booking_requests is 'Calendar booking attempts and confirmations. Access through service role only by default.';
