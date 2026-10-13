-- Shared admin sign-in budget; contains no credentials, IPs, or customer data.
create table if not exists public.outbound_admin_login_budget (
  scope text primary key check (scope = 'outbound_admin'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 21)
);
alter table public.outbound_admin_login_budget enable row level security;
revoke all on table public.outbound_admin_login_budget from public, anon, authenticated;
grant select, insert, update on public.outbound_admin_login_budget to service_role;

create or replace function public.outbound_record_admin_login_attempt() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.outbound_admin_login_budget%rowtype;
begin
  insert into public.outbound_admin_login_budget(scope, window_started_at, attempts)
  values ('outbound_admin', v_now, 1)
  on conflict (scope) do update set
    window_started_at = case when v_now >= outbound_admin_login_budget.window_started_at + interval '60 seconds'
      then v_now else outbound_admin_login_budget.window_started_at end,
    attempts = case when v_now >= outbound_admin_login_budget.window_started_at + interval '60 seconds'
      then 1 else least(outbound_admin_login_budget.attempts + 1, 21) end
  returning * into v_row;
  return jsonb_build_object('allowed', v_row.attempts <= 20,
    'retry_after_seconds', greatest(1, least(60, ceil(extract(epoch from
      v_row.window_started_at + interval '60 seconds' - v_now))::integer)));
end;
$$;
revoke all on function public.outbound_record_admin_login_attempt() from public, anon, authenticated;
grant execute on function public.outbound_record_admin_login_attempt() to service_role;
