-- Preserve every existing business value. Future companies are locked unless
-- an explicitly authorized demo creation path supplies true.
alter table public.outbound_businesses alter column outreach_enabled set default false;
