import { verify } from "retell-sdk";
import { env } from "../config/env";

async function verifyWithSecret(rawBody: string, signature: string, secret: string): Promise<boolean> {
  if (!secret) return false;
  try {
    return await verify(rawBody, secret, signature);
  } catch {
    return false;
  }
}

export async function verifyOutboundRetellSignature(
  rawBody: string,
  signature: string,
  providerSecret = env.RETELL_API_KEY,
  compatibilitySecret = env.OUTBOUND_RETELL_WEBHOOK_SECRET,
): Promise<boolean> {
  if (!rawBody || !signature) return false;
  const candidates = Array.from(new Set([providerSecret, compatibilitySecret].filter(Boolean)));
  for (const secret of candidates) {
    if (await verifyWithSecret(rawBody, signature, secret)) return true;
  }
  return false;
}

export function trustedRetellMetadata(
  call: unknown,
  expectedAgentId = env.OUTBOUND_RETELL_AGENT_ID,
):
  | { businessId: string; customerId: string; invoiceId: string; callAttemptId?: string; agentId: string }
  | null {
  if (!call || typeof call !== "object") return null;
  const callRecord = call as { agent_id?: unknown; metadata?: unknown };
  const agentId = typeof callRecord.agent_id === "string" ? callRecord.agent_id : "";
  if (!expectedAgentId || !agentId || agentId !== expectedAgentId) return null;
  const metadata = callRecord.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const values = metadata as Record<string, unknown>;
  if (
    typeof values.business_id !== "string" ||
    typeof values.customer_id !== "string" ||
    typeof values.invoice_id !== "string"
  ) {
    return null;
  }
  return {
    businessId: values.business_id,
    customerId: values.customer_id,
    invoiceId: values.invoice_id,
    callAttemptId: typeof values.call_attempt_id === "string" ? values.call_attempt_id : undefined,
    agentId,
  };
}
