alter table public.outbound_customers
  add column if not exists account_company_name text;

create index if not exists outbound_customers_account_company_idx
  on public.outbound_customers (business_id, account_company_name)
  where account_company_name is not null;

update public.outbound_businesses
set ai_disclosure_policy = 'on_request'
where is_demo = true
  and coalesce(product_type, 'elevator_inspection') = 'elevator_inspection';

alter table public.outbound_customers enable row level security;
alter table public.outbound_businesses enable row level security;
revoke all on public.outbound_customers from anon, authenticated;
revoke all on public.outbound_businesses from anon, authenticated;
