import { env } from "../config/env";

export type OutboundAgentVariant = "conversation_flow" | "single_prompt";

export type OutboundAgentVariantConfig = {
  conversationFlowAgentId: string;
  singlePromptAgentId: string;
};

export function resolveOutboundAgentVariant(
  variant: OutboundAgentVariant,
  config: OutboundAgentVariantConfig = {
    conversationFlowAgentId: env.OUTBOUND_RETELL_AGENT_ID,
    singlePromptAgentId: env.OUTBOUND_RETELL_SINGLE_PROMPT_AGENT_ID,
  },
) {
  if (variant === "single_prompt") {
    return {
      variant,
      label: "Single Prompt",
      agentId: config.singlePromptAgentId,
      configured: Boolean(config.singlePromptAgentId),
      reason: config.singlePromptAgentId ? null : "single_prompt_agent_not_configured",
    } as const;
  }
  return {
    variant: "conversation_flow" as const,
    label: "Conversation Flow",
    agentId: config.conversationFlowAgentId,
    configured: Boolean(config.conversationFlowAgentId),
    reason: config.conversationFlowAgentId ? null : "retell_agent_missing",
  } as const;
}
