import express from "express";
import { env } from "../config/env";
import {
  customerPatchSchema,
  importCsvSchema,
  invoicePatchSchema,
  startBatchSchema,
  startCallSchema,
  uuidSchema,
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
} from "../services/outboundRepository";
import { createOutboundCheckoutSession } from "../services/outboundStripe";
import { getOutboundSetupStatus } from "../services/outboundSetup";

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

outboundApiRouter.post("/calls/start", async (req, res) => {
  try {
    const input = startCallSchema.parse(req.body);
    res.status(201).json(await startOutboundCall(input.invoice_id, input.after_hours_override));
  } catch (error) {
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
    res.json(await describeOutboundCallPreflight(input.invoice_id, new Date(), input.after_hours_override));
  } catch (error) {
    sendError(res, error);
  }
});

outboundApiRouter.post("/calls/start-batch", async (req, res) => {
  try {
    const input = startBatchSchema.parse(req.body);
    if (input.invoice_ids.length > env.OUTBOUND_MAX_BATCH_SIZE) {
      res.status(400).json({ error: `Batch exceeds OUTBOUND_MAX_BATCH_SIZE=${env.OUTBOUND_MAX_BATCH_SIZE}` });
      return;
    }
    const gate = validateBatchMode({
      mode: input.mode,
      testMode: env.OUTBOUND_TEST_MODE,
      confirmation: input.confirmation,
    });
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason });
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
