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
} from "../services/outboundRepository";
import { createOutboundCheckoutSession } from "../services/outboundStripe";
import { getOutboundSetupStatus } from "../services/outboundSetup";
import { validateOutboundBusinessSettingsPatch } from "../services/outboundBusinessSettings";
import { outboundBusinessRuntimeSettings } from "../services/outboundRuntimeSettings";
import { customerCsvTemplate, businessCsvTemplate } from "../services/outboundTemplates";
import { parseOutboundBusinessCsv } from "../services/outboundBusinessCsv";
import { resolveOutboundCallback } from "../services/outboundCallbacks";

export const outboundApiRouter = express.Router();

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
    const eligibility = await inspectOutboundCallEligibility(input.invoice_id, new Date(), input.after_hours_override);
    context = eligibility.context;
    await insertOutboundEvent({
      business_id: String(context.business.id),
      customer_id: String(context.customer.id),
      invoice_id: String(context.invoice.id),
      event_type: "admin_call_start_requested",
      source: "admin",
      payload: { eligible: eligibility.eligible, reason: eligibility.reason, followup_task_id: input.followup_task_id || null },
    });
    if (!eligibility.eligible) throw new Error(`Outbound call blocked: ${eligibility.reason}`);
    const result = await startOutboundCall(input.invoice_id, input.after_hours_override, new Date(), input.followup_task_id);
    await insertOutboundEvent({
      business_id: String(context.business.id),
      customer_id: String(context.customer.id),
      invoice_id: String(context.invoice.id),
      event_type: "admin_call_start_submitted",
      source: "admin",
      payload: { call_id: result.call_id, attempt_id: result.attempt_id, followup_task_id: input.followup_task_id || null },
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
    res.json(await describeOutboundCallPreflight(input.invoice_id, new Date(), input.after_hours_override, input.followup_task_id));
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
