import express from "express";
import { env } from "../config/env";
import {
  customerPatchSchema,
  importCsvSchema,
  invoicePatchSchema,
  startBatchSchema,
  startCallSchema,
  uuidSchema,
  businessSettingsPatchSchema,
  followupPatchSchema,
  businessImportSchema,
  demoCallAuthorizationSchema,
  demoCallRunSchema,
  demoDetailsPatchSchema,
  quickBooksBusinessQuerySchema,
  quickBooksInvoiceLinkSchema,
} from "../schemas/outboundSchemas";
import {
  clearOutboundAdminCookie,
  createOutboundAdminCookie,
  isAuthorizedOutboundAdmin,
  requireOutboundAdmin,
  requireTrustedBrowserOrigin,
} from "../services/outboundAuth";
import {
  describeOutboundCallPreflight,
  inspectOutboundCallEligibility,
  startOutboundCall,
} from "../services/outboundCalls";
import { parseOutboundCsv } from "../services/outboundCsv";
import { redactOutboundEventPayload } from "../services/outboundCallAnalysis";
import { rebuildOutboundCallAnalysis } from "../services/outboundCallRepair";
import { validateBatchMode } from "../services/outboundEligibility";
import {
  importOutboundRows,
  insertOutboundEvent,
  listOutboundCustomers,
  listOutboundDashboardData,
  listOutboundInvoices,
  setOutboundPause,
  updateOutboundCustomer,
  updateOutboundInvoice,
  getOutboundBusinessSettings,
  updateOutboundBusinessSettings,
  getOutboundFollowupTask,
  updateOutboundFollowupTask,
  importOutboundBusinesses,
  createOutboundDemoCallAuthorization,
  listOutboundDemoCallAuthorizations,
  revokeOutboundDemoCallAuthorization,
  updateOutboundDemoDetails,
} from "../services/outboundRepository";
import { createOutboundCheckoutSession } from "../services/outboundStripe";
import { getOutboundSetupStatus } from "../services/outboundSetup";
import { validateOutboundBusinessSettingsPatch } from "../services/outboundBusinessSettings";
import { outboundBusinessRuntimeSettings } from "../services/outboundRuntimeSettings";
import { customerCsvTemplate, businessCsvTemplate } from "../services/outboundTemplates";
import { parseOutboundBusinessCsv } from "../services/outboundBusinessCsv";
import { resolveOutboundCallback } from "../services/outboundCallbacks";
import { normalizeOutboundDate } from "../services/outboundFormatting";
import {
  buildOutboundQuickBooksConnectUrl,
  buildOutboundQuickBooksStatus,
} from "../services/outboundQuickBooks";

export const outboundApiRouter = express.Router();
const DEMO_CALL_CONFIRMATION = "I AUTHORIZE THIS DEMO TEST CALL";

function parseDollarsToCents(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const normalized = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error("Invoice amount must be a positive dollar amount.");
  return Math.round(normalized * 100);
}

function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sendError(res: express.Response, error: unknown) {
  const status =
    typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 400;
  res.status(status).json({ error: error instanceof Error ? error.message : "Outbound request failed" });
}

outboundApiRouter.post("/auth/login", (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!isAuthorizedOutboundAdmin({ authorization: `Bearer ${token}` }, env.OUTBOUND_ADMIN_TOKEN)) {
    res.status(401).json({ error: "Invalid admin token" });
    return;
  }
  res.setHeader("Set-Cookie", createOutboundAdminCookie(env.OUTBOUND_ADMIN_TOKEN));
  res.json({ authenticated: true });
});

outboundApiRouter.post("/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearOutboundAdminCookie());
  res.json({ authenticated: false });
});

outboundApiRouter.use(requireOutboundAdmin);
outboundApiRouter.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  requireTrustedBrowserOrigin(req, res, next);
});

outboundApiRouter.get("/customers", async (_req, res) => {
  try {
    res.json({ customers: await listOutboundCustomers() });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.get("/invoices", async (_req, res) => {
  try {
    res.json({ invoices: await listOutboundInvoices() });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.get("/dashboard", async (_req, res) => {
  try {
    const dashboard = await listOutboundDashboardData();
    res.json({
      refreshed_at: new Date().toISOString(),
      ...dashboard,
      events: dashboard.events.map((event) => ({
        ...event,
        payload: redactOutboundEventPayload(event.payload),
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.get("/setup/status", async (req, res) => {
  try {
    const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol;
    res.json(await getOutboundSetupStatus(`${protocol}://${req.get("host")}`));
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.get("/templates/customers.csv", (_req, res) => {
  res.type("text/csv").attachment("outbound-customer-invoices-template.csv").send(customerCsvTemplate());
});

outboundApiRouter.get("/templates/business.csv", (_req, res) => {
  res.type("text/csv").attachment("outbound-business-setup-template.csv").send(businessCsvTemplate());
});

outboundApiRouter.get("/businesses/:id/settings", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const settings = await getOutboundBusinessSettings(id);
    res.json({ settings, readiness: outboundBusinessRuntimeSettings(settings) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.patch("/businesses/:id/settings", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const parsed = businessSettingsPatchSchema.parse(req.body);
    const { production_mode_confirmation, batch_limit_confirmation, ...requested } = parsed;
    const patch = validateOutboundBusinessSettingsPatch(requested, {
      production_mode_confirmation,
      batch_limit_confirmation,
    });
    const before = await getOutboundBusinessSettings(id);
    const settings = await updateOutboundBusinessSettings(id, patch);
    await insertOutboundEvent({
      business_id: id,
      event_type: "business_settings_updated",
      source: "admin",
      payload: { before: Object.fromEntries(Object.keys(patch).map((key) => [key, before[key]])), after: patch },
    });
    res.json({ settings, readiness: outboundBusinessRuntimeSettings(settings) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/businesses/import", async (req, res) => {
  try {
    const input = businessImportSchema.parse(req.body);
    const parsed = parseOutboundBusinessCsv(input.csv);
    if (parsed.errors.length) {
      res.status(422).json({ imported: false, errors: parsed.errors });
      return;
    }
    res.json({ imported: !input.dry_run, result: await importOutboundBusinesses(parsed.rows, input.dry_run) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.get("/demo-call/authorizations", async (req, res) => {
  try {
    const businessId = typeof req.query.business_id === "string" ? uuidSchema.parse(req.query.business_id) : undefined;
    res.json({ authorizations: await listOutboundDemoCallAuthorizations(businessId) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/demo-call/authorize-number", async (req, res) => {
  try {
    const input = demoCallAuthorizationSchema.parse(req.body);
    if (input.confirmation !== DEMO_CALL_CONFIRMATION) {
      res.status(400).json({ error: `Type ${DEMO_CALL_CONFIRMATION} to authorize this demo test number.` });
      return;
    }
    const business = await getOutboundBusinessSettings(input.business_id);
    const runtime = outboundBusinessRuntimeSettings(business);
    if (!runtime.testMode) {
      res.status(403).json({ error: "Presentation demo numbers require test mode." });
      return;
    }
    if (runtime.maxBatchSize !== 1) {
      res.status(403).json({ error: "Presentation demo numbers require maximum batch size 1." });
      return;
    }
    const expiresAt = new Date(Date.now() + input.ttl_minutes * 60_000).toISOString();
    const authorization = await createOutboundDemoCallAuthorization({
      businessId: input.business_id,
      phoneNumber: input.phone_number,
      demoCallMode: input.demo_call_mode,
      scenario: input.scenario || null,
      expiresAt,
    });
    await insertOutboundEvent({
      business_id: input.business_id,
      event_type: "demo_call_number_authorized",
      source: "admin",
      payload: {
        phone_number: input.phone_number,
        demo_call_mode: input.demo_call_mode,
        scenario: input.scenario || null,
        expires_at: expiresAt,
      },
    });
    res.status(201).json({ authorization });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/demo-call/authorizations/:id/revoke", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const authorization = await revokeOutboundDemoCallAuthorization(id);
    await insertOutboundEvent({
      business_id: String(authorization.business_id),
      event_type: "demo_call_number_revoked",
      source: "admin",
      payload: { authorization_id: id, phone_number: authorization.phone_number },
    });
    res.json({ authorization });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/demo-call/preflight", async (req, res) => {
  try {
    const input = demoCallRunSchema.parse(req.body);
    res.json(await describeOutboundCallPreflight(
      input.invoice_id,
      new Date(),
      input.after_hours_override,
      input.followup_task_id,
      input.demo_call_authorization_id,
    ));
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/demo-call/start", async (req, res) => {
  let context: Awaited<ReturnType<typeof inspectOutboundCallEligibility>>["context"] | null = null;
  try {
    const input = demoCallRunSchema.parse(req.body);
    const eligibility = await inspectOutboundCallEligibility(
      input.invoice_id,
      new Date(),
      input.after_hours_override,
      input.demo_call_authorization_id,
    );
    context = eligibility.context;
    await insertOutboundEvent({
      business_id: String(context.business.id),
      customer_id: String(context.customer.id),
      invoice_id: String(context.invoice.id),
      event_type: "demo_call_start_requested",
      source: "admin",
      payload: {
        eligible: eligibility.eligible,
        reason: eligibility.reason,
        followup_task_id: input.followup_task_id || null,
        demo_call_authorization_id: input.demo_call_authorization_id,
      },
    });
    if (!eligibility.eligible) throw new Error(`Outbound call blocked: ${eligibility.reason}`);
    const result = await startOutboundCall(
      input.invoice_id,
      input.after_hours_override,
      new Date(),
      input.followup_task_id,
      input.demo_call_authorization_id,
    );
    res.status(201).json(result);
  } catch (error) {
    if (context) {
      await insertOutboundEvent({
        business_id: String(context.business.id),
        customer_id: String(context.customer.id),
        invoice_id: String(context.invoice.id),
        event_type: "demo_call_start_blocked",
        source: "admin",
        payload: { reason: error instanceof Error ? error.message : "Outbound call failed" },
      }).catch(() => undefined);
    }
    sendError(res, error);
  }
});

outboundApiRouter.patch("/demo-details", async (req, res) => {
  try {
    const input = demoDetailsPatchSchema.parse(req.body);
    const normalizedOriginalDueDate = input.original_due_date ? normalizeOutboundDate(input.original_due_date) : undefined;
    if (input.original_due_date && !normalizedOriginalDueDate) throw new Error("Original due date must be YYYY-MM-DD or YYYYMMDD.");
    const normalizedPreviousCallDate =
      input.previous_call_date === null ? null : input.previous_call_date ? normalizeOutboundDate(input.previous_call_date) : undefined;
    if (input.previous_call_date && !normalizedPreviousCallDate) throw new Error("Previous call date must be YYYY-MM-DD or YYYYMMDD.");
    const normalizedExpectedPaymentDate =
      input.expected_payment_date === null
        ? null
        : input.expected_payment_date
          ? normalizeOutboundDate(input.expected_payment_date)
          : undefined;
    if (input.expected_payment_date && !normalizedExpectedPaymentDate) {
      throw new Error("Expected payment date must be YYYY-MM-DD or YYYYMMDD.");
    }
    const updated = await updateOutboundDemoDetails({
      businessId: input.business_id,
      customerId: input.customer_id,
      invoiceId: input.invoice_id,
      businessPatch: {
        business_name: input.business_name,
        payment_mailing_instructions: input.payment_mailing_instructions,
      },
      customerPatch: {
        first_name: input.first_name,
        last_name: input.last_name,
        phone_number: input.phone_number,
        email: blankToNull(input.email),
        preferred_email: blankToNull(input.preferred_email),
        preferred_phone_number: blankToNull(input.preferred_phone_number),
        payment_contact_preference: input.preferred_payment_method || undefined,
      },
      invoicePatch: {
        status: undefined,
        invoice_id: input.external_invoice_id,
        amount_due_cents: parseDollarsToCents(input.amount_due),
        original_due_date: normalizedOriginalDueDate,
        service_description: input.service_description,
        inspection_type: input.inspection_type,
        expected_payment_date: normalizedExpectedPaymentDate,
        demo_call_mode: input.demo_call_mode,
        previous_call_date: normalizedPreviousCallDate,
        followup_reason: input.followup_reason,
        prior_concern_note: input.prior_concern_note,
        preferred_payment_method: input.preferred_payment_method,
        callback_details: input.callback_details,
      },
    });
    await insertOutboundEvent({
      business_id: input.business_id,
      customer_id: input.customer_id,
      invoice_id: input.invoice_id,
      event_type: "demo_details_updated",
      source: "admin",
      payload: {
        demo_call_mode: input.demo_call_mode || null,
        payment_status_unchanged: true,
        fields: Object.keys(req.body || {}).filter((key) => !["business_id", "customer_id", "invoice_id"].includes(key)),
      },
    });
    res.json(updated);
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.get("/quickbooks/status", async (req, res) => {
  try {
    const query = quickBooksBusinessQuerySchema.parse(req.query);
    const business = await getOutboundBusinessSettings(query.business_id);
    res.json(buildOutboundQuickBooksStatus(business));
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.get("/quickbooks/connect", async (req, res) => {
  try {
    const query = quickBooksBusinessQuerySchema.parse(req.query);
    res.json({ url: buildOutboundQuickBooksConnectUrl(query.business_id) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.get("/quickbooks/callback", (_req, res) => {
  res.status(501).json({ error: "QuickBooks OAuth callback is scaffolded only; token exchange is not enabled in this demo pass." });
});

outboundApiRouter.post("/quickbooks/disconnect", async (req, res) => {
  try {
    const input = quickBooksBusinessQuerySchema.parse(req.body);
    const settings = await updateOutboundBusinessSettings(input.business_id, {
      quickbooks_connected: false,
      quickbooks_realm_id: null,
      quickbooks_access_token_present: false,
      quickbooks_refresh_token_present: false,
      quickbooks_disconnected_at: new Date().toISOString(),
    });
    await insertOutboundEvent({
      business_id: input.business_id,
      event_type: "quickbooks_disconnect_requested",
      source: "admin",
      payload: { connected: false },
    });
    res.json({ status: buildOutboundQuickBooksStatus(settings) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/quickbooks/invoice-link", async (req, res) => {
  try {
    const input = quickBooksInvoiceLinkSchema.parse(req.body);
    const business = await getOutboundBusinessSettings(input.business_id);
    const status = buildOutboundQuickBooksStatus(business);
    if (!status.connected) {
      res.status(409).json({ error: "QuickBooks not connected", status });
      return;
    }
    res.status(501).json({ error: "QuickBooks invoice/payment-link creation is scaffolded only.", status });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.patch("/customers/:id", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    res.json({ customer: await updateOutboundCustomer(id, customerPatchSchema.parse(req.body)) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.patch("/invoices/:id", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    res.json({ invoice: await updateOutboundInvoice(id, invoicePatchSchema.parse(req.body)) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/customers/import", async (req, res) => {
  try {
    const input = importCsvSchema.parse(req.body);
    const parsed = parseOutboundCsv(input.csv);
    if (parsed.errors.length) {
      res.status(422).json({ imported: false, errors: parsed.errors });
      return;
    }
    res.json({ imported: !input.dry_run, result: await importOutboundRows(parsed.rows, input.dry_run) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/customers/:id/pause", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : "admin_paused";
    res.json({ customer: await setOutboundPause(id, true, reason) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/customers/:id/resume", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    res.json({ customer: await setOutboundPause(id, false, null) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/invoices/:id/create-checkout-session", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    res.json(await createOutboundCheckoutSession(id, "admin"));
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.patch("/followups/:id", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const current = await getOutboundFollowupTask(id);
    const patch = followupPatchSchema.parse(req.body);
    let normalizedScheduledFor = patch.scheduled_for;
    if (patch.scheduled_for_local) {
      const [datePhrase, timePhrase] = patch.scheduled_for_local.split("T");
      const resolution = resolveOutboundCallback({
        datePhrase,
        timePhrase,
        timezone: patch.callback_timezone || String(current.callback_timezone || "America/New_York"),
        referenceTime: new Date(),
      });
      if (!resolution.ok) throw new Error(resolution.message);
      normalizedScheduledFor = resolution.scheduledFor;
    }
    const { scheduled_for_local: _scheduledForLocal, ...storedPatch } = patch;
    const update = {
      ...storedPatch,
      ...(normalizedScheduledFor ? { scheduled_for: normalizedScheduledFor } : {}),
      completed_at: patch.status === "completed" ? new Date().toISOString() : undefined,
    };
    const task = await updateOutboundFollowupTask(id, update);
    await insertOutboundEvent({
      business_id: String(current.business_id),
      customer_id: String(current.customer_id),
      invoice_id: String(current.invoice_id),
      event_type: "followup_task_updated",
      source: "admin",
      payload: { task_id: id, task_type: current.task_type, patch: storedPatch, scheduled_for: normalizedScheduledFor },
    });
    res.json({ task });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/calls/start", async (req, res) => {
  let context: Awaited<ReturnType<typeof inspectOutboundCallEligibility>>["context"] | null = null;
  try {
    const input = startCallSchema.parse(req.body);
    const eligibility = await inspectOutboundCallEligibility(
      input.invoice_id,
      new Date(),
      input.after_hours_override,
      input.demo_call_authorization_id,
    );
    context = eligibility.context;
    await insertOutboundEvent({
      business_id: String(context.business.id),
      customer_id: String(context.customer.id),
      invoice_id: String(context.invoice.id),
      event_type: "admin_call_start_requested",
      source: "admin",
      payload: {
        eligible: eligibility.eligible,
        reason: eligibility.reason,
        followup_task_id: input.followup_task_id || null,
        demo_call_authorization_id: input.demo_call_authorization_id || null,
      },
    });
    if (!eligibility.eligible) throw new Error(`Outbound call blocked: ${eligibility.reason}`);
    const result = await startOutboundCall(
      input.invoice_id,
      input.after_hours_override,
      new Date(),
      input.followup_task_id,
      input.demo_call_authorization_id,
    );
    await insertOutboundEvent({
      business_id: String(context.business.id),
      customer_id: String(context.customer.id),
      invoice_id: String(context.invoice.id),
      event_type: "admin_call_start_submitted",
      source: "admin",
      payload: {
        call_id: result.call_id,
        attempt_id: result.attempt_id,
        followup_task_id: input.followup_task_id || null,
        demo_call_authorization_id: input.demo_call_authorization_id || null,
      },
    });
    res.status(201).json(result);
  } catch (error) {
    if (context) {
      await insertOutboundEvent({
        business_id: String(context.business.id),
        customer_id: String(context.customer.id),
        invoice_id: String(context.invoice.id),
        event_type: "admin_call_start_blocked",
        source: "admin",
        payload: { reason: error instanceof Error ? error.message : "Outbound call failed" },
      }).catch(() => undefined);
    }
    sendError(res, error);
  }
});

outboundApiRouter.post("/calls/:id/rebuild-analysis", async (req, res) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    res.json({ call: await rebuildOutboundCallAnalysis(id) });
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/calls/dry-run", async (req, res) => {
  try {
    const input = startCallSchema.parse(req.body);
    res.json(await describeOutboundCallPreflight(
      input.invoice_id,
      new Date(),
      input.after_hours_override,
      input.followup_task_id,
      input.demo_call_authorization_id,
    ));
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/calls/start-batch", async (req, res) => {
  try {
    const input = startBatchSchema.parse(req.body);
    const batchEligibilities = await Promise.all(input.invoice_ids.map((invoiceId) => inspectOutboundCallEligibility(invoiceId)));
    const runtimes = batchEligibilities.map((eligibility) => outboundBusinessRuntimeSettings(eligibility.context.business));
    const businessIds = new Set(batchEligibilities.map((eligibility) => String(eligibility.context.business.id)));
    if (input.mode !== "dry_run" && businessIds.size !== 1) {
      res.status(400).json({ error: "A callable batch cannot mix businesses" });
      return;
    }
    const effectiveMaximum = Math.min(...runtimes.map((runtime) => runtime.maxBatchSize));
    if (input.invoice_ids.length > effectiveMaximum) {
      res.status(400).json({ error: `Batch exceeds the effective business maximum of ${effectiveMaximum}` });
      return;
    }
    const batchGates = runtimes.map((runtime) => validateBatchMode({
      mode: input.mode, testMode: runtime.testMode, confirmation: input.confirmation,
    }));
    const blockedGate = batchGates.find((gate) => !gate.allowed);
    if (blockedGate) {
      res.status(403).json({ error: blockedGate.reason });
      return;
    }

    const results: Array<Record<string, unknown>> = [];
    for (const invoiceId of input.invoice_ids) {
      try {
        const eligibility = await inspectOutboundCallEligibility(invoiceId);
        if (!eligibility.eligible || input.mode === "dry_run") {
          const result = { invoice_id: invoiceId, eligible: eligibility.eligible, reason: eligibility.reason, called: false };
          results.push(result);
          await insertOutboundEvent({
            business_id: String(eligibility.context.business.id),
            customer_id: String(eligibility.context.customer.id),
            invoice_id: invoiceId,
            event_type: eligibility.eligible ? "batch_dry_run_eligible" : "batch_call_blocked",
            source: "admin",
            payload: result,
          });
          continue;
        }
        const started = await startOutboundCall(invoiceId);
        results.push({ invoice_id: invoiceId, eligible: true, called: true, ...started });
      } catch (error) {
        results.push({
          invoice_id: invoiceId,
          eligible: false,
          called: false,
          error: error instanceof Error ? error.message : "Call failed",
        });
      }
    }
    res.json({ mode: input.mode, results });
  } catch (error) {
    sendError(res, error);
  }
});
