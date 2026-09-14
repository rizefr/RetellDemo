-- Internal weekly review reminders only. These functions do not send mail or start outreach.
create table public.outbound_review_settings (
 business_id uuid primary key references public.outbound_businesses(id) on delete restrict,
 stage text not null default 'staged_preview' check(stage in ('staged_preview','live_verified')),
 spreadsheet_url text not null check(spreadsheet_url ~ '^https://docs[.]google[.]com/spreadsheets/d/[A-Za-z0-9_-]+(/edit)?$'),
 source_snapshot_at timestamptz,
 reminder_recipient text not null check(reminder_recipient ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+[.][^[:space:]@,;<>]+$'),
 timezone text not null default 'America/New_York' check(timezone='America/New_York'),
 weekday integer not null default 2 check(weekday=2),
 hour integer not null default 12 check(hour=12),
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.outbound_review_runs (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.outbound_review_settings(business_id) on delete restrict,
 week_start date not null check(extract(isodow from week_start)=1),
 status text not null check(status in ('reserved','accepted','uncertain','failed_no_send')),
 claim_token uuid not null default gen_random_uuid(),
 lease_expires_at timestamptz not null,
 recipient text not null check(recipient ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+[.][^[:space:]@,;<>]+$'),
 subject text not null,
 body_text text not null,
 review_snapshot jsonb not null,
 provider_message_id text,
 failure_code text,
 claimed_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(business_id,week_start),
 check(status<>'accepted' or (provider_message_id is not null and length(provider_message_id) between 1 and 512))
);
create or replace function public.outbound_claim_review_run(p_business_id uuid,p_subject text,p_body_text text,p_snapshot jsonb,p_now timestamptz default now()) returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.outbound_review_settings%rowtype; r public.outbound_review_runs%rowtype; week_date date; due_at timestamptz;
begin
 select * into c from public.outbound_review_settings where business_id=p_business_id for update;
 if not found then raise exception 'Review configuration not found'; end if;
 if not c.enabled then return jsonb_build_object('can_send',false,'reason','review_disabled'); end if;
 week_date:=date_trunc('week',p_now at time zone c.timezone)::date;
 due_at:=(week_date+interval '1 day 12 hours') at time zone c.timezone;
 if p_now<due_at then return jsonb_build_object('can_send',false,'reason','before_weekly_schedule','due_at',due_at); end if;
 select * into r from public.outbound_review_runs where business_id=p_business_id and week_start=week_date for update;
 if found then
  if r.status='reserved' and r.lease_expires_at<=p_now then
   update public.outbound_review_runs set status='uncertain',failure_code='claim_lease_expired',completed_at=p_now where id=r.id returning * into r;
  end if;
  return jsonb_build_object('can_send',false,'reason',case when r.status='reserved' then 'review_in_progress' else 'review_already_reserved' end,'run_id',r.id,'status',r.status,'week_start',r.week_start,'retry_allowed',false);
 end if;
 if p_subject is null or length(p_subject) not between 1 and 300 or p_body_text is null or length(p_body_text) not between 1 and 20000 or p_snapshot is null then raise exception 'Invalid review content'; end if;
 insert into public.outbound_review_runs(business_id,week_start,status,lease_expires_at,recipient,subject,body_text,review_snapshot,claimed_at)
 values(p_business_id,week_date,'reserved',p_now+interval '15 minutes',c.reminder_recipient,p_subject,p_body_text,p_snapshot,p_now) returning * into r;
 insert into public.outbound_events(business_id,event_type,source,external_event_id,payload) values(p_business_id,'weekly_review_reserved','weekly_review','weekly-review-claimed:'||r.id,jsonb_build_object('run_id',r.id,'week_start',r.week_start,'stage',c.stage,'customer_outreach',false));
 return jsonb_build_object('can_send',true,'run_id',r.id,'claim_token',r.claim_token,'status',r.status,'week_start',r.week_start,'lease_expires_at',r.lease_expires_at,'recipient',r.recipient,'subject',r.subject,'body_text',r.body_text,'review',r.review_snapshot,'retry_allowed',false);
end; $$;
create or replace function public.outbound_complete_review_run(p_business_id uuid,p_run_id uuid,p_claim_token uuid,p_outcome text,p_provider_message_id text default null,p_failure_code text default null) returns jsonb language plpgsql security invoker set search_path=public as $$
declare r public.outbound_review_runs%rowtype;
begin
 select * into r from public.outbound_review_runs where business_id=p_business_id and id=p_run_id for update;
 if not found or r.claim_token<>p_claim_token then raise exception 'Review run or claim token does not match business'; end if;
 if p_outcome not in ('accepted','uncertain','failed_no_send') then raise exception 'Invalid review outcome'; end if;
 if p_outcome='accepted' and (p_provider_message_id is null or length(trim(p_provider_message_id)) not between 1 and 512) then raise exception 'Provider message ID required for accepted reminder'; end if;
 if r.status=p_outcome then
  if p_outcome='accepted' and r.provider_message_id<>p_provider_message_id then raise exception 'Provider message ID conflicts with accepted reminder'; end if;
  return jsonb_build_object('run_id',r.id,'status',r.status,'already_completed',true,'retry_allowed',false,'provider_message_id',r.provider_message_id);
 end if;
 if r.status<>'reserved' and not (r.status='uncertain' and p_outcome='accepted') then raise exception 'Completed review outcome cannot be changed'; end if;
 update public.outbound_review_runs set status=p_outcome,provider_message_id=case when p_outcome='accepted' then p_provider_message_id else null end,failure_code=case when p_outcome='accepted' then null else left(p_failure_code,100) end,completed_at=now() where id=r.id returning * into r;
 insert into public.outbound_events(business_id,event_type,source,external_event_id,payload) values(p_business_id,'weekly_review_'||p_outcome,'weekly_review','weekly-review-'||p_outcome||':'||r.id,jsonb_build_object('run_id',r.id,'week_start',r.week_start,'provider_message_id',r.provider_message_id,'customer_outreach',false));
 return jsonb_build_object('run_id',r.id,'status',r.status,'already_completed',false,'retry_allowed',false,'provider_message_id',r.provider_message_id);
end; $$;
alter table public.outbound_review_settings enable row level security;
alter table public.outbound_review_runs enable row level security;
revoke all on public.outbound_review_settings,public.outbound_review_runs from public,anon,authenticated;
grant select,insert,update on public.outbound_review_settings,public.outbound_review_runs to service_role;
revoke all on function public.outbound_claim_review_run(uuid,text,text,jsonb,timestamptz),public.outbound_complete_review_run(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.outbound_claim_review_run(uuid,text,text,jsonb,timestamptz),public.outbound_complete_review_run(uuid,uuid,uuid,text,text,text) to service_role;
