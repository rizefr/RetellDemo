import { isOutboundOutcome, type OutboundOutcome } from "./outboundOutcomes";

type CallContext = {
  serviceDescription: string;
  invoiceNumber: string;
};

type ToolTrace = {
  name: string;
  successful: boolean | null;
};

type ToolError = {
  name: string;
  code: string;
  message: string;
};

export type OutboundCallAnalysis = {
  provider_summary: string | null;
  identity_confirmed: boolean | null;
  payment_link_requested: boolean;
  payment_link_created: boolean;
  email_requested: boolean;
  sms_requested: boolean;
  human_requested: boolean;
  objection_type: string | null;
  next_action: string;
  tools_invoked: ToolTrace[];
  tool_errors: ToolError[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (record(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    return record(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizedToolError(name: string, content: unknown): ToolError {
  const raw = typeof content === "string" ? content : "Tool execution failed";
  const status = raw.match(/status code\s+(\d{3})/i)?.[1];
  const message = raw.match(/error message:\s*([^\n]+)/i)?.[1]?.trim() ||
    raw.match(/(Request failed with status code\s+\d{3})/i)?.[1] ||
    "Tool execution failed";
  return {
    name,
    code: status ? `http_${status}` : "tool_error",
    message: message.slice(0, 300),
  };
}

function toolState(entries: unknown[]): {
  tools: ToolTrace[];
  errors: ToolError[];
  explicitOutcome: OutboundOutcome | null;
} {
  const results = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const item = record(entry);
    if (item?.role === "tool_call_result" && typeof item.tool_call_id === "string") {
      results.set(item.tool_call_id, item);
    }
  }

  const tools: ToolTrace[] = [];
  const errors: ToolError[] = [];
  let explicitOutcome: OutboundOutcome | null = null;
  for (const entry of entries) {
    const item = record(entry);
    if (item?.role !== "tool_call_invocation" || typeof item.name !== "string") continue;
    const result = typeof item.tool_call_id === "string" ? results.get(item.tool_call_id) : undefined;
    const successful = typeof result?.successful === "boolean" ? result.successful : null;
    tools.push({ name: item.name, successful });
    if (successful === false) errors.push(normalizedToolError(item.name, result?.content));
    if (item.name === "log_outcome") {
      const outcome = parseArguments(item.arguments).outcome;
      if (typeof outcome === "string" && isOutboundOutcome(outcome)) explicitOutcome = outcome;
    }
  }
  return { tools, errors, explicitOutcome };
}

function nextAction(input: {
  custom: Record<string, unknown>;
  outcome: OutboundOutcome | null;
  tools: ToolTrace[];
  errors: ToolError[];
}): string {
  if (typeof input.custom.next_action === "string" && input.custom.next_action.trim()) {
    return input.custom.next_action.trim().slice(0, 200);
  }
  if (input.errors.length) return "manual_review_tool_error";
  if (input.outcome === "confirmed_payment_link_requested") {
    return input.tools.some((tool) => tool.name === "create_payment_link" && tool.successful !== false)
      ? "deliver_payment_link"
      : "prepare_payment_link";
  }
  if (["wrong_number", "do_not_contact", "attorney_represented", "dispute"].includes(input.outcome ?? "")) {
    return "outreach_stopped_manual_review";
  }
  if (["callback_requested", "no_answer", "voicemail_detected_no_message"].includes(input.outcome ?? "")) {
    return "scheduled_followup";
  }
  return "manual_review";
}

export function buildOutboundCallAnalysis(call: Record<string, unknown>, _context: CallContext) {
  const providerAnalysis = record(call.call_analysis) ?? {};
  const custom = record(providerAnalysis.custom_analysis_data) ?? {};
  const entries = Array.isArray(call.transcript_with_tool_calls) ? call.transcript_with_tool_calls : [];
  const state = toolState(entries);
  const providerSummary =
    typeof providerAnalysis.call_summary === "string" && providerAnalysis.call_summary.trim()
      ? providerAnalysis.call_summary.trim()
      : typeof providerAnalysis.summary === "string" && providerAnalysis.summary.trim()
        ? providerAnalysis.summary.trim()
        : null;
  const toolNames = new Set(state.tools.map((tool) => tool.name));
  const customDelivery = typeof custom.delivery_preference === "string" ? custom.delivery_preference : "none";
  const paymentLinkRequested =
    custom.payment_link_requested === true || state.explicitOutcome === "confirmed_payment_link_requested";
  const paymentLinkCreated = state.tools.some(
    (tool) => tool.name === "create_payment_link" && tool.successful !== false,
  );
  const emailRequested = customDelivery === "email" || toolNames.has("send_payment_email");
  const smsRequested = customDelivery === "text" || toolNames.has("send_payment_sms");
  const humanRequested = custom.human_requested === true || toolNames.has("request_human_transfer");

  const analysis: OutboundCallAnalysis = {
    provider_summary: providerSummary,
    identity_confirmed: optionalBoolean(custom.identity_confirmed),
    payment_link_requested: paymentLinkRequested,
    payment_link_created: paymentLinkCreated,
    email_requested: emailRequested,
    sms_requested: smsRequested,
    human_requested: humanRequested,
    objection_type:
      typeof custom.objection_type === "string" && custom.objection_type !== "none"
        ? custom.objection_type.slice(0, 100)
        : null,
    next_action: "manual_review",
    tools_invoked: state.tools,
    tool_errors: state.errors,
  };
  analysis.next_action = nextAction({ custom, outcome: state.explicitOutcome, tools: state.tools, errors: state.errors });

  return {
    summary: providerSummary ?? "No clear summary available from transcript.",
    outcome: state.explicitOutcome,
    analysis,
  };
}

export function buildOutboundCallAttemptPatch(call: Record<string, unknown>, context: CallContext) {
  const patch: Record<string, unknown> = {};
  if (typeof call.call_status === "string") patch.status = call.call_status;
  if (typeof call.transcript === "string" && call.transcript.trim()) patch.transcript = call.transcript;
  if (typeof call.recording_url === "string" && call.recording_url.trim()) patch.recording_url = call.recording_url;
  if (typeof call.duration_ms === "number" && Number.isFinite(call.duration_ms)) {
    patch.duration_ms = Math.max(0, Math.round(call.duration_ms));
  }
  if (typeof call.end_timestamp === "number" && Number.isFinite(call.end_timestamp)) {
    patch.ended_at = new Date(call.end_timestamp).toISOString();
  }
  const hasAnalysis = Boolean(record(call.call_analysis));
  const hasToolTrace = Array.isArray(call.transcript_with_tool_calls) && call.transcript_with_tool_calls.length > 0;
  if (hasAnalysis || hasToolTrace) {
    const built = buildOutboundCallAnalysis(call, context);
    patch.summary = built.summary;
    patch.analysis = built.analysis;
    if (built.outcome) patch.outcome = built.outcome;
  }
  return patch;
}

const REDACTED_KEYS = /^(authorization|api[_-]?key|access[_-]?token|signature|secret|password)$/i;

export function redactOutboundEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOutboundEventPayload);
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(
    Object.entries(source).map(([key, child]) => [
      key,
      REDACTED_KEYS.test(key) ? "[REDACTED]" : redactOutboundEventPayload(child),
    ]),
  );
}
