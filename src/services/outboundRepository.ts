import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";
import type { OutboundCsvRow } from "./outboundCsv";
import type { OutboundFollowupSeed } from "./outboundFollowups";
import type { OutboundOutcome } from "./outboundOutcomes";

export class OutboundDatabaseError extends Error {
  constructor(message: string, public readonly status = 500) {
    super(message);
  }
}

function db(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) throw new OutboundDatabaseError("Supabase service-role configuration is required", 503);
  return client;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, notFound = false): T {
  if (result.error) throw new OutboundDatabaseError(result.error.message);
  if (result.data === null) throw new OutboundDatabaseError(notFound ? "Outbound record not found" : "No data returned", notFound ? 404 : 500);
  return result.data;
}

export async function listOutboundCustomers() {
  return unwrap(
    await db()
      .from("outbound_customers")
      .select("*, outbound_invoices(id,invoice_id,amount_due_cents,currency,status,notes,paid_at), outbound_call_attempts(status,outcome,created_at), outbound_followup_tasks(task_type,scheduled_for,status)")
      .order("created_at", { ascending: false }),
  );
}

export async function listOutboundInvoices() {
  return unwrap(
    await db()
      .from("outbound_invoices")
      .select("*, outbound_customers(id,first_name,last_name,phone_number,email,timezone,outreach_paused,notes), outbound_businesses(id,business_name,callback_number,human_transfer_number), outbound_payment_links(id,url,status,expires_at,created_at,paid_at,sent_via,stripe_checkout_session_id), outbound_call_attempts(id,status,outcome,summary,analysis,duration_ms,created_at), outbound_followup_tasks(task_type,scheduled_for,status,reason)")
      .order("created_at", { ascending: false }),
  );
}

export async function listOutboundDashboardData(limit = 100) {
  const client = db();
  const boundedLimit = Math.max(1, Math.min(limit, 200));
  const [invoiceResult, callResult, paymentResult, eventResult] = await Promise.all([
    client
      .from("outbound_invoices")
      .select("*, outbound_customers(id,first_name,last_name,phone_number,email,timezone,outreach_paused,pause_reason,notes), outbound_businesses(id,business_name,callback_number,human_transfer_number), outbound_payment_links(id,url,status,expires_at,created_at,paid_at,sent_via,stripe_checkout_session_id), outbound_call_attempts(id,status,outcome,summary,analysis,duration_ms,created_at), outbound_followup_tasks(id,task_type,scheduled_for,status,reason)")
      .order("created_at", { ascending: false }),
    client
      .from("outbound_call_attempts")
      .select("*, outbound_customers(id,first_name,last_name), outbound_invoices(id,invoice_id,service_description,amount_due_cents,currency,status)")
      .order("created_at", { ascending: false })
      .limit(boundedLimit),
    client
      .from("outbound_payment_links")
      .select("*, outbound_invoices(id,invoice_id,service_description,status), outbound_customers(id,first_name,last_name)")
      .order("created_at", { ascending: false })
      .limit(boundedLimit),
    client
      .from("outbound_events")
      .select("*, outbound_invoices(id,invoice_id), outbound_customers(id,first_name,last_name)")
      .order("created_at", { ascending: false })
      .limit(boundedLimit),
  ]);
  if (invoiceResult.error) throw new OutboundDatabaseError(invoiceResult.error.message);
  if (callResult.error) throw new OutboundDatabaseError(callResult.error.message);
  if (paymentResult.error) throw new OutboundDatabaseError(paymentResult.error.message);
  if (eventResult.error) throw new OutboundDatabaseError(eventResult.error.message);
  return {
    invoices: invoiceResult.data ?? [],
    calls: callResult.data ?? [],
    payment_links: paymentResult.data ?? [],
    events: eventResult.data ?? [],
  };
}

export async function getOutboundInvoiceContext(invoiceId: string) {
  const client = db();
  const invoice = unwrap(
    await client.from("outbound_invoices").select("*").eq("id", invoiceId).maybeSingle(),
    true,
  ) as Record<string, unknown>;
  const [customerResult, businessResult, activeCallResult, paymentLinkResult] = await Promise.all([
    client.from("outbound_customers").select("*").eq("id", invoice.customer_id).maybeSingle(),
    client.from("outbound_businesses").select("*").eq("id", invoice.business_id).maybeSingle(),
    client
      .from("outbound_call_attempts")
      .select("id,status")
      .eq("invoice_id", invoiceId)
      .in("status", ["starting", "registered", "ongoing"])
      .maybeSingle(),
    client
      .from("outbound_payment_links")
      .select("*")
      .eq("invoice_id", invoiceId)
      .eq("status", "open")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    invoice,
    customer: unwrap(customerResult, true) as Record<string, unknown>,
    business: unwrap(businessResult, true) as Record<string, unknown>,
    activeCall: activeCallResult.data as Record<string, unknown> | null,
    paymentLink: paymentLinkResult.data as Record<string, unknown> | null,
  };
}

export async function updateOutboundCustomer(id: string, patch: Record<string, unknown>) {
  return unwrap(await db().from("outbound_customers").update(patch).eq("id", id).select("*").maybeSingle(), true);
}

export async function updateOutboundInvoice(id: string, patch: Record<string, unknown>) {
  const current = unwrap(
    await db().from("outbound_invoices").select("status").eq("id", id).maybeSingle(),
    true,
  ) as { status: string };
  if (current.status === "paid" && patch.status && patch.status !== "paid") {
    throw new OutboundDatabaseError("Paid invoices cannot be reopened by this demo", 409);
  }
  return unwrap(await db().from("outbound_invoices").update(patch).eq("id", id).select("*").maybeSingle(), true);
}

export async function setOutboundPause(id: string, paused: boolean, reason: string | null) {
  return updateOutboundCustomer(id, {
    outreach_paused: paused,
    pause_reason: paused ? reason || "admin_paused" : null,
  });
}

export async function importOutboundRows(rows: OutboundCsvRow[], dryRun: boolean) {
  if (dryRun) {
    return {
      dry_run: true,
      rows_valid: rows.length,
      businesses: 0,
      customers: 0,
      invoices: 0,
      businesses_created: 0,
      customers_created: 0,
      customers_updated: 0,
      invoices_created: 0,
      invoices_updated: 0,
    };
  }
  const client = db();
  let businesses = 0;
  let customers = 0;
  let invoices = 0;
  let customersUpdated = 0;
  let invoicesUpdated = 0;

  for (const row of rows) {
    let business = (
      await client.from("outbound_businesses").select("*").ilike("business_name", row.business_name).limit(1).maybeSingle()
    ).data as Record<string, unknown> | null;
    if (!business) {
      business = unwrap(
        await client
          .from("outbound_businesses")
          .insert({ business_name: row.business_name, industry: "elevator_inspection", is_demo: true })
          .select("*")
          .single(),
      ) as Record<string, unknown>;
      businesses += 1;
    }

    const existingCustomer = (
      await client
        .from("outbound_customers")
        .select("*")
        .eq("business_id", business.id)
        .eq("external_customer_id", row.external_customer_id)
        .maybeSingle()
    ).data as Record<string, unknown> | null;
    const customerPayload = {
      business_id: business.id,
      external_customer_id: row.external_customer_id,
      first_name: row.first_name,
      last_name: row.last_name,
      phone_number: row.phone_number,
      email: row.email || null,
      mailing_address: row.mailing_address || null,
      timezone: row.timezone,
      outreach_paused: Boolean(existingCustomer?.outreach_paused) || row.outreach_paused,
      pause_reason: existingCustomer?.pause_reason ?? null,
      notes: row.notes || existingCustomer?.notes || null,
    };
    const customer = unwrap(
      await client
        .from("outbound_customers")
        .upsert(customerPayload, { onConflict: "business_id,external_customer_id" })
        .select("*")
        .single(),
    ) as Record<string, unknown>;
    if (!existingCustomer) customers += 1;
    else customersUpdated += 1;

    const existingInvoice = (
      await client
        .from("outbound_invoices")
        .select("*")
        .eq("business_id", business.id)
        .eq("invoice_id", row.invoice_id)
        .maybeSingle()
    ).data as Record<string, unknown> | null;
    const invoiceStatus = existingInvoice?.status === "paid" ? "paid" : row.status;
    unwrap(
      await client
        .from("outbound_invoices")
        .upsert(
          {
            business_id: business.id,
            customer_id: customer.id,
            invoice_id: row.invoice_id,
            amount_due_cents: row.amount_due_cents,
            currency: "usd",
            original_due_date: row.original_due_date,
            service_description: row.service_description,
            status: invoiceStatus,
            notes: row.notes || existingInvoice?.notes || null,
            paid_at: existingInvoice?.paid_at ?? null,
          },
          { onConflict: "business_id,invoice_id" },
        )
        .select("id")
        .single(),
    );
    if (!existingInvoice) invoices += 1;
    else invoicesUpdated += 1;
  }

  return {
    dry_run: false,
    rows_valid: rows.length,
    businesses,
    customers,
    invoices,
    businesses_created: businesses,
    customers_created: customers,
    customers_updated: customersUpdated,
    invoices_created: invoices,
    invoices_updated: invoicesUpdated,
  };
}

export async function insertOutboundEvent(input: {
  business_id?: string | null;
  customer_id?: string | null;
  invoice_id?: string | null;
  event_type: string;
  source: string;
  external_event_id?: string | null;
  payload?: unknown;
}) {
  const result = await db().from("outbound_events").insert({ ...input, payload: input.payload ?? {} }).select("*").maybeSingle();
  if (result.error?.code === "23505") return null;
  return unwrap(result);
}

export async function createOutboundCallAttempt(input: Record<string, unknown>) {
  return unwrap(await db().from("outbound_call_attempts").insert(input).select("*").single()) as Record<string, unknown>;
}

export async function updateOutboundCallAttempt(id: string, patch: Record<string, unknown>) {
  return unwrap(
    await db().from("outbound_call_attempts").update(patch).eq("id", id).select("*").maybeSingle(),
    true,
  );
}

export async function findOutboundCallAttempt(retellCallId: string) {
  return (
    await db().from("outbound_call_attempts").select("*").eq("retell_call_id", retellCallId).maybeSingle()
  ).data as Record<string, unknown> | null;
}

export async function getOutboundCallAttempt(id: string) {
  return unwrap(
    await db().from("outbound_call_attempts").select("*").eq("id", id).maybeSingle(),
    true,
  ) as Record<string, unknown>;
}

export async function findOutboundCallAnalysisEvent(retellCallId: string) {
  const result = await db()
    .from("outbound_events")
    .select("payload")
    .eq("source", "retell")
    .eq("event_type", "call_analyzed")
    .contains("payload", { call: { call_id: retellCallId } })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new OutboundDatabaseError(result.error.message);
  return (result.data?.payload ?? null) as Record<string, unknown> | null;
}

export async function hasOutboundPaymentLinkAgreement(invoiceId: string): Promise<boolean> {
  const result = await db()
    .from("outbound_call_attempts")
    .select("id")
    .eq("invoice_id", invoiceId)
    .eq("outcome", "confirmed_payment_link_requested")
    .limit(1)
    .maybeSingle();
  if (result.error) throw new OutboundDatabaseError(result.error.message);
  return Boolean(result.data);
}

export async function nextOutboundAttemptNumber(invoiceId: string): Promise<number> {
  const result = await db()
    .from("outbound_call_attempts")
    .select("attempt_number")
    .eq("invoice_id", invoiceId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number((result.data as { attempt_number?: number } | null)?.attempt_number ?? 0) + 1;
}

export async function insertOutboundFollowups(
  ids: { businessId: string; customerId: string; invoiceId: string },
  tasks: OutboundFollowupSeed[],
) {
  const payload = tasks.map((task) => ({
    business_id: ids.businessId,
    customer_id: ids.customerId,
    invoice_id: ids.invoiceId,
    ...task,
  }));
  const result = await db()
    .from("outbound_followup_tasks")
    .upsert(payload, { onConflict: "invoice_id,task_type,scheduled_for", ignoreDuplicates: true })
    .select("*");
  if (result.error) throw new OutboundDatabaseError(result.error.message);
  return result.data ?? [];
}

export async function cancelOutboundFollowups(invoiceId: string, reason: string) {
  const result = await db()
    .from("outbound_followup_tasks")
    .update({ status: "cancelled", reason })
    .eq("invoice_id", invoiceId)
    .eq("status", "pending")
    .select("id");
  if (result.error) throw new OutboundDatabaseError(result.error.message);
  return result.data ?? [];
}

export async function recordOutboundOutcome(input: {
  callAttemptId?: string;
  invoiceId: string;
  customerId: string;
  outcome: OutboundOutcome;
  notes: string;
  pauseOutreach: boolean;
  invoiceStatus?: string;
}) {
  const client = db();
  if (input.callAttemptId) {
    await client
      .from("outbound_call_attempts")
      .update({ outcome: input.outcome, notes: input.notes || null })
      .eq("id", input.callAttemptId);
  }
  if (input.pauseOutreach) {
    await client
      .from("outbound_customers")
      .update({ outreach_paused: true, pause_reason: input.outcome })
      .eq("id", input.customerId);
  }
  if (input.invoiceStatus) {
    await client.from("outbound_invoices").update({ status: input.invoiceStatus }).eq("id", input.invoiceId).neq("status", "paid");
  }
  if (input.pauseOutreach || ["disputed", "manual_review"].includes(input.invoiceStatus ?? "")) {
    await cancelOutboundFollowups(input.invoiceId, input.outcome);
  }
}

export async function expireStaleOutboundPaymentLinks(invoiceId: string, now = new Date()) {
  const result = await db()
    .from("outbound_payment_links")
    .update({ status: "expired" })
    .eq("invoice_id", invoiceId)
    .eq("status", "open")
    .lte("expires_at", now.toISOString());
  if (result.error) throw new OutboundDatabaseError(result.error.message);
}

export async function getActiveOutboundPaymentLink(invoiceId: string, now = new Date()) {
  await expireStaleOutboundPaymentLinks(invoiceId, now);
  return (
    await db()
      .from("outbound_payment_links")
      .select("*")
      .eq("invoice_id", invoiceId)
      .eq("status", "open")
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ).data as Record<string, unknown> | null;
}

export async function createOutboundPaymentLinkRecord(input: Record<string, unknown>) {
  return unwrap(await db().from("outbound_payment_links").insert(input).select("*").single()) as Record<string, unknown>;
}

export async function updateOutboundPaymentLinkRecord(id: string, patch: Record<string, unknown>) {
  return unwrap(
    await db().from("outbound_payment_links").update(patch).eq("id", id).select("*").maybeSingle(),
    true,
  ) as Record<string, unknown>;
}

export async function markOutboundPaymentLinkDelivered(
  id: string,
  sentVia: "email" | "sms" | "manual",
) {
  return updateOutboundPaymentLinkRecord(id, {
    sent_via: sentVia,
    sent_at: new Date().toISOString(),
  });
}

export async function getOutboundInvoiceForPayment(id: string) {
  return unwrap(
    await db().from("outbound_invoices").select("*").eq("id", id).maybeSingle(),
    true,
  ) as Record<string, unknown>;
}

export async function markOutboundInvoicePaid(input: {
  externalEventId: string;
  invoiceId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  payload: unknown;
}) {
  const result = await db().rpc("outbound_mark_invoice_paid", {
    p_external_event_id: input.externalEventId,
    p_invoice_id: input.invoiceId,
    p_checkout_session_id: input.checkoutSessionId,
    p_payment_intent_id: input.paymentIntentId,
    p_payload: input.payload,
  });
  if (result.error) throw new OutboundDatabaseError(result.error.message);
  return result.data;
}
