-- Add destination protection without relaxing any existing recipient constraint.
-- Approval records are provisioned privately by an operator, outside the application.
create table public.outbound_review_recipient_approvals (
 business_id uuid primary key references public.outbound_businesses(id) on delete restrict,
 recipient text not null,
 approved_at timestamptz not null default now(),
 unique(business_id,recipient)
);
-- Existing settings already passed the previously enforced exact-recipient restriction.
insert into public.outbound_review_recipient_approvals(business_id,recipient)
 select business_id,reminder_recipient from public.outbound_review_settings;
alter table public.outbound_review_settings add constraint outbound_review_settings_approved_recipient foreign key(business_id,reminder_recipient) references public.outbound_review_recipient_approvals(business_id,recipient);
alter table public.outbound_review_runs add constraint outbound_review_runs_approved_recipient foreign key(business_id,recipient) references public.outbound_review_recipient_approvals(business_id,recipient);
alter table public.outbound_review_recipient_approvals enable row level security;
revoke all on public.outbound_review_recipient_approvals from public,anon,authenticated,service_role;
grant select on public.outbound_review_recipient_approvals to service_role;
