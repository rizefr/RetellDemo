-- Correct the demo RPC to the verified deployed source identity columns.
-- Earlier release referenced legacy columns absent from the deployed invoice table.
-- Row locks protect against a payment/source/business change between validation and save.
create or replace function public.outbound_update_demo_details(
  p_business_id uuid, p_customer_id uuid, p_invoice_id uuid,
  p_business_patch jsonb, p_customer_patch jsonb, p_invoice_patch jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business public.outbound_businesses%rowtype;
  v_customer public.outbound_customers%rowtype;
  v_invoice public.outbound_invoices%rowtype;
begin
  if p_business_patch is null or jsonb_typeof(p_business_patch) <> 'object' then
    raise exception using errcode = 'PT400', message = 'Demo patches must be JSON objects';
  end if;
  if exists (select 1 from jsonb_object_keys(p_business_patch) as k(key)
    where not (key = any(array['business_name', 'payment_mailing_instructions']::text[]))) then
    raise exception using errcode = 'PT400', message = 'Unsupported demo business field';
  end if;
  if p_customer_patch is null or jsonb_typeof(p_customer_patch) <> 'object' then
    raise exception using errcode = 'PT400', message = 'Demo patches must be JSON objects';
  end if;
  if exists (select 1 from jsonb_object_keys(p_customer_patch) as k(key)
    where not (key = any(array['first_name', 'last_name', 'account_company_name', 'phone_number', 'email', 'preferred_email', 'preferred_phone_number', 'payment_contact_preference']::text[]))) then
    raise exception using errcode = 'PT400', message = 'Unsupported demo customer field';
  end if;
  if p_invoice_patch is null or jsonb_typeof(p_invoice_patch) <> 'object' then
    raise exception using errcode = 'PT400', message = 'Demo patches must be JSON objects';
  end if;
  if exists (select 1 from jsonb_object_keys(p_invoice_patch) as k(key)
    where not (key = any(array['invoice_id', 'amount_due_cents', 'inspection_date', 'invoice_date', 'original_due_date', 'service_description', 'inspection_type', 'expected_payment_date', 'demo_call_mode', 'previous_call_date', 'followup_reason', 'prior_concern_note', 'preferred_payment_method', 'callback_details']::text[]))) then
    raise exception using errcode = 'PT400', message = 'Unsupported demo invoice field';
  end if;

  -- Lock the invoice first, as the payment-confirmation RPC does. A save that
  -- waits for a concurrent payment sees the committed paid row and rejects it.
  select * into v_invoice from public.outbound_invoices where id = p_invoice_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Demo invoice not found';
  end if;
  if v_invoice.business_id is distinct from p_business_id or v_invoice.customer_id is distinct from p_customer_id then
    raise exception using errcode = 'PT403', message = 'Demo record associations do not match';
  end if;
  select * into v_business from public.outbound_businesses where id = p_business_id for update;
  if not found then
    raise exception using errcode = 'PT403', message = 'Demo record associations do not match';
  end if;
  select * into v_customer from public.outbound_customers where id = p_customer_id and business_id = p_business_id for update;
  if not found then
    raise exception using errcode = 'PT403', message = 'Demo record associations do not match';
  end if;
  if v_business.is_demo is distinct from true or v_invoice.source_provider is distinct from 'local'
    or v_invoice.source_realm_id is not null or v_invoice.provider_invoice_id is not null
    or v_invoice.provider_customer_id is not null then
    raise exception using errcode = 'PT409', message = 'Presentation edits require isolated demo records';
  end if;
  if v_invoice.status = 'paid' then
    raise exception using errcode = 'PT409', message = 'Paid invoices cannot be edited in Presentation Mode';
  end if;

  -- Populate typed copies to preserve omitted values and explicit nulls. Only
  -- the listed columns below are writable; IDs, source and payment state never are.
  if p_business_patch <> '{}'::jsonb then
    v_business := jsonb_populate_record(v_business, p_business_patch);
    update public.outbound_businesses set
      business_name = v_business.business_name,
      payment_mailing_instructions = v_business.payment_mailing_instructions
    where id = p_business_id and is_demo = true
    returning * into v_business;
    if not found then
      raise exception using errcode = 'PT409', message = 'Demo records changed during save; no edits were saved';
    end if;
  end if;
  if p_customer_patch <> '{}'::jsonb then
    v_customer := jsonb_populate_record(v_customer, p_customer_patch);
    update public.outbound_customers set
      first_name = v_customer.first_name,
      last_name = v_customer.last_name,
      account_company_name = v_customer.account_company_name,
      phone_number = v_customer.phone_number,
      email = v_customer.email,
      preferred_email = v_customer.preferred_email,
      preferred_phone_number = v_customer.preferred_phone_number,
      payment_contact_preference = v_customer.payment_contact_preference
    where id = p_customer_id and business_id = p_business_id
    returning * into v_customer;
    if not found then
      raise exception using errcode = 'PT409', message = 'Demo records changed during save; no edits were saved';
    end if;
  end if;
  if p_invoice_patch <> '{}'::jsonb then
    v_invoice := jsonb_populate_record(v_invoice, p_invoice_patch);
    update public.outbound_invoices set
      invoice_id = v_invoice.invoice_id,
      amount_due_cents = v_invoice.amount_due_cents,
      inspection_date = v_invoice.inspection_date,
      invoice_date = v_invoice.invoice_date,
      original_due_date = v_invoice.original_due_date,
      service_description = v_invoice.service_description,
      inspection_type = v_invoice.inspection_type,
      expected_payment_date = v_invoice.expected_payment_date,
      demo_call_mode = v_invoice.demo_call_mode,
      previous_call_date = v_invoice.previous_call_date,
      followup_reason = v_invoice.followup_reason,
      prior_concern_note = v_invoice.prior_concern_note,
      preferred_payment_method = v_invoice.preferred_payment_method,
      callback_details = v_invoice.callback_details
    where id = p_invoice_id and business_id = p_business_id and customer_id = p_customer_id
      and source_provider = 'local' and source_realm_id is null
      and provider_invoice_id is null and provider_customer_id is null and status <> 'paid'
    returning * into v_invoice;
    if not found then
      raise exception using errcode = 'PT409', message = 'Demo records changed during save; no edits were saved';
    end if;
  end if;
  return jsonb_build_object('business', to_jsonb(v_business), 'customer', to_jsonb(v_customer), 'invoice', to_jsonb(v_invoice));
end;
$$;

revoke all on function public.outbound_update_demo_details(uuid, uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.outbound_update_demo_details(uuid, uuid, uuid, jsonb, jsonb, jsonb)
  to service_role;
