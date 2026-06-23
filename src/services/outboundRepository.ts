import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";
import type { OutboundCsvRow } from "./outboundCsv";
import type { OutboundFollowupSeed } from "./outboundFollowups";
import type { OutboundOutcome } from "./outboundOutcomes";
import type { OutboundBusinessCsvRow } from "./outboundBusinessCsv";
import { resolveOutboundCallback } from "./outboundCallbacks";

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
      .select("*, outbound_customers(id,first_name,last_name,phone_number,email,timezone,outreach_paused,notes,payment_contact_preference,preferred_email,preferred_phone_number,contact_update_note,imported_last_payment_date), outbound_businesses(id,business_name,callback_number,human_transfer_number), outbound_payment_links(id,url,status,expires_at,created_at,paid_at,sent_via,stripe_checkout_session_id), outbound_call_attempts(id,status,outcome,summary,analysis,duration_ms,created_at), outbound_followup_tasks(task_type,scheduled_for,status,reason)")
      .order("created_at", { ascending: false }),
  );
}

export async function listOutboundDashboardData(limit = 100) {
  const client = db();
  const boundedLimit = Math.max(1, Math.min(limit, 200));
  const [invoiceResult, callResult, paymentResult, eventResult, businessResult, followupResult] = await Promise.all([
    client
      .from("outbound_invoices")
      .select("*, outbound_customers(id,first_name,last_name,phone_number,email,timezone,outreach_paused,pause_reason,notes,payment_contact_preference,preferred_email,preferred_phone_number,contact_update_note,imported_last_payment_date), outbound_businesses(id,business_name,callback_number,human_transfer_number), outbound_payment_links(id,url,status,expires_at,created_at,paid_at,sent_via,stripe_checkout_session_id), outbound_call_attempts(id,status,outcome,summary,analysis,duration_ms,created_at), outbound_followup_tasks(id,task_type,scheduled_for,status,reason)")
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
    client.from("outbound_businesses").select("*").order("created_at", { ascending: true }),
    client
      .from("outbound_followup_tasks")
      .select("*, outbound_invoices(id,invoice_id), outbound_customers(id,first_name,last_name,phone_number)")
      .order("scheduled_for", { ascending: true })
      .limit(boundedLimit),
  ]);
  if (invoiceResult.error) throw new OutboundDatabaseError(invoiceResult.error.message);
  if (callResult.error) throw new OutboundDatabaseError(callResult.error.message);
  if (paymentResult.error) throw new OutboundDatabaseError(paymentResult.error.message);
  if (eventResult.error) throw new OutboundDatabaseError(eventResult.error.message);
  if (businessResult.error) throw new OutboundDatabaseError(businessResult.error.message);
  if (followupResult.error) throw new OutboundDatabaseError(followupResult.error.message);
  const invoices = invoiceResult.data ?? [];
  const invoicesWithAccountSummary = invoices.map((invoice) => {
    const accountInvoices = invoices.filter((candidate) => candidate.customer_id === invoice.customer_id);
    const open = accountInvoices.filter((candidate) => ["unpaid", "payment_link_sent"].includes(candidate.status));
    const paid = accountInvoices.filter((candidate) => candidate.status === "paid" && candidate.paid_at).sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));
    return {
      ...invoice,
      account_summary: {
        open_invoice_count: open.length,
        total_amount_due_cents: open.reduce((sum, candidate) => sum + Number(candidate.amount_due_cents || 0), 0),
        oldest_invoice_date: open.map((candidate) => candidate.original_due_date).filter(Boolean).sort()[0] ?? null,
        most_recent_invoice_date: open.map((candidate) => candidate.original_due_date).filter(Boolean).sort().at(-1) ?? null,
        last_payment_date: paid[0]?.paid_at ?? invoice.outbound_customers?.imported_last_payment_date ?? null,
      },
    };
  });
  return {
    invoices: invoicesWithAccountSummary,
    calls: callResult.data ?? [],
    payment_links: paymentResult.data ?? [],
    events: eventResult.data ?? [],
    businesses: businessResult.data ?? [],
    followups: followupResult.data ?? [],
  };
}

export async function getOutboundInvoiceContext(invoiceId: string) {
  const client = db();
  const invoice = unwrap(
    await client.from("outbound_invoices").select("*").eq("id", invoiceId).maybeSingle(),
    true,
  ) as Record<string, unknown>;
  const [customerResult, businessResult, activeCallResult, paymentLinkResult, accountInvoiceResult] = await Promise.all([
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
    client
      .from("outbound_invoices")
      .select("id,invoice_id,status,amount_due_cents,currency,original_due_date,paid_at,service_description")
      .eq("customer_id", invoice.customer_id)
      .order("original_due_date", { ascending: true }),
  ]);
  if (accountInvoiceResult.error) throw new OutboundDatabaseError(accountInvoiceResult.error.message);
  const accountInvoices = (accountInvoiceResult.data ?? []) as Array<Record<string, unknown>>;
  const openInvoices = accountInvoices.filter((item) => ["unpaid", "payment_link_sent"].includes(String(item.status)));
  const paidDates = accountInvoices
    .map((item) => (item.status === "paid" && item.paid_at ? String(item.paid_at) : null))
    .filter((value): value is string => Boolean(value))
    .sort();
  return {
    invoice,
    customer: unwrap(customerResult, true) as Record<string, unknown>,
    business: unwrap(businessResult, true) as Record<string, unknown>,
    activeCall: activeCallResult.data as Record<string, unknown> | null,
    paymentLink: paymentLinkResult.data as Record<string, unknown> | null,
    account: {
      openInvoices,
      openInvoiceCount: openInvoices.length,
      totalAmountDueCents: openInvoices.reduce((sum, item) => sum + Number(item.amount_due_cents || 0), 0),
      oldestInvoiceDate: openInvoices[0]?.original_due_date ?? null,
      mostRecentInvoiceDate: openInvoices.at(-1)?.original_due_date ?? null,
      selectedInvoiceIsMostRecent: String(openInvoices.at(-1)?.id ?? "") === String(invoice.id),
      lastPaymentDate: paidDates.at(-1) ?? null,
    },
  };
}

export async function getOutboundBusinessSettings(id: string) {
  return unwrap(await db().from("outbound_businesses").select("*").eq("id", id).maybeSingle(), true) as Record<string, unknown>;
}

export async function updateOutboundBusinessSettings(id: string, patch: Record<string, unknown>) {
  return unwrap(
    await db().from("outbound_businesses").update(patch).eq("id", id).select("*").maybeSingle(),
    true,
  ) as Record<string, unknown>;
}

export async function createOutboundDemoCallAuthorization(input: {
  businessId: string;
  phoneNumber: string;
  demoCallMode: string;
  scenario?: string | null;
  expiresAt: string;
}) {
  return unwrap(
    await db()
      .from("outbound_demo_call_authorizations")
      .insert({
        business_id: input.businessId,
        phone_number: input.phoneNumber,
        demo_call_mode: input.demoCallMode,
        scenario: input.scenario || null,
        expires_at: input.expiresAt,
      })
      .select("*")
      .single(),
  ) as Record<string, unknown>;
}

export async function listOutboundDemoCallAuthorizations(businessId?: string) {
  let query = db()
    .from("outbound_demo_call_authorizations")
    .select("*")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(25);
  if (businessId) query = query.eq("business_id", businessId);
  const result = await query;
  if (result.error) throw new OutboundDatabaseError(result.error.message);
  return result.data ?? [];
}

export async function getOutboundDemoCallAuthorization(id: string) {
  return unwrap(
    await db().from("outbound_demo_call_authorizations").select("*").eq("id", id).maybeSingle(),
    true,
  ) as Record<string, unknown>;
}

export async function revokeOutboundDemoCallAuthorization(id: string) {
  return unwrap(
    await db()
      .from("outbound_demo_call_authorizations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle(),
    true,
  ) as Record<string, unknown>;
}

export async function touchOutboundDemoCallAuthorization(id: string) {
  const current = await getOutboundDemoCallAuthorization(id);
  return unwrap(
    await db()
      .from("outbound_demo_call_authorizations")
      .update({
        last_used_at: new Date().toISOString(),
        uses_count: Number(current.uses_count || 0) + 1,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle(),
    true,
  ) as Record<string, unknown>;
}

export async function importOutboundBusinesses(rows: OutboundBusinessCsvRow[], dryRun: boolean) {
  if (dryRun) return { dry_run: true, rows_valid: rows.length, businesses_created: 0, businesses_updated: 0, rows_skipped: 0 };
  const client = db();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const existing = (
      await client.from("outbound_businesses").select("*").ilike("business_name", row.business_name).limit(1).maybeSingle()
    ).data as Record<string, unknown> | null;
    const payload = { ...row, is_demo: true };
    if (!existing) {
      unwrap(await client.from("outbound_businesses").insert(payload).select("*").single());
      created += 1;
      continue;
    }
    const changed = Object.entries(payload).some(([key, value]) => JSON.stringify(existing[key]) !== JSON.stringify(value));
    if (!changed) {
      skipped += 1;
      continue;
    }
    unwrap(await client.from("outbound_businesses").update(payload).eq("id", existing.id).select("*").single());
    updated += 1;
  }
  return {
    dry_run: false,
    rows_valid: rows.length,
    businesses_created: created,
    businesses_updated: updated,
    rows_skipped: skipped,
  };
}

export async function getOutboundFollowupTask(id: string) {
  return unwrap(
    await db().from("outbound_followup_tasks").select("*").eq("id", id).maybeSingle(),
    true,
  ) as Record<string, unknown>;
}

export async function updateOutboundFollowupTask(id: string, patch: Record<string, unknown>) {
  return unwrap(
    await db().from("outbound_followup_tasks").update(patch).eq("id", id).select("*").maybeSingle(),
    true,
  ) as Record<string, unknown>;
}

export async function completeOutboundCallbackForAttempt(callAttemptId: string) {
  const result = await db()
    .from("outbound_followup_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("source_call_attempt_id", callAttemptId)
    .eq("task_type", "callback")
    .eq("status", "in_progress")
    .select("id");
  if (result.error) throw new OutboundDatabaseError(result.error.message);
  return result.data ?? [];
}

export async function createOutboundCallbackTask(input: {
  businessId: string;
  customerId: string;
  invoiceId: string;
  scheduledFor: string;
  timezone: string;
  reason: string;
  confirmationText: string;
  sourceCallAttemptId?: string;
  sourceRetellCallId?: string;
}) {
  const client = db();
  const existing = await client
    .from("outbound_followup_tasks")
    .select("*")
    .eq("invoice_id", input.invoiceId)
    .eq("task_type", "callback")
    .eq("scheduled_for", input.scheduledFor)
    .maybeSingle();
  if (existing.error) throw new OutboundDatabaseError(existing.error.message);
  if (existing.data) return existing.data as Record<string, unknown>;

  return unwrap(
    await client
      .from("outbound_followup_tasks")
      .insert({
        business_id: input.businessId,
        customer_id: input.customerId,
        invoice_id: input.invoiceId,
        task_type: "callback",
        scheduled_for: input.scheduledFor,
        status: "pending",
        attempt_number: 1,
        reason: "callback_requested",
        callback_timezone: input.timezone,
        callback_reason: input.reason,
        callback_confirmation_text: input.confirmationText,
        source_call_attempt_id: input.sourceCallAttemptId || null,
        source_retell_call_id: input.sourceRetellCallId || null,
      })
      .select("*")
      .single(),
  ) as Record<string, unknown>;
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

export async function updateOutboundDemoDetails(input: {
  businessId: string;
  customerId: string;
  invoiceId: string;
  businessPatch: Record<string, unknown>;
  customerPatch: Record<string, unknown>;
  invoicePatch: Record<string, unknown>;
}) {
  const client = db();
  const cleanPatch = (patch: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const businessPatch = cleanPatch(input.businessPatch);
  const customerPatch = cleanPatch(input.customerPatch);
  const invoicePatch = cleanPatch(input.invoicePatch);
  const [businessResult, customerResult, invoiceResult] = await Promise.all([
    Object.keys(businessPatch).length
      ? client
          .from("outbound_businesses")
          .update(businessPatch)
          .eq("id", input.businessId)
          .select("*")
          .maybeSingle()
      : client.from("outbound_businesses").select("*").eq("id", input.businessId).maybeSingle(),
    Object.keys(customerPatch).length
      ? client
          .from("outbound_customers")
          .update(customerPatch)
          .eq("id", input.customerId)
          .select("*")
          .maybeSingle()
      : client.from("outbound_customers").select("*").eq("id", input.customerId).maybeSingle(),
    Object.keys(invoicePatch).length
      ? client
          .from("outbound_invoices")
          .update(invoicePatch)
          .eq("id", input.invoiceId)
          .neq("status", "paid")
          .select("*")
          .maybeSingle()
      : client.from("outbound_invoices").select("*").eq("id", input.invoiceId).maybeSingle(),
  ]);
  return {
    business: unwrap(businessResult, true),
    customer: unwrap(customerResult, true),
    invoice: unwrap(invoiceResult, true),
  };
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
      rows_skipped: 0,
      warnings: [],
    };
  }
  const client = db();
  let businesses = 0;
  let customers = 0;
  let invoices = 0;
  let customersUpdated = 0;
  let invoicesUpdated = 0;
  let rowsSkipped = 0;
  const warnings: string[] = [];

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
      payment_contact_preference: row.payment_contact_preference || existingCustomer?.payment_contact_preference || "none",
      imported_last_payment_date: row.last_payment_date || existingCustomer?.imported_last_payment_date || null,
    };
    const customer = unwrap(
      await client
        .from("outbound_customers")
        .upsert(customerPayload, { onConflict: "business_id,external_customer_id" })
        .select("*")
        .single(),
    ) as Record<string, unknown>;
    if (!existingCustomer) customers += 1;
    else {
      const changed = Object.entries(customerPayload).some(([key, value]) => JSON.stringify(existingCustomer[key]) !== JSON.stringify(value));
      if (changed) customersUpdated += 1;
    }

    const existingInvoice = (
      await client
        .from("outbound_invoices")
        .select("*")
        .eq("business_id", business.id)
        .eq("invoice_id", row.invoice_id)
        .maybeSingle()
    ).data as Record<string, unknown> | null;
    const invoiceStatus = existingInvoice?.status === "paid" ? "paid" : row.status;
    const savedInvoice = unwrap(
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
    ) as { id: string };
    if (!existingInvoice) invoices += 1;
    else {
      const invoiceChanged =
        Number(existingInvoice.amount_due_cents) !== row.amount_due_cents ||
        String(existingInvoice.original_due_date) !== row.original_due_date ||
        String(existingInvoice.service_description) !== row.service_description ||
        String(existingInvoice.status) !== invoiceStatus ||
        Boolean(row.notes && row.notes !== existingInvoice.notes);
      if (invoiceChanged) invoicesUpdated += 1;
      else rowsSkipped += 1;
    }
    if (row.payment_mailing_instructions && !business.payment_mailing_instructions) {
      await client
        .from("outbound_businesses")
        .update({ payment_mailing_instructions: row.payment_mailing_instructions })
        .eq("id", business.id)
        .is("payment_mailing_instructions", null);
      business.payment_mailing_instructions = row.payment_mailing_instructions;
    } else if (
      row.payment_mailing_instructions &&
      business.payment_mailing_instructions &&
      row.payment_mailing_instructions !== business.payment_mailing_instructions
    ) {
      warnings.push(`Invoice ${row.invoice_id}: mailing instructions did not match the existing business setting.`);
    }
    if (row.callback_preferred_time) {
      const match = row.callback_preferred_time.match(/^(\d{4}-?\d{2}-?\d{2})\s+(.+)$/);
      const resolution = match
        ? resolveOutboundCallback({
            datePhrase: match[1],
            timePhrase: match[2],
            timezone: row.timezone,
            referenceTime: new Date(),
          })
        : null;
      if (resolution?.ok) {
        const existingCallback = await client
          .from("outbound_followup_tasks")
          .select("id")
          .eq("invoice_id", savedInvoice.id)
          .eq("task_type", "callback")
          .eq("scheduled_for", resolution.scheduledFor)
          .maybeSingle();
        if (!existingCallback.data) {
          await createOutboundCallbackTask({
            businessId: String(business.id),
            customerId: String(customer.id),
            invoiceId: savedInvoice.id,
            scheduledFor: resolution.scheduledFor,
            timezone: resolution.timezone,
            reason: "imported_callback_preference",
            confirmationText: `Imported preference: ${row.callback_preferred_time}`,
          });
        }
      } else {
        warnings.push(`Invoice ${row.invoice_id}: callback_preferred_time was not an eligible future callback time.`);
      }
    }
  }

  for (const row of rows) {
    if (row.open_invoice_count_hint === null && row.total_amount_due_cents_hint === null) continue;
    const business = await client.from("outbound_businesses").select("id").ilike("business_name", row.business_name).limit(1).maybeSingle();
    const customer = business.data
      ? await client.from("outbound_customers").select("id").eq("business_id", business.data.id).eq("external_customer_id", row.external_customer_id).maybeSingle()
      : { data: null };
    if (!customer.data) continue;
    const open = await client.from("outbound_invoices").select("amount_due_cents").eq("customer_id", customer.data.id).in("status", ["unpaid", "payment_link_sent"]);
    const actualCount = open.data?.length ?? 0;
    const actualTotal = (open.data ?? []).reduce((sum, item) => sum + Number(item.amount_due_cents), 0);
    if (row.open_invoice_count_hint !== null && row.open_invoice_count_hint !== actualCount) {
      warnings.push(`Customer ${row.external_customer_id}: open_invoice_count hint ${row.open_invoice_count_hint} did not match derived count ${actualCount}.`);
    }
    if (row.total_amount_due_cents_hint !== null && row.total_amount_due_cents_hint !== actualTotal) {
      warnings.push(`Customer ${row.external_customer_id}: total_amount_due hint did not match the derived invoice total.`);
    }
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
    rows_skipped: rowsSkipped,
    warnings,
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
  if (["mail_check_requested", "mail_instructions_requested"].includes(input.outcome)) {
    await client.from("outbound_customers").update({ payment_contact_preference: "mail_check" }).eq("id", input.customerId);
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
