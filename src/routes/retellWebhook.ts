import { Router } from "express";
import { Retell } from "retell-sdk";
import { env, getWebhookSecret, isProduction } from "../config/env";
import { retellWebhookSchema } from "../schemas/webhookSchemas";
import { storeCallEvent } from "../services/callEvents";

export const retellWebhookRouter = Router();

export async function verifyRetellWebhookSignature(rawBody: string, signature: string | undefined): Promise<boolean> {
  if (!signature) return false;
  const secret = getWebhookSecret();
  if (!secret) return false;
  return Retell.verify(rawBody, secret, signature);
}

retellWebhookRouter.post("/", async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
  const signature = req.header("x-retell-signature") ?? req.header("X-Retell-Signature") ?? undefined;
  const allowUnverified = !isProduction() && env.ALLOW_UNVERIFIED_WEBHOOKS;

  if (!allowUnverified) {
    const verified = await verifyRetellWebhookSignature(rawBody, signature);
    if (!verified) {
      return res.status(401).json({ error: "Invalid Retell webhook signature" });
    }
  }

  try {
    const parsed = retellWebhookSchema.parse(JSON.parse(rawBody));
    const result = await storeCallEvent(parsed);
    return res.status(200).json({
      received: true,
      verified: !allowUnverified,
      event_type: result.event_type,
      persisted: result.persisted,
    });
  } catch (error) {
    console.error("Retell webhook handling failed", { error });
    return res.status(400).json({ error: "Invalid webhook payload" });
  }
});
