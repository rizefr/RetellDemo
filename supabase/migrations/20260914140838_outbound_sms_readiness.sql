-- Additive, server-only consent evidence. This migration enables no messages.
create unique index if not exists outbound_customers_id_business_id_key
  on public.outbound_customers(id, business_id);

create table public.outbound_sms_consents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.outbound_businesses(id),
  customer_id uuid not null,
  phone_number text not null check (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null check (status in ('granted', 'revoked')),
  channel text not null check (channel = 'sms'),
  purpose text not null check (purpose = 'invoice_follow_up'),
  source text not null check (source in ('written_opt_in', 'web_form', 'recorded_verbal', 'customer_request')),
  evidence text not null check (length(evidence) between 20 and 2000),
  evidence_url text,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(id, business_id),
  foreign key (customer_id, business_id) references public.outbound_customers(id, business_id)
);
create index outbound_sms_consents_recipient_idx on public.outbound_sms_consents(business_id, phone_number, created_at desc);

create table public.outbound_sms_suppressions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.outbound_businesses(id),
  phone_number text not null check (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  reason text not null check (reason in ('consent_revoked', 'stop_received', 'admin_suppressed')),
  consent_id uuid,
  created_at timestamptz not null default now(),
  unique(business_id, phone_number),
  foreign key (consent_id, business_id) references public.outbound_sms_consents(id, business_id)
);

create table public.outbound_sms_provider_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.outbound_businesses(id),
  provider_event_id text not null,
  provider_message_id text,
  event_type text not null check (event_type in ('inbound', 'accepted', 'sent', 'delivered', 'failed', 'undelivered')),
  body_hash text not null check (body_hash ~ '^[a-f0-9]{64}$'),
  signature_verified boolean not null check (signature_verified = true),
  provider_timestamp timestamptz not null,
  created_at timestamptz not null default now(),
  unique(business_id, provider_event_id)
);

alter table public.outbound_sms_consents enable row level security;
alter table public.outbound_sms_suppressions enable row level security;
alter table public.outbound_sms_provider_events enable row level security;
revoke all on public.outbound_sms_consents, public.outbound_sms_suppressions, public.outbound_sms_provider_events from public, anon, authenticated, service_role;
grant select, insert on public.outbound_sms_consents to service_role;
grant select, insert, update on public.outbound_sms_suppressions to service_role;
grant select, insert on public.outbound_sms_provider_events to service_role;

comment on table public.outbound_sms_consents is 'Explicit, append-only SMS consent evidence. A QuickBooks contact is never consent. No sending is activated.';
comment on table public.outbound_sms_provider_events is 'Prepared for a future verified provider adapter. No provider webhook is connected by this migration. Unique IDs prevent replay writes.';
