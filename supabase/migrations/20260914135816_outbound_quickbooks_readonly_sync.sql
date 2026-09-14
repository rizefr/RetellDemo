-- Additive source provenance and review-only synchronization. No accounting writes.
create table if not exists public.outbound_quickbooks_connections (
  business_id uuid primary key references public.outbound_businesses(id) on delete restrict,
  realm_id text not null check (realm_id ~ '^[0-9]+$'),
  company_name text not null,
  environment text not null check (environment in ('production','sandbox')),
  connected_account_id text not null,
  connection_owner_id text not null,
  timezone text not null default 'America/New_York',
  source_timezone text,
  status text not null default 'pending' check (status in ('pending','active','revoked','error')),
  verified_at timestamptz,
  last_successful_sync_at timestamptz,
  sync_lease uuid,
  sync_lease_expires_at timestamptz,
  sync_enabled boolean not null default false,
  schedule jsonb not null default '{"enabled":false,"weekday":2,"hour":12,"timezone":"America/New_York","notification_destination":null}',
  spreadsheet_url text,
  created_at timestamptz not null default now(),
  unique (environment,realm_id),
  unique (business_id,realm_id)
);
create table if not exists public.outbound_quickbooks_sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  realm_id text not null,
  preview_hash text not null check (preview_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'preview' check (status in ('preview','applied','failed','expired')),
  preview jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  foreign key (business_id,realm_id) references public.outbound_quickbooks_connections(business_id,realm_id) on delete restrict
);
create table if not exists public.outbound_quickbooks_source_invoices (
  business_id uuid not null,
  realm_id text not null,
  provider_invoice_id text not null,
  provider_customer_id text not null,
  source_data jsonb not null,
  last_sync_run_id uuid not null references public.outbound_quickbooks_sync_runs(id) on delete restrict,
  outbound_invoice_id uuid references public.outbound_invoices(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id,realm_id,provider_invoice_id),
  foreign key (business_id,realm_id) references public.outbound_quickbooks_connections(business_id,realm_id) on delete restrict
);
alter table public.outbound_invoices
  add column if not exists source_provider text not null default 'local',
  add column if not exists source_realm_id text,
  add column if not exists provider_invoice_id text,
  add column if not exists provider_customer_id text,
  add column if not exists source_document_number text,
  add column if not exists invoice_date date,
  add column if not exists original_total_cents integer,
  add column if not exists source_balance_cents integer,
  add column if not exists source_verified_at timestamptz;
create unique index if not exists outbound_invoices_quickbooks_identity on public.outbound_invoices(business_id,source_realm_id,provider_invoice_id) where source_provider='quickbooks';
alter table public.outbound_invoices drop constraint if exists outbound_invoices_amount_positive;
alter table public.outbound_invoices add constraint outbound_invoices_amount_positive check (amount_due_cents>0 or (source_provider='quickbooks' and amount_due_cents=0));
alter table public.outbound_payment_links
  add column if not exists provider text not null default 'stripe',
  add column if not exists provider_invoice_id text,
  add column if not exists source_realm_id text;

create or replace function public.outbound_quickbooks_acquire_sync(p_business_id uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare v_lease uuid:=gen_random_uuid();
begin
 update public.outbound_quickbooks_connections set sync_lease=v_lease,sync_lease_expires_at=now()+interval '10 minutes' where business_id=p_business_id and status='active' and verified_at is not null and (sync_lease_expires_at is null or sync_lease_expires_at<now());
 if not found then return null; end if;
 return v_lease;
end; $$;
create or replace function public.outbound_quickbooks_release_sync(p_business_id uuid,p_lease uuid) returns void language sql security invoker set search_path=public as $$
 update public.outbound_quickbooks_connections set sync_lease=null,sync_lease_expires_at=null where business_id=p_business_id and sync_lease=p_lease;
$$;
CREATE OR REPLACE FUNCTION public.outbound_quickbooks_apply_preview(p_business_id uuid, p_preview_id uuid, p_preview_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare c public.outbound_quickbooks_connections%rowtype; r public.outbound_quickbooks_sync_runs%rowtype; item jsonb; customer_uuid uuid; invoice_uuid uuid; imported integer:=0; quarantined integer:=0; v_status text; existing_invoice public.outbound_invoices%rowtype;
begin
 select * into c from public.outbound_quickbooks_connections where business_id=p_business_id for update;
 if not found or c.status<>'active' or c.verified_at is null then raise exception 'Verified connection required'; end if;
 if exists(select 1 from public.outbound_businesses where id=p_business_id and is_demo) then raise exception 'Production QuickBooks data cannot be imported into a demo business'; end if;
 select * into r from public.outbound_quickbooks_sync_runs where id=p_preview_id and business_id=p_business_id and realm_id=c.realm_id for update;
 if not found or r.preview_hash<>p_preview_hash then raise exception 'Preview does not match business or hash'; end if;
 if r.status='applied' then return jsonb_build_object('status','applied','already_applied',true,'preview_id',r.id); end if;
 if r.status<>'preview' or r.expires_at<now() then raise exception 'Preview expired; refresh and review again'; end if;
 if r.created_at<c.last_successful_sync_at then raise exception 'Newer source data has already been applied'; end if;
 for item in select value from jsonb_array_elements(r.preview->'rows') loop
  if item->>'source_realm_id'<>c.realm_id then raise exception 'Source company mismatch'; end if;
  invoice_uuid:=null; customer_uuid:=null;
  select * into existing_invoice from public.outbound_invoices where business_id=p_business_id and source_provider='quickbooks' and source_realm_id=c.realm_id and provider_invoice_id=item->>'provider_invoice_id';
  if found then invoice_uuid:=existing_invoice.id; end if;
  if invoice_uuid is not null and existing_invoice.provider_customer_id<>item->>'provider_customer_id' then raise exception 'Customer reassignment requires manual review'; end if;
  if invoice_uuid is not null and (item->>'source_balance_cents')::integer=0 then
   update public.outbound_invoices set status='paid',amount_due_cents=0,source_balance_cents=0,source_verified_at=(item->>'source_verified_at')::timestamptz where id=invoice_uuid;
   update public.outbound_followup_tasks set status='cancelled',reason='quickbooks_invoice_paid' where invoice_id=invoice_uuid and status in ('pending','in_progress');
   update public.outbound_payment_links set status='paid' where invoice_id=invoice_uuid and status in ('creating','open');
  end if;
  if coalesce((item->>'mapping_valid')::boolean,false) then
   insert into public.outbound_customers(business_id,external_customer_id,first_name,last_name,phone_number,email,timezone,account_company_name)
   values(p_business_id,'qbo:'||c.realm_id||':'||(item->>'provider_customer_id'),coalesce(item->>'first_name',''),coalesce(item->>'last_name',''),item->>'phone_number',coalesce(item->>'invoice_email',item->>'email'),c.timezone,item->>'customer_account')
   on conflict (business_id,external_customer_id) do nothing;
   select id into customer_uuid from public.outbound_customers where business_id=p_business_id and external_customer_id='qbo:'||c.realm_id||':'||(item->>'provider_customer_id');
   v_status:=case when (item->>'source_balance_cents')::integer=0 then 'paid' when existing_invoice.status in ('disputed','manual_review','cancelled') then existing_invoice.status else 'unpaid' end;
   insert into public.outbound_invoices(business_id,customer_id,invoice_id,amount_due_cents,currency,original_due_date,service_description,status,inspection_date,inspection_type,source_provider,source_realm_id,provider_invoice_id,provider_customer_id,source_document_number,invoice_date,original_total_cents,source_balance_cents,source_verified_at)
   values(p_business_id,customer_uuid,'QBO-'||c.realm_id||'-'||(item->>'provider_invoice_id'),(item->>'source_balance_cents')::integer,lower(item->>'currency'),(item->>'original_due_date')::date,item->>'service_description',v_status,(item->>'inspection_date')::date,item->>'inspection_type','quickbooks',c.realm_id,item->>'provider_invoice_id',item->>'provider_customer_id',item->>'invoice_id',(item->>'invoice_date')::date,(item->>'original_total_cents')::integer,(item->>'source_balance_cents')::integer,(item->>'source_verified_at')::timestamptz)
   on conflict (business_id,source_realm_id,provider_invoice_id) where source_provider='quickbooks' do update set
    amount_due_cents=excluded.amount_due_cents,currency=excluded.currency,original_due_date=excluded.original_due_date,service_description=excluded.service_description,status=excluded.status,inspection_date=excluded.inspection_date,inspection_type=excluded.inspection_type,source_document_number=excluded.source_document_number,invoice_date=excluded.invoice_date,original_total_cents=excluded.original_total_cents,source_balance_cents=excluded.source_balance_cents,source_verified_at=excluded.source_verified_at
   returning id into invoice_uuid;
   imported:=imported+1;
   if v_status='paid' or (existing_invoice.id is not null and existing_invoice.amount_due_cents<>(item->>'source_balance_cents')::integer) then
    update public.outbound_payment_links set status=case when v_status='paid' then 'paid' else 'cancelled' end where invoice_id=invoice_uuid and status in ('creating','open');
   end if;
   if v_status in ('paid','disputed','manual_review','cancelled') then update public.outbound_followup_tasks set status='cancelled',reason='quickbooks_source_reconciliation' where invoice_id=invoice_uuid and status in ('pending','in_progress'); end if;
  else
   quarantined:=quarantined+1;
   if invoice_uuid is not null then
    update public.outbound_invoices set source_verified_at=null where id=invoice_uuid;
   end if;
  end if;
  insert into public.outbound_quickbooks_source_invoices(business_id,realm_id,provider_invoice_id,provider_customer_id,source_data,last_sync_run_id,outbound_invoice_id)
  values(p_business_id,c.realm_id,item->>'provider_invoice_id',item->>'provider_customer_id',item,r.id,invoice_uuid)
  on conflict (business_id,realm_id,provider_invoice_id) do update set source_data=excluded.source_data,last_sync_run_id=excluded.last_sync_run_id,outbound_invoice_id=coalesce(excluded.outbound_invoice_id,outbound_quickbooks_source_invoices.outbound_invoice_id),updated_at=now();
 end loop;
 update public.outbound_invoices set source_verified_at=null where business_id=p_business_id and source_provider='quickbooks' and source_realm_id=c.realm_id and provider_invoice_id not in (select value->>'provider_invoice_id' from jsonb_array_elements(r.preview->'rows'));
 update public.outbound_quickbooks_source_invoices set source_data=jsonb_set(jsonb_set(source_data,'{eligible}','false'::jsonb),'{block_reasons}',coalesce(source_data->'block_reasons','[]'::jsonb)||'"missing_from_latest_source"'::jsonb) where business_id=p_business_id and realm_id=c.realm_id and last_sync_run_id<>r.id;
 update public.outbound_followup_tasks set status='cancelled',reason='quickbooks_source_unverified' where business_id=p_business_id and status in ('pending','in_progress') and invoice_id in (select id from public.outbound_invoices where business_id=p_business_id and source_provider='quickbooks' and source_verified_at is null);
 update public.outbound_quickbooks_sync_runs set status='applied',applied_at=now() where id=r.id;
 update public.outbound_quickbooks_connections set last_successful_sync_at=now() where business_id=p_business_id;
 insert into public.outbound_events(business_id,event_type,source,external_event_id,payload) values(p_business_id,'quickbooks_sync_applied','quickbooks','sync:'||r.id,jsonb_build_object('preview_id',r.id,'imported',imported,'quarantined',quarantined,'accounting_writes',false));
 return jsonb_build_object('status','applied','already_applied',false,'preview_id',r.id,'imported',imported,'quarantined',quarantined,'outreach_started',false);
end; $function$

;

alter table public.outbound_quickbooks_connections enable row level security;
alter table public.outbound_quickbooks_sync_runs enable row level security;
alter table public.outbound_quickbooks_source_invoices enable row level security;
revoke all on public.outbound_quickbooks_connections,public.outbound_quickbooks_sync_runs,public.outbound_quickbooks_source_invoices from public,anon,authenticated;
grant all on public.outbound_quickbooks_connections,public.outbound_quickbooks_sync_runs,public.outbound_quickbooks_source_invoices to service_role;
revoke all on function public.outbound_quickbooks_acquire_sync(uuid),public.outbound_quickbooks_release_sync(uuid,uuid),public.outbound_quickbooks_apply_preview(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.outbound_quickbooks_acquire_sync(uuid),public.outbound_quickbooks_release_sync(uuid,uuid),public.outbound_quickbooks_apply_preview(uuid,uuid,text) to service_role;
