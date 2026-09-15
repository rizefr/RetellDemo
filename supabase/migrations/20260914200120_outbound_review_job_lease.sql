-- Whole review-job lease. Database import remains authoritative if Sheet work fails.
-- No provider calls, email, SMS, accounting writes, or customer outreach occur here.
create table public.outbound_review_jobs (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.outbound_quickbooks_connections(business_id) on delete restrict,
 status text not null default 'active' check(status in ('active','completed','failed','expired')),
 claim_token_hash text not null,
 source_run_id uuid references public.outbound_quickbooks_sync_runs(id) on delete restrict,
 spreadsheet_url text not null,
 lease_expires_at timestamptz not null,
 claimed_at timestamptz not null default now(),
 completed_at timestamptz,
 reconciled_at timestamptz,
 failure_code text,
 readback jsonb,
 unique(id,business_id)
);
create index outbound_review_jobs_business_recent on public.outbound_review_jobs(business_id,claimed_at desc);
create unique index outbound_review_jobs_one_active on public.outbound_review_jobs(business_id) where status='active';
alter table public.outbound_quickbooks_sync_runs add column review_job_id uuid;
alter table public.outbound_quickbooks_sync_runs add constraint outbound_quickbooks_sync_review_job foreign key(review_job_id,business_id) references public.outbound_review_jobs(id,business_id);
alter table public.outbound_review_jobs enable row level security;
revoke all on public.outbound_review_jobs from public,anon,authenticated;
grant select,insert,update on public.outbound_review_jobs to service_role;

-- Every caller locks the same connection row first, including existing manual RPCs.
create function public.outbound_assert_review_job(p_business_id uuid,p_job_id uuid,p_claim_token uuid) returns void language plpgsql security invoker set search_path='' as $$
declare j public.outbound_review_jobs%rowtype;
begin
 perform 1 from public.outbound_quickbooks_connections where business_id=p_business_id for update;
 if not found then raise exception 'Verified connection required'; end if;
 if (p_job_id is null)<>(p_claim_token is null) then raise exception 'Review job and token are both required'; end if;
 if p_job_id is null then
  if exists(select 1 from public.outbound_review_jobs where business_id=p_business_id and status='active' and lease_expires_at>now()) then raise exception 'A review job is already running'; end if;
 else
  select * into j from public.outbound_review_jobs where business_id=p_business_id and id=p_job_id for update;
  if not found or j.claim_token_hash<>encode(sha256(convert_to(p_claim_token::text,'UTF8')),'hex') then raise exception 'Review job or token does not match business'; end if;
  if j.status<>'active' or j.lease_expires_at<=now() then raise exception 'Review job is not active or has expired'; end if;
 end if;
end; $$;
create function public.outbound_claim_review_job(p_business_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.outbound_quickbooks_connections%rowtype; j public.outbound_review_jobs%rowtype; token uuid:=gen_random_uuid(); sheet text;
begin
 select * into c from public.outbound_quickbooks_connections where business_id=p_business_id for update;
 if not found or c.status<>'active' or c.verified_at is null then raise exception 'Verified connection required'; end if;
 if exists(select 1 from public.outbound_businesses where id=p_business_id and is_demo) then raise exception 'Live review jobs require a separate live business'; end if;
 select spreadsheet_url into sheet from public.outbound_review_settings where business_id=p_business_id;
 if sheet is null then raise exception 'Review spreadsheet configuration required'; end if;
 update public.outbound_review_jobs set status='expired',failure_code='review_job_expired',completed_at=now() where business_id=p_business_id and status='active' and lease_expires_at<=now();
 select * into j from public.outbound_review_jobs where business_id=p_business_id and status in ('failed','expired') and reconciled_at is null order by claimed_at limit 1;
 if found then return jsonb_build_object('claimed',false,'reason','review_job_reconciliation_required','job_id',j.id,'status',j.status,'sheet_stale',true); end if;
 select * into j from public.outbound_review_jobs where business_id=p_business_id and status='active';
 if found then return jsonb_build_object('claimed',false,'reason','review_job_in_progress','job_id',j.id,'lease_expires_at',j.lease_expires_at); end if;
 if c.sync_lease_expires_at>now() then return jsonb_build_object('claimed',false,'reason','manual_sync_in_progress'); end if;
 insert into public.outbound_review_jobs(business_id,claim_token_hash,spreadsheet_url,lease_expires_at)
 values(p_business_id,encode(sha256(convert_to(token::text,'UTF8')),'hex'),sheet,now()+interval '30 minutes') returning * into j;
 insert into public.outbound_events(business_id,event_type,source,external_event_id,payload) values(p_business_id,'review_job_claimed','weekly_review','review-job-claimed:'||j.id,jsonb_build_object('job_id',j.id,'customer_outreach',false));
 return jsonb_build_object('claimed',true,'job_id',j.id,'claim_token',token,'lease_expires_at',j.lease_expires_at,'spreadsheet_url',sheet,'accounting_writes',false,'outreach_started',false);
end; $$;
-- No automatic recovery: an administrator must first establish that old managed
-- provider work is finished. Reconciliation never labels the Sheet current.
create function public.outbound_reconcile_review_job(p_business_id uuid,p_job_id uuid,p_confirmation text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.outbound_review_jobs%rowtype;
begin
 perform 1 from public.outbound_quickbooks_connections where business_id=p_business_id for update;
 if p_confirmation is distinct from 'PROVIDER WORK HAS ENDED; SHEET REQUIRES A NEW VERIFIED REFRESH' then raise exception 'Review job requires explicit operator reconciliation confirmation'; end if;
 select * into j from public.outbound_review_jobs where id=p_job_id and business_id=p_business_id for update;
 if not found then raise exception 'Review job does not match business'; end if;
 if j.status='active' and j.lease_expires_at<=now() then
  update public.outbound_review_jobs set status='expired',failure_code='review_job_expired',completed_at=now() where id=j.id returning * into j;
 end if;
 if j.status not in ('failed','expired') then raise exception 'Review job is not awaiting reconciliation'; end if;
 if j.reconciled_at is not null then return jsonb_build_object('job_id',j.id,'status',j.status,'reconciled',true,'already_reconciled',true,'sheet_stale',true); end if;
 update public.outbound_review_jobs set reconciled_at=now() where id=j.id;
 insert into public.outbound_events(business_id,event_type,source,external_event_id,payload) values(p_business_id,'review_job_reconciled','weekly_review','review-job-reconciled:'||j.id,jsonb_build_object('job_id',j.id,'provider_idle_attested',true,'sheet_stale',true,'customer_outreach',false));
 return jsonb_build_object('job_id',j.id,'status',j.status,'reconciled',true,'already_reconciled',false,'sheet_stale',true);
end; $$;
revoke all on function public.outbound_reconcile_review_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.outbound_reconcile_review_job(uuid,uuid,text) to service_role;
create function public.outbound_quickbooks_acquire_sync_for_review(p_business_id uuid,p_job_id uuid,p_claim_token uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare token uuid:=gen_random_uuid();
begin
 perform public.outbound_assert_review_job(p_business_id,p_job_id,p_claim_token);
 update public.outbound_quickbooks_connections set sync_lease=token,sync_lease_expires_at=now()+interval '10 minutes'
 where business_id=p_business_id and status='active' and verified_at is not null and (sync_lease_expires_at is null or sync_lease_expires_at<now());
 if not found then return null; end if;
 return token;
end; $$;
create or replace function public.outbound_quickbooks_acquire_sync(p_business_id uuid) returns uuid language sql security invoker set search_path='' as $$
 select public.outbound_quickbooks_acquire_sync_for_review(p_business_id,null,null);
$$;
CREATE OR REPLACE FUNCTION public.outbound_quickbooks_apply_preview_for_review(p_business_id uuid, p_preview_id uuid, p_preview_hash text, p_job_id uuid, p_claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.outbound_quickbooks_connections%rowtype; r public.outbound_quickbooks_sync_runs%rowtype; item jsonb; customer_uuid uuid; invoice_uuid uuid; imported integer:=0; quarantined integer:=0; v_status text; existing_invoice public.outbound_invoices%rowtype;
begin
 select * into c from public.outbound_quickbooks_connections where business_id=p_business_id for update;
 perform public.outbound_assert_review_job(p_business_id,p_job_id,p_claim_token);
 if c.sync_lease_expires_at>now() then raise exception 'QuickBooks preview is still running'; end if;
 if not found or c.status<>'active' or c.verified_at is null then raise exception 'Verified connection required'; end if;
 if exists(select 1 from public.outbound_businesses where id=p_business_id and is_demo) then raise exception 'Production QuickBooks data cannot be imported into a demo business'; end if;
 select * into r from public.outbound_quickbooks_sync_runs where id=p_preview_id and business_id=p_business_id and realm_id=c.realm_id for update;
 if not found or r.preview_hash<>p_preview_hash then raise exception 'Preview does not match business or hash'; end if;
 if r.review_job_id is distinct from p_job_id then raise exception 'Review job does not own this preview'; end if;
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
 if p_job_id is not null then update public.outbound_review_jobs set source_run_id=r.id where id=p_job_id and business_id=p_business_id; end if;
 insert into public.outbound_events(business_id,event_type,source,external_event_id,payload) values(p_business_id,'quickbooks_sync_applied','quickbooks','sync:'||r.id,jsonb_build_object('preview_id',r.id,'imported',imported,'quarantined',quarantined,'accounting_writes',false));
 return jsonb_build_object('status','applied','already_applied',false,'preview_id',r.id,'imported',imported,'quarantined',quarantined,'outreach_started',false);
end; $function$
;
create or replace function public.outbound_quickbooks_apply_preview(p_business_id uuid,p_preview_id uuid,p_preview_hash text) returns jsonb language sql security invoker set search_path='' as $$
 select public.outbound_quickbooks_apply_preview_for_review(p_business_id,p_preview_id,p_preview_hash,null,null);
$$;
create function public.outbound_complete_review_job(p_business_id uuid,p_job_id uuid,p_claim_token uuid,p_outcome text,p_source_run_id uuid default null,p_readback jsonb default null,p_failure_code text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.outbound_quickbooks_connections%rowtype; j public.outbound_review_jobs%rowtype; r public.outbound_quickbooks_sync_runs%rowtype; expected jsonb; totals jsonb; source_count integer; invoice_count integer; sheet text;
begin
 select * into c from public.outbound_quickbooks_connections where business_id=p_business_id for update;
 select * into j from public.outbound_review_jobs where business_id=p_business_id and id=p_job_id for update;
 if not found or p_claim_token is null or j.claim_token_hash<>encode(sha256(convert_to(p_claim_token::text,'UTF8')),'hex') then raise exception 'Review job or token does not match business'; end if;
 if p_outcome not in ('completed','failed') then raise exception 'Invalid review job outcome'; end if;
 if j.status=p_outcome then
  if j.source_run_id is distinct from p_source_run_id or (p_outcome='completed' and j.readback is distinct from p_readback) or (p_outcome='failed' and j.failure_code is distinct from p_failure_code) then raise exception 'Review job completion conflicts with prior result'; end if;
  return jsonb_build_object('job_id',j.id,'status',j.status,'already_completed',true);
 end if;
 if j.status<>'active' then raise exception 'Review job has already ended'; end if;
 if j.lease_expires_at<=now() then
  update public.outbound_review_jobs set status='expired',failure_code='review_job_expired',completed_at=now() where id=j.id;
  return jsonb_build_object('job_id',j.id,'status','expired','sheet_stale',true);
 end if;
 if p_outcome='completed' then
  if p_source_run_id is null or j.source_run_id is distinct from p_source_run_id then raise exception 'Review job requires its exact applied source run'; end if;
  select * into r from public.outbound_quickbooks_sync_runs where id=p_source_run_id and business_id=p_business_id and review_job_id=j.id and realm_id=c.realm_id and status='applied';
  if not found or r.applied_at is distinct from c.last_successful_sync_at then raise exception 'Review job source is no longer current'; end if;
  select spreadsheet_url into sheet from public.outbound_review_settings where business_id=p_business_id;
  if sheet is distinct from j.spreadsheet_url then raise exception 'Review job spreadsheet configuration changed'; end if;
  if exists(select 1 from public.outbound_quickbooks_source_invoices where business_id=p_business_id and realm_id=c.realm_id and last_sync_run_id<>r.id) then raise exception 'Review job source rows do not match its applied run'; end if;
  select count(*),count(*) filter(where (source_data->>'source_balance_cents')::bigint>0 and (source_data->>'days_overdue')::integer>14) into source_count,invoice_count from public.outbound_quickbooks_source_invoices where business_id=p_business_id and realm_id=c.realm_id and last_sync_run_id=r.id;
  select coalesce(jsonb_object_agg(currency,total),'{}'::jsonb) into totals from (
   select source_data->>'currency' as currency,sum((source_data->>'source_balance_cents')::bigint) as total from public.outbound_quickbooks_source_invoices where business_id=p_business_id and realm_id=c.realm_id and last_sync_run_id=r.id and (source_data->>'source_balance_cents')::bigint>0 and (source_data->>'days_overdue')::integer>14 and source_data->>'currency' ~ '^[A-Z]{3}$' group by source_data->>'currency'
  ) grouped;
  expected:=jsonb_build_object('spreadsheet_url',sheet,'source_run_id',r.id,'source_count',source_count,'invoice_count',invoice_count,'totals_minor_by_currency',totals);
  if p_readback is distinct from expected then raise exception 'Review job managed Sheet readback does not match its applied snapshot'; end if;
 else
  if p_failure_code is null or p_failure_code !~ '^[a-z0-9_-]{1,100}$' then raise exception 'Valid review failure code required'; end if;
  if p_source_run_id is distinct from j.source_run_id then raise exception 'Failure source run does not match review job'; end if;
 end if;
 update public.outbound_review_jobs set status=p_outcome,readback=case when p_outcome='completed' then p_readback else null end,failure_code=case when p_outcome='failed' then p_failure_code else null end,completed_at=now() where id=j.id;
 insert into public.outbound_events(business_id,event_type,source,external_event_id,payload) values(p_business_id,'review_job_'||p_outcome,'weekly_review','review-job-'||p_outcome||':'||j.id,jsonb_build_object('job_id',j.id,'source_run_id',j.source_run_id,'sheet_stale',p_outcome<>'completed','customer_outreach',false));
 return jsonb_build_object('job_id',j.id,'status',p_outcome,'source_run_id',j.source_run_id,'already_completed',false,'sheet_stale',p_outcome<>'completed');
end; $$;
revoke all on function public.outbound_assert_review_job(uuid,uuid,uuid),public.outbound_claim_review_job(uuid),public.outbound_quickbooks_acquire_sync_for_review(uuid,uuid,uuid),public.outbound_quickbooks_apply_preview_for_review(uuid,uuid,text,uuid,uuid),public.outbound_complete_review_job(uuid,uuid,uuid,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.outbound_assert_review_job(uuid,uuid,uuid),public.outbound_claim_review_job(uuid),public.outbound_quickbooks_acquire_sync_for_review(uuid,uuid,uuid),public.outbound_quickbooks_apply_preview_for_review(uuid,uuid,text,uuid,uuid),public.outbound_complete_review_job(uuid,uuid,uuid,text,uuid,jsonb,text) to service_role;
