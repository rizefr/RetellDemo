import { buildOutboundCallAttemptPatch } from "./outboundCallAnalysis";
import {
  findOutboundCallAnalysisEvent,
  getOutboundCallAttempt,
  getOutboundInvoiceContext,
  insertOutboundEvent,
  updateOutboundCallAttempt,
} from "./outboundRepository";

export async function rebuildOutboundCallAnalysis(callAttemptId: string) {
  const attempt = await getOutboundCallAttempt(callAttemptId);
  const retellCallId = typeof attempt.retell_call_id === "string" ? attempt.retell_call_id : "";
  if (!retellCallId) throw Object.assign(new Error("Call attempt has no Retell call ID"), { status: 409 });
  const payload = await findOutboundCallAnalysisEvent(retellCallId);
  const rawCall = payload?.call;
  if (!rawCall || typeof rawCall !== "object" || Array.isArray(rawCall)) {
    throw Object.assign(new Error("No stored call_analyzed event is available"), { status: 404 });
  }
  const context = await getOutboundInvoiceContext(String(attempt.invoice_id));
  const patch = buildOutboundCallAttemptPatch(rawCall as Record<string, unknown>, {
    serviceDescription: String(context.invoice.service_description),
    invoiceNumber: String(context.invoice.invoice_id),
  });
  if (!patch.summary || !patch.analysis) {
    throw Object.assign(new Error("Stored Retell event does not contain analyzable call data"), { status: 422 });
  }
  const updated = await updateOutboundCallAttempt(callAttemptId, patch);
  await insertOutboundEvent({
    business_id: String(attempt.business_id),
    customer_id: String(attempt.customer_id),
    invoice_id: String(attempt.invoice_id),
    event_type: "call_analysis_rebuilt",
    source: "admin",
    external_event_id: `call_analysis_rebuilt:${retellCallId}`,
    payload: {
      call_attempt_id: callAttemptId,
      retell_call_id: retellCallId,
      recovered_outcome: patch.outcome ?? null,
      tool_error_count: Array.isArray((patch.analysis as Record<string, unknown>).tool_errors)
        ? ((patch.analysis as Record<string, unknown>).tool_errors as unknown[]).length
        : 0,
    },
  });
  return updated;
}
