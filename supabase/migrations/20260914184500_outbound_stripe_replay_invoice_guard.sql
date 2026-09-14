-- Reject a replay whose recorded Stripe event has no invoice as well as a different invoice.
-- Keep QuickBooks authoritative and require the invoice's recorded Stripe session.
create or replace function public.outbound_mark_invoice_paid(
  p_external_event_id text,
  p_invoice_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_payload jsonb
)
returns table(invoice_id uuid, already_paid boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.outbound_invoices%rowtype;
  v_existing_event uuid;
  v_event_invoice uuid;
begin
  select invoice.* into v_invoice
  from public.outbound_invoices as invoice
  where invoice.id = p_invoice_id
  for update;

  if not found then
    raise exception 'Outbound invoice not found';
  end if;

  if v_invoice.source_provider = 'quickbooks' then
    raise exception 'QuickBooks payment status cannot be changed by Stripe';
  end if;
  if p_checkout_session_id is null or not exists (
    select 1 from public.outbound_payment_links as link
    where link.invoice_id = v_invoice.id and link.business_id = v_invoice.business_id
      and link.customer_id = v_invoice.customer_id
      and link.stripe_checkout_session_id = p_checkout_session_id
      and coalesce(link.provider,'stripe') = 'stripe'
      and link.amount_cents = v_invoice.amount_due_cents
      and lower(link.currency) = lower(v_invoice.currency)
  ) then
    raise exception 'Stripe session does not match the recorded invoice payment link';
  end if;
  select event.id,event.invoice_id into v_existing_event,v_event_invoice
  from public.outbound_events as event
  where event.source = 'stripe' and event.external_event_id = p_external_event_id;
  if v_existing_event is not null then
    if v_event_invoice is distinct from v_invoice.id then raise exception 'Stripe event invoice mismatch'; end if;
    return query select v_invoice.id, true;
    return;
  end if;

  insert into public.outbound_events (
    business_id,
    customer_id,
    invoice_id,
    event_type,
    source,
    external_event_id,
    payload
  ) values (
    v_invoice.business_id,
    v_invoice.customer_id,
    v_invoice.id,
    'checkout.session.completed',
    'stripe',
    p_external_event_id,
    coalesce(p_payload, '{}'::jsonb)
  );

  update public.outbound_invoices as invoice
  set status = 'paid', paid_at = coalesce(invoice.paid_at, now())
  where invoice.id = v_invoice.id;

  update public.outbound_payment_links as payment_link
  set
    status = 'paid',
    paid_at = coalesce(payment_link.paid_at, now()),
    stripe_payment_intent_id = coalesce(p_payment_intent_id, payment_link.stripe_payment_intent_id)
  where payment_link.invoice_id = v_invoice.id
    and (
      payment_link.stripe_checkout_session_id = p_checkout_session_id
      or (p_checkout_session_id is null and payment_link.status in ('creating', 'open'))
    );

  update public.outbound_followup_tasks as followup
  set status = 'cancelled', reason = coalesce(followup.reason, 'invoice_paid')
  where followup.invoice_id = v_invoice.id and followup.status in ('pending','in_progress');

  return query select v_invoice.id, v_invoice.status = 'paid';
end;
$$;

revoke all on function public.outbound_mark_invoice_paid(text, uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.outbound_mark_invoice_paid(text, uuid, text, text, jsonb)
to service_role;
