-- Preserve distinct service date without inferring legacy values.
alter table public.outbound_invoices add column if not exists inspection_date date;
comment on column public.outbound_invoices.inspection_date is 'Verified source service/inspection date; never inferred from invoice issue date or due date.';
