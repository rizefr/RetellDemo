-- Explicit unverified callback opt-out suppresses only the signed calling number.
create table public.outbound_phone_suppressions (
 business_id uuid not null references public.outbound_businesses(id),
 phone_number text not null check(phone_number ~ '^\+[1-9][0-9]{7,14}$'),
 source text not null check(source='signed_collection_callback'),
 source_call_id text not null,
 created_at timestamptz not null default now(),
 primary key(business_id,phone_number)
);
alter table public.outbound_phone_suppressions enable row level security;
revoke all on public.outbound_phone_suppressions from public,anon,authenticated,service_role;
grant select,insert on public.outbound_phone_suppressions to service_role;
