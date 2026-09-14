-- Additive, server-only storage. Published content is immutable; revisions create a new row.
create table public.outbound_email_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.outbound_businesses(id),
  version bigint generated always as identity,
  status text not null default 'draft' check (status in ('draft','published')),
  content jsonb not null check (jsonb_typeof(content)='object'),
  created_at timestamptz not null default now(),
  unique(business_id,id)
);
alter table public.outbound_email_templates enable row level security;
revoke all on public.outbound_email_templates from anon,authenticated;
grant select,insert,update on public.outbound_email_templates to service_role;
grant usage,select on sequence public.outbound_email_templates_version_seq to service_role;
alter table public.outbound_businesses add column default_email_template_id uuid,
  add column email_brand text not null default 'business' check(email_brand in ('business','pinnacle'));
alter table public.outbound_businesses add constraint outbound_business_email_template_tenant_fk
  foreign key(id,default_email_template_id) references public.outbound_email_templates(business_id,id);

create unique index if not exists outbound_invoices_business_id_id_key on public.outbound_invoices(business_id,id);
create table public.outbound_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.outbound_businesses(id),
  invoice_id uuid not null,
  template_id uuid,
  request_key text not null unique,
  status text not null check(status in ('pending','accepted','failed','unknown','delivered','bounced')),
  provider_message_id text unique,
  recipient_digest text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(business_id,invoice_id) references public.outbound_invoices(business_id,id),
  foreign key(business_id,template_id) references public.outbound_email_templates(business_id,id)
);
alter table public.outbound_email_deliveries enable row level security;
revoke all on public.outbound_email_deliveries from anon,authenticated;
grant select,insert,update on public.outbound_email_deliveries to service_role;

create function public.outbound_email_template_immutable() returns trigger language plpgsql
set search_path=public,pg_temp as $$ begin
  if old.status='published' and (new.content is distinct from old.content or new.business_id<>old.business_id or new.status<>'published') then
    raise exception 'Published templates are immutable; create a new draft';
  end if;
  return new;
end $$;
revoke all on function public.outbound_email_template_immutable() from public,anon,authenticated;
create trigger outbound_email_template_immutable before update on public.outbound_email_templates
for each row execute function public.outbound_email_template_immutable();
