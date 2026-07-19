create extension if not exists pgcrypto;

create table if not exists public.landing_page_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_name text not null,
  variant text not null,
  route text not null,
  session_id uuid not null,
  page_load_id uuid not null,
  submission_id uuid,
  source text not null default 'direct',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer_host text,
  metadata jsonb not null default '{}'::jsonb,
  is_test boolean not null default false,
  constraint landing_page_events_name check (
    event_name in (
      'page_view', 'form_start', 'form_step_complete', 'form_submit',
      'form_success', 'form_error', 'booking_click', 'demo_click'
    )
  ),
  constraint landing_page_events_variant check (variant in ('answer', 'ready', 'coverage')),
  constraint landing_page_events_route check (route in ('/answer/', '/ready/', '/coverage/')),
  constraint landing_page_events_variant_route check (
    (variant = 'answer' and route = '/answer/') or
    (variant = 'ready' and route = '/ready/') or
    (variant = 'coverage' and route = '/coverage/')
  ),
  constraint landing_page_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.landing_page_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  variant text not null,
  route text not null,
  session_id uuid not null,
  page_load_id uuid not null,
  submission_id uuid not null unique,
  interest text not null,
  current_handling text not null,
  coverage_gap text not null,
  call_volume_band text not null,
  full_name text not null,
  business_name text not null,
  email text not null,
  phone text not null,
  source text not null default 'direct',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer_host text,
  contact_permission_at timestamptz not null default now(),
  status text not null default 'new',
  is_test boolean not null default false,
  constraint landing_page_leads_variant check (variant in ('answer', 'ready', 'coverage')),
  constraint landing_page_leads_route check (route in ('/answer/', '/ready/', '/coverage/')),
  constraint landing_page_leads_variant_route check (
    (variant = 'answer' and route = '/answer/') or
    (variant = 'ready' and route = '/ready/') or
    (variant = 'coverage' and route = '/coverage/')
  ),
  constraint landing_page_leads_interest check (
    interest in ('full_receptionist', 'defined_coverage_gap', 'explore_both')
  ),
  constraint landing_page_leads_current_handling check (
    current_handling in ('owner_or_techs', 'office_team', 'answering_service', 'voicemail_or_mix')
  ),
  constraint landing_page_leads_coverage_gap check (
    coverage_gap in ('after_hours', 'overflow', 'lunch_weekends', 'missed_or_unsure')
  ),
  constraint landing_page_leads_call_volume check (
    call_volume_band in ('under_50', '50_150', '151_400', '400_plus', 'unsure')
  ),
  constraint landing_page_leads_status check (status in ('new', 'contacted', 'qualified', 'closed', 'not_fit')),
  constraint landing_page_leads_email_length check (char_length(email) between 3 and 200),
  constraint landing_page_leads_phone_length check (char_length(phone) between 8 and 18)
);

create index if not exists landing_page_events_created_at_idx
  on public.landing_page_events (created_at desc);
create index if not exists landing_page_events_variant_name_idx
  on public.landing_page_events (variant, event_name, created_at desc);
create index if not exists landing_page_events_session_idx
  on public.landing_page_events (session_id, created_at desc);
create unique index if not exists landing_page_events_submission_event_unique
  on public.landing_page_events (event_name, submission_id)
  where submission_id is not null;

create index if not exists landing_page_leads_created_at_idx
  on public.landing_page_leads (created_at desc);
create index if not exists landing_page_leads_variant_idx
  on public.landing_page_leads (variant, created_at desc);
create index if not exists landing_page_leads_source_idx
  on public.landing_page_leads (source, utm_campaign, created_at desc);

alter table public.landing_page_events enable row level security;
alter table public.landing_page_leads enable row level security;

revoke all on public.landing_page_events from anon, authenticated;
revoke all on public.landing_page_leads from anon, authenticated;
grant select, insert, update, delete on public.landing_page_events to service_role;
grant select, insert, update, delete on public.landing_page_leads to service_role;

comment on table public.landing_page_events is
  'First-party, session-estimate landing-page events. No raw IP, user agent, cookie ID, or fingerprint is stored.';
comment on table public.landing_page_leads is
  'Landing-page demo requests and minimum qualification fields. Server-side service-role access only.';
