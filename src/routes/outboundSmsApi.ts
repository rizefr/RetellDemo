import express from "express";
import { z } from "zod";
import { requireOutboundAdmin, requireTrustedBrowserOrigin } from "../services/outboundAuth";
import { getOutboundSmsReadiness, recordOutboundSmsConsent } from "../services/outboundSmsReadiness";

export const outboundSmsApiRouter = express.Router();

// No provider webhook is connected in this deployment. Reject every payload
// before parsing or writing; a guessed signature or admin cookie cannot enable it.
outboundSmsApiRouter.post("/webhooks/provider", (_req, res) => {
  res.status(503).json({ error: "SMS provider webhook is not activated", sending_enabled: false });
});
outboundSmsApiRouter.use(requireOutboundAdmin);
outboundSmsApiRouter.use((req, res, next) => ["GET", "HEAD", "OPTIONS"].includes(req.method) ? next() : requireTrustedBrowserOrigin(req, res, next));

outboundSmsApiRouter.get("/readiness", async (req, res) => {
  try {
    const input = z.object({ business_id: z.uuid() }).parse(req.query);
    res.setHeader("Cache-Control", "no-store");
    res.json(await getOutboundSmsReadiness(input.business_id));
  } catch (error) {
    res.status(error instanceof z.ZodError ? 422 : 400).json({ error: "SMS readiness could not be loaded for this business", sending_enabled: false });
  }
});
outboundSmsApiRouter.post("/consents", async (req, res) => {
  try { res.status(201).json(await recordOutboundSmsConsent(req.body)); }
  catch (error) { res.status(error instanceof z.ZodError ? 422 : 400).json({ error: "Consent was not confirmed. Review the customer, evidence, and capture time. Sending remains disabled.", sending_enabled: false }); }
});
