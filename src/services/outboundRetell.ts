import { verify } from "retell-sdk";
import { env } from "../config/env";
import { findOutboundCallAttempt, getOutboundBusinessSettings } from "./outboundRepository";

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

export function trustedInboundRetellBusinessMetadata(call: unknown):
  | { businessId: string; agentId: string; callId: string; direction: "inbound_collections" }
  | null {
  if (!call || typeof call !== "object") return null;
  const callRecord = call as { agent_id?: unknown; call_id?: unknown; metadata?: unknown };
  const agentId = typeof callRecord.agent_id === "string" ? callRecord.agent_id : "";
  const callId = typeof callRecord.call_id === "string" ? callRecord.call_id : "";
  const metadata = callRecord.metadata;
  if (!agentId || !callId || !metadata || typeof metadata !== "object") return null;
  const values = metadata as Record<string, unknown>;
  if (typeof values.business_id !== "string" || values.direction !== "inbound_collections") return null;
  return {
    businessId: values.business_id,
    agentId,
    callId,
    direction: "inbound_collections",
  };
}

export async function verifiedInboundRetellBusinessMetadata(call: unknown) {
  const inbound = trustedInboundRetellBusinessMetadata(call);
  if (!inbound) return null;
  const business = await getOutboundBusinessSettings(inbound.businessId);
  if (String(business.inbound_retell_agent_id || "") !== inbound.agentId) return null;
  return { ...inbound, business };
}

export async function resolveTrustedRetellMetadata(call: unknown) {
  const outbound = trustedRetellMetadata(call);
  if (outbound) return outbound;
  const inbound = await verifiedInboundRetellBusinessMetadata(call);
  if (!inbound) return null;
  const attempt = await findOutboundCallAttempt(inbound.callId);
  if (
    !attempt ||
    attempt.direction !== "inbound" ||
    String(attempt.business_id) !== inbound.businessId ||
    !attempt.customer_id ||
    !attempt.invoice_id
  ) {
    return null;
  }
  return {
    businessId: inbound.businessId,
    customerId: String(attempt.customer_id),
    invoiceId: String(attempt.invoice_id),
    callAttemptId: String(attempt.id),
    agentId: inbound.agentId,
  };
}
