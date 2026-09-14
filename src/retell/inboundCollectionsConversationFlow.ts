import type { ConversationFlowCreateParams } from "retell-sdk/resources/conversation-flow";
import { buildOutboundConversationFlow } from "./outboundConversationFlow";

const IDENTITY_PROMPT: string = `# Inbound callback opening and identity verification
This is an inbound callback to the collections number. The caller is not yet identified. Speak first with exactly: "Hi, you've reached the invoice follow-up line for {{business_name_spoken}}. May I get your first and last name?"
Do not say that you called the person just now, and do not assume the caller is the customer listed on any invoice.
When the caller gives a name, call lookup_inbound_account immediately. Pass the caller's first and last name and any company, invoice number, or email they voluntarily supplied. The backend also checks the signed call's calling phone number.
Do not disclose an invoice amount, date, number, inspection type, customer email, or customer phone until lookup_inbound_account returns verified=true. A name alone is not enough. Verification requires phone plus name, or name plus a matching company, invoice number, or email from the account.
If lookup_inbound_account returns needs_verification or ambiguous, ask for exactly one safe corroborator: the company/account name, invoice number, or email on the account. Never request a Social Security number, date of birth, ZIP code, card number, bank information, password, or authentication code. Call lookup_inbound_account again with the new corroborator.
If lookup_inbound_account returns not_found, ask once for the spelling of the first and last name. If the second lookup still does not verify, use the native privacy-safe End node. Do not ask a third identity question, call account-bound tools, claim a review was saved, or invent a match.
When lookup_inbound_account returns verified=true, continue naturally: "Got it, {{customer_first_name_spoken}}. I found the account. Our records show the {{inspection_type}} invoice from {{inspection_date_spoken}} is overdue. Were you able to receive it?" Do not restart the introduction and do not repeat the identity question.
If the caller asks who is calling, say: "My name is {{agent_display_name}}. I'm helping {{business_name_spoken}} with invoice follow-up." If asked whether you are AI, answer honestly once.
If the caller is returning a voicemail, acknowledge that briefly and continue with name verification. Do not reveal invoice details before verified lookup.
After verification, follow the same invoice-received, invoice-not-received, secure-link, expected-payment-date, callback, objection, final-check, and hard-terminal rules as the outbound collections flow.

`;

const IDENTITY_NODES: ConversationFlowCreateParams["nodes"] = [
  {
    "instruction": {
      "type": "prompt",
      "text": "Ask for the caller's first and last name. This node only collects identity input. Never discuss an invoice, payment, date, amount, email, or phone from account records here. As soon as the caller supplies a name, transition to the lookup function without acknowledging or repeating it. For an explicit stop-calling request, immediately transition to the signed caller-number suppression function. No identity verification is required to stop contacting the signed calling number."
    },
    "name": "Collect inbound caller identity",
    "finetune_transition_examples": [
      {
        "transcript": [
          {
            "role": "agent",
            "content": "Hi, you've reached the invoice follow-up line for {{business_name_spoken}}. May I get your first and last name?"
          },
          {
            "role": "user",
            "content": "Pat Morgan."
          }
        ],
        "destination_node_id": "inbound_identity_lookup_function",
        "id": "inbound_identity_lookup_transition_example"
      }
    ],
    "edges": [
      {
        "destination_node_id": "inbound_suppress_caller_function",
        "transition_condition": {
          "type": "prompt",
          "prompt": "The caller explicitly requests no further contact, says stop calling, remove my number, or do not contact me. Transition immediately even when the same turn includes a name or goodbye. Do not require identity verification. Ordinary goodbye, refusal to provide a name, hostility alone, or attorney questions without an explicit contact opt-out must not be classified as do-not-contact."
        },
        "id": "inbound_identity_optout_edge"
      },
      {
        "destination_node_id": "inbound_identity_polite_end",
        "transition_condition": {
          "prompt": "The caller declines to provide their name or says goodbye without providing a name. End politely without more identity questions. This is not do-not-contact unless they explicitly ask to stop calling.",
          "type": "prompt"
        },
        "id": "inbound_identity_refused_name_edge"
      },
      {
        "destination_node_id": "inbound_identity_ai_answer",
        "transition_condition": {
          "type": "prompt",
          "prompt": "The caller supplies a name and also directly asks whether you are AI, automated, a robot, or human, and that question has not been answered. Answer it before lookup or payment-date routing."
        },
        "id": "inbound_identity_bundled_ai_question_edge"
      },
      {
        "id": "inbound_identity_name_supplied_edge",
        "destination_node_id": "inbound_identity_lookup_function",
        "transition_condition": {
          "prompt": "Transition immediately when the caller supplies a first name, with or without a last name or other identity details, and there is no unanswered direct AI/human question. Do not speak before transitioning.",
          "type": "prompt"
        }
      },
      {
        "id": "inbound_identity_hard_terminal_edge",
        "transition_condition": {
          "prompt": "The unverified caller is hostile or says they are represented by an attorney but does NOT ask to stop contact. End without account disclosure or claiming a saved suppression. Explicit contact opt-outs use the separate suppression route.",
          "type": "prompt"
        },
        "destination_node_id": "inbound_identity_unverified_explanation"
      }
    ],
    "type": "subagent",
    "id": "inbound_identity_agent",
    "display_position": {
      "x": -400,
      "y": 0
    }
  },
  {
    "skip_response_edge": {
      "destination_node_id": "inbound_identity_lookup_function",
      "transition_condition": {
        "type": "prompt",
        "prompt": "Skip response"
      },
      "id": "inbound_identity_ai_answer_lookup_edge"
    },
    "display_position": {
      "x": -210,
      "y": -180
    },
    "name": "Answer AI question before verifying identity",
    "type": "conversation",
    "instruction": {
      "type": "static_text",
      "text": "Yes, I'm an AI voice assistant helping {{business_name_spoken}} with invoice follow-up."
    },
    "id": "inbound_identity_ai_answer"
  },
  {
    "instruction": {
      "type": "static_text",
      "text": "Understood. Have a good day. Goodbye."
    },
    "type": "end",
    "id": "inbound_identity_polite_end",
    "name": "End without requesting identity again",
    "speak_during_execution": true,
    "display_position": {
      "x": -180,
      "y": 280
    }
  },
  {
    "tool_type": "local",
    "tool_id": "outbound_suppress_inbound_caller",
    "display_position": {
      "x": -180,
      "y": 480
    },
    "type": "function",
    "name": "Suppress the signed calling number without account disclosure",
    "speak_during_execution": false,
    "instruction": {
      "text": "Call suppress_inbound_caller once with explicit_opt_out=true. The caller explicitly requested that contact stop. Never supply or infer a different phone number; the backend uses only the signed calling number and configured collections business.",
      "type": "prompt"
    },
    "id": "inbound_suppress_caller_function",
    "else_edge": {
      "id": "inbound_suppression_result_edge",
      "destination_node_id": "inbound_suppression_result_end",
      "transition_condition": {
        "prompt": "Else",
        "type": "prompt"
      }
    },
    "wait_for_result": true
  },
  {
    "name": "Close with the actual suppression result",
    "type": "end",
    "display_position": {
      "y": 480,
      "x": 80
    },
    "instruction": {
      "type": "prompt",
      "text": "Read the most recent suppress_inbound_caller result. Only if suppressed=true say: Understood. We'll stop calling this number. Goodbye. If suppressed is not true or the tool failed, say: I couldn't save that request. Please contact the office to stop future calls. Goodbye. Do not request identity, mention account details, or claim suppression before success."
    },
    "id": "inbound_suppression_result_end",
    "speak_during_execution": true
  },
  {
    "id": "inbound_identity_lookup_function",
    "tool_type": "local",
    "tool_id": "outbound_lookup_inbound_account",
    "instruction": {
      "text": "Call lookup_inbound_account using the caller's stated first and last name plus any company, invoice number, or email they volunteered. Do not disclose account details before a verified result.",
      "type": "prompt"
    },
    "wait_for_result": true,
    "edges": [
      {
        "transition_condition": {
          "prompt": "The caller explicitly requests no further contact, says stop calling, remove my number, or do not contact me. Transition immediately even when the same turn includes a name or goodbye. Do not require identity verification. Ordinary goodbye, refusal to provide a name, hostility alone, or attorney questions without an explicit contact opt-out must not be classified as do-not-contact.",
          "type": "prompt"
        },
        "destination_node_id": "inbound_suppress_caller_function",
        "id": "inbound_lookup_optout_edge"
      },
      {
        "transition_condition": {
          "type": "prompt",
          "prompt": "Transition here only when lookup returned verified and the caller already stated before lookup that the invoice was received, they declined or did not need the payment link, and they supplied an expected payment date. All three facts must be present. Do not acknowledge or restate the date before transitioning."
        },
        "id": "inbound_verified_bundled_expected_date_edge",
        "destination_node_id": "outbound_expected_payment_date_function"
      },
      {
        "id": "inbound_identity_verified_edge",
        "destination_node_id": "outbound_collections_agent",
        "transition_condition": {
          "type": "prompt",
          "prompt": "Transition here when the most recent lookup_inbound_account tool result says status is verified. Do not require a later caller turn and do not use cached dynamic-variable defaults."
        }
      },
      {
        "destination_node_id": "inbound_identity_unverified_explanation",
        "id": "inbound_identity_already_refused_corroboration_edge",
        "transition_condition": {
          "prompt": "The lookup did not verify the account and the caller already said in their name answer that they cannot or will not provide further corroboration, or already said goodbye. Do not enter another question node; end natively without disclosing account details.",
          "type": "prompt"
        }
      }
    ],
    "name": "Verify inbound caller account",
    "else_edge": {
      "id": "inbound_identity_needs_corroboration_edge",
      "destination_node_id": "inbound_identity_corroboration_agent",
      "transition_condition": {
        "prompt": "Else",
        "type": "prompt"
      }
    },
    "display_position": {
      "x": -180,
      "y": 0
    },
    "type": "function",
    "speak_during_execution": false
  },
  {
    "instruction": {
      "text": "The first lookup did not verify the caller. If inbound_lookup_status is not_found, ask once for the spelling of the first and last name. Otherwise ask for exactly one safe corroborator: company/account name, invoice number, or email on the account. Never ask for a Social Security number, date of birth, ZIP code, card or bank information, password, or authentication code. As soon as the caller supplies the requested detail, transition to the retry lookup without acknowledging it.",
      "type": "prompt"
    },
    "edges": [
      {
        "id": "inbound_corroboration_optout_edge",
        "destination_node_id": "inbound_suppress_caller_function",
        "transition_condition": {
          "type": "prompt",
          "prompt": "The caller explicitly requests no further contact, says stop calling, remove my number, or do not contact me. Transition immediately even when the same turn includes a name or goodbye. Do not require identity verification. Ordinary goodbye, refusal to provide a name, hostility alone, or attorney questions without an explicit contact opt-out must not be classified as do-not-contact."
        }
      },
      {
        "id": "inbound_identity_corroborator_supplied_edge",
        "transition_condition": {
          "prompt": "Transition immediately when the caller supplies the requested spelling or one safe corroborator. Do not speak before transitioning.",
          "type": "prompt"
        },
        "destination_node_id": "inbound_identity_retry_lookup_function"
      },
      {
        "destination_node_id": "inbound_identity_unverified_explanation",
        "transition_condition": {
          "type": "prompt",
          "prompt": "The unverified caller is hostile or says they are represented by an attorney but does NOT ask to stop contact. End without account disclosure or claiming a saved suppression. Explicit contact opt-outs use the separate suppression route."
        },
        "id": "inbound_corroboration_hard_terminal_edge"
      },
      {
        "destination_node_id": "inbound_identity_unverified_explanation",
        "transition_condition": {
          "type": "prompt",
          "prompt": "Transition when the caller says they cannot or will not provide a spelling, company name, invoice number, or email, or when they politely want to end without providing one. Do not keep asking for the same corroborator."
        },
        "id": "inbound_identity_corroboration_refused_edge"
      }
    ],
    "name": "Collect one inbound identity corroborator",
    "type": "subagent",
    "display_position": {
      "x": 40,
      "y": 80
    },
    "id": "inbound_identity_corroboration_agent"
  },
  {
    "type": "function",
    "edges": [
      {
        "destination_node_id": "inbound_suppress_caller_function",
        "transition_condition": {
          "type": "prompt",
          "prompt": "The caller explicitly requests no further contact, says stop calling, remove my number, or do not contact me. Transition immediately even when the same turn includes a name or goodbye. Do not require identity verification. Ordinary goodbye, refusal to provide a name, hostility alone, or attorney questions without an explicit contact opt-out must not be classified as do-not-contact."
        },
        "id": "inbound_retry_optout_edge"
      },
      {
        "transition_condition": {
          "type": "prompt",
          "prompt": "Transition here only when lookup returned verified and the caller already stated before lookup that the invoice was received, they declined or did not need the payment link, and they supplied an expected payment date. All three facts must be present. Do not acknowledge or restate the date before transitioning."
        },
        "destination_node_id": "outbound_expected_payment_date_function",
        "id": "inbound_retry_verified_bundled_expected_date_edge"
      },
      {
        "id": "inbound_identity_retry_verified_edge",
        "destination_node_id": "outbound_collections_agent",
        "transition_condition": {
          "prompt": "Transition here when the most recent lookup_inbound_account tool result says status is verified. Do not require a later caller turn and do not use cached dynamic-variable defaults.",
          "type": "prompt"
        }
      }
    ],
    "speak_during_execution": false,
    "tool_type": "local",
    "wait_for_result": true,
    "instruction": {
      "text": "Call lookup_inbound_account again using the caller's stated name and the latest spelling or safe corroborator. Do not disclose account details before a verified result.",
      "type": "prompt"
    },
    "else_edge": {
      "id": "inbound_identity_retry_unverified_edge",
      "destination_node_id": "inbound_identity_unverified_explanation",
      "transition_condition": {
        "prompt": "Else",
        "type": "prompt"
      }
    },
    "display_position": {
      "x": 260,
      "y": 80
    },
    "tool_id": "outbound_lookup_inbound_account",
    "id": "inbound_identity_retry_lookup_function",
    "name": "Retry inbound caller verification"
  },
  {
    "speak_during_execution": true,
    "display_position": {
      "x": 480,
      "y": 100
    },
    "name": "Unverified inbound caller close",
    "id": "inbound_identity_unverified_explanation",
    "type": "end",
    "instruction": {
      "type": "static_text",
      "text": "I couldn't verify the account, so I can't share account details. Please contact the office for help. Have a good day. Goodbye."
    }
  }
];

const IDENTITY_TOOLS: NonNullable<ConversationFlowCreateParams["tools"]> = [
  {
    "parameters": {
      "type": "object",
      "properties": {
        "account_company_name": {
          "type": "string",
          "description": "Company/account name volunteered by the caller."
        },
        "invoice_id": {
          "type": "string",
          "description": "Invoice number volunteered by the caller."
        },
        "last_name": {
          "description": "Caller's stated last name, when supplied.",
          "type": "string"
        },
        "first_name": {
          "type": "string",
          "description": "Caller's stated first name."
        },
        "email": {
          "description": "Email volunteered by the caller for identity corroboration.",
          "type": "string"
        }
      },
      "required": [
        "first_name"
      ]
    },
    "execution_message_type": "static_text",
    "response_variables": {
      "account_company_name": "account_company_name",
      "customer_email_display": "customer_email_display",
      "inbound_lookup_verified": "verified",
      "customer_phone_spoken_chunked": "customer_phone_spoken_chunked",
      "payment_provider": "payment_provider",
      "quickbooks_connected": "quickbooks_connected",
      "manual_payment_followup_required": "manual_payment_followup_required",
      "customer_email_spoken_phonetic": "customer_email_spoken_phonetic",
      "inspection_type": "inspection_type",
      "customer_email_spoken_slow": "customer_email_spoken_slow",
      "lookup_message": "message_for_agent",
      "customer_first_name_spoken": "customer_first_name_spoken",
      "inbound_lookup_status": "status",
      "email_on_file": "email_on_file",
      "customer_first_name": "customer_first_name",
      "amount_due_spoken": "amount_due_spoken",
      "original_due_date_spoken": "original_due_date_spoken",
      "invoice_id_spoken": "invoice_id_spoken",
      "expected_payment_date_spoken": "expected_payment_date_spoken",
      "customer_last_name": "customer_last_name",
      "customer_last_name_spoken": "customer_last_name_spoken",
      "account_company_name_spoken": "account_company_name_spoken",
      "inspection_date_spoken": "inspection_date_spoken"
    },
    "speak_during_execution": true,
    "timeout_ms": 15000,
    "description": "Verify an inbound caller against open invoice records. Call immediately after the caller gives a name, and call again when the caller supplies one safe corroborator. Never disclose invoice details unless verified is true.",
    "method": "POST",
    "tool_id": "outbound_lookup_inbound_account",
    "type": "custom",
    "speak_after_execution": true,
    "url": "https://elixis.agency/api/outbound/retell/lookup-inbound-account",
    "name": "lookup_inbound_account",
    "execution_message_description": "One moment."
  },
  {
    "url": "https://elixis.agency/api/outbound/retell/suppress-inbound-caller",
    "name": "suppress_inbound_caller",
    "timeout_ms": 15000,
    "method": "POST",
    "description": "Honor explicit no-further-contact requests using only the signed incoming calling number and business. No account verification or invoice data is needed. Never use for an ordinary goodbye.",
    "type": "custom",
    "parameters": {
      "properties": {
        "explicit_opt_out": {
          "type": "boolean",
          "description": "Must be true only after an explicit request to stop contact."
        }
      },
      "required": [
        "explicit_opt_out"
      ],
      "type": "object"
    },
    "speak_after_execution": true,
    "response_variables": {
      "inbound_caller_suppressed": "suppressed"
    },
    "speak_during_execution": false,
    "tool_id": "outbound_suppress_inbound_caller"
  }
];

const VERIFIED_MAIN_INSTRUCTION: NonNullable<ConversationFlowCreateParams.SubagentNode["instruction"]> = {
  "type": "prompt",
  "text": "Identity has already been verified by the inbound identity nodes. Inspect everything the caller said before lookup and continue naturally with only the unresolved step. When invoice receipt is still unknown, say: Got it, {{customer_first_name_spoken}}. I found the account. Our records show the {{inspection_type}} invoice from {{inspection_date_spoken}} is overdue. Were you able to receive it? Do not use the outbound opening, ask for identity again, or restart the conversation. Then preserve the existing invoice, payment, expected-payment-date, final-check, wrong-number, and hard-terminal routes."
};

export function buildInboundCollectionsConversationFlow(baseUrl: string): ConversationFlowCreateParams {
  const outbound = buildOutboundConversationFlow(baseUrl);
  const prompt = String(outbound.global_prompt || "");
  const openingStart = prompt.indexOf("# Opening and disclosure");
  const discussionStart = prompt.indexOf("# Inspection invoice discussion");
  if (openingStart < 0 || discussionStart < 0) throw new Error("Outbound prompt headings changed; inbound composition must be reviewed.");
  const main = outbound.nodes.find((node) => node.id === "outbound_collections_agent");
  if (!main || main.type !== "subagent") throw new Error("Outbound collections start node is missing.");
  main.name = "Verified inbound collections conversation";
  main.instruction = structuredClone(VERIFIED_MAIN_INSTRUCTION);
  const tools = structuredClone(IDENTITY_TOOLS);
  for (const tool of tools) if (tool.type === "custom") tool.url = `${baseUrl}${new URL(tool.url).pathname}`;
  return {
    ...outbound,
    start_node_id: "inbound_identity_agent",
    global_prompt: `${prompt.slice(0, openingStart)}${IDENTITY_PROMPT}${prompt.slice(discussionStart)}`,
    tools: [...tools, ...(outbound.tools || [])],
    nodes: [...structuredClone(IDENTITY_NODES), ...outbound.nodes],
    default_dynamic_variables: {
      ...outbound.default_dynamic_variables,
      business_name: "Pinnacle Elevator Solutions", business_name_spoken: "Pinnacle Elevator Solutions", agent_display_name: "Paul",
      inbound_lookup_status: "unverified", inbound_lookup_verified: "false", call_purpose: "inbound_callback", demo_call_mode: "inbound_callback",
    },
  };
}
