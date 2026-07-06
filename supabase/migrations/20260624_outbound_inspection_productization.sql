alter table public.outbound_businesses
  add column if not exists product_type text not null default 'elevator_inspection',
  add column if not exists retell_voice_id text,
  add column if not exists default_inspection_type text not null default 'Category 1',
  add column if not exists days_after_inspection_first_call integer not null default 14,
  add column if not exists very_overdue_threshold_days integer not null default 45;

alter table public.outbound_businesses drop constraint if exists outbound_businesses_product_type;
alter table public.outbound_businesses add constraint outbound_businesses_product_type
  check (product_type in ('elevator_inspection', 'elevator_service'));

alter table public.outbound_businesses drop constraint if exists outbound_businesses_default_inspection_type;
alter table public.outbound_businesses add constraint outbound_businesses_default_inspection_type
  check (default_inspection_type in ('Category 1', 'Category 5', 'Acceptance Test', 'Periodic Inspection'));

alter table public.outbound_businesses drop constraint if exists outbound_businesses_inspection_followup_days;
alter table public.outbound_businesses add constraint outbound_businesses_inspection_followup_days
  check (days_after_inspection_first_call between 0 and 365 and very_overdue_threshold_days between 1 and 365);

alter table public.outbound_businesses drop constraint if exists outbound_businesses_payment_provider;
alter table public.outbound_businesses add constraint outbound_businesses_payment_provider
  check (payment_provider in ('stripe', 'quickbooks', 'quickbooks_read_only', 'quickbooks_payment_link_enabled', 'manual'));

alter table public.outbound_invoices
  add column if not exists inspection_type text,
  add column if not exists expected_payment_date date;

alter table public.outbound_invoices drop constraint if exists outbound_invoices_inspection_type;
alter table public.outbound_invoices add constraint outbound_invoices_inspection_type
  check (inspection_type is null or inspection_type in ('Category 1', 'Category 5', 'Acceptance Test', 'Periodic Inspection'));

create index if not exists outbound_businesses_product_type_idx
  on public.outbound_businesses (product_type);

create index if not exists outbound_invoices_expected_payment_date_idx
  on public.outbound_invoices (business_id, expected_payment_date)
  where expected_payment_date is not null and status in ('unpaid', 'payment_link_sent');

update public.outbound_businesses
set agent_display_name = 'Sophia',
    retell_voice_id = coalesce(retell_voice_id, '11labs-Sloane'),
    product_type = 'elevator_inspection',
    default_inspection_type = coalesce(default_inspection_type, 'Category 1'),
    days_after_inspection_first_call = coalesce(days_after_inspection_first_call, 14),
    very_overdue_threshold_days = coalesce(very_overdue_threshold_days, 45)
where is_demo = true;

update public.outbound_invoices as invoice
set inspection_type = coalesce(invoice.inspection_type, business.default_inspection_type, 'Category 1')
from public.outbound_businesses as business
where invoice.business_id = business.id
  and invoice.inspection_type is null;

alter table public.outbound_businesses enable row level security;
alter table public.outbound_invoices enable row level security;
revoke all on public.outbound_businesses from anon, authenticated;
revoke all on public.outbound_invoices from anon, authenticated;
