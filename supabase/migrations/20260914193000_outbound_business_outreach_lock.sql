-- Keep existing business behavior; accounting-only businesses must explicitly
-- set false when provisioned. This flag is not accepted by browser edit routes.
alter table public.outbound_businesses
  add column if not exists outreach_enabled boolean not null default true;

comment on column public.outbound_businesses.outreach_enabled is
  'Business-level outbound call lock. False blocks preflight, start, batches and temporary demo authorization; email/SMS retain separate gates. Live accounting imports must explicitly set false until separately authorized.';
