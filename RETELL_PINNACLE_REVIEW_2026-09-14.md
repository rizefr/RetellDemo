# Pinnacle Retell review — September 14, 2026

This is current review evidence, not authorization for unattended customer outreach. Native simulations below mock all business tools and never place calls, send messages, change accounting records, or prove telephone audio quality.

## Verified resources and rollback

| Resource | Explicit ID | Published baseline | Reviewed candidates |
| --- | --- | --- | --- |
| Outbound collections | `agent_4aa8074d7eabe311109ed6da89` / `conversation_flow_bebdceabc801` | V91 | V95 full prompt; V96 shorter prompt |
| Collection callbacks | `agent_5ca64503754e06c338e12c743f` / `conversation_flow_67cfb3f644e1` | V5 | V6 full prompt; V7 shorter prompt |
| Collections number | `+19842075346` | Inbound callback agent and outbound collections agent, both `latest_published` | No binding mutation |

The unrelated receptionist and `+18887809963`, and the separate future elevator-service agent, were not modified. Voice tuning was preserved from the published baseline: spoken name Paul, `11labs-Gilfoy`, `eleven_flash_v2_5`, speed 0.82, first-message delay 1550 ms, coffee-shop ambience 0.7. No reviewed audio supports a voice change.

The pre-existing outbound V92 draft has `11labs-Paul` and no voice-model value; its flow matched V91. It must not be published accidentally. Model-only test drafts V93 and V94 were created from V91. V96 and callback V7 were redundant unpublished versions created when an interrupted preparation resumed; they were snapshotted before reuse for the shorter-prompt experiment. Publication must specify the selected explicit version, never whichever draft happens to be latest.

Private rollback readbacks and native result snapshots are in `.local-evidence/retell/` (excluded from Git). The typed source was reconstructed after local runtime storage loss and initially compared against every editable V95/V6 provider field. After adopting the shorter prompt it matches every editable selected V96/V7 field: no differences after removing provider-only default flags. V95/V6 remain the tested full-prompt fallback; V91/V5 preserve the original published baseline.

## Real-call evidence and its limits

The current authenticated backend read returned 59 historical call records, with 52 transcripts and 52 recording URLs. This is a broader evidence set than the two no-answer calls retained by the current Retell call-list API. Direct provider reads of two August/July historical IDs returned 404; backend retention is therefore not the same as provider availability.

Reviewed historical examples:

- August 13: wrong-person recovery asked one contact-recovery question and closed without an opt-out classification. A different caller confirmed their name but then denied having an elevator; the call was logged as wrong number.
- August 13: a full-mailbox greeting interrupted the approved provider voicemail message. The transcript does not prove audible pacing or successful voicemail delivery.
- July 29: a confirmed email-link path returned to final-check instead of asking the expected-payment date after send. This supports the new structural post-send date step, but does not establish current provider delivery.
- Four historical call-start errors rejected malformed E.164 numbers. Current backend contact/preflight tests must cover this boundary.

Recordings were available as URLs but were not audibly reviewed. No new calls were placed to obtain audio evidence.

## Model decision

Keep GPT-4.1. Both alternatives were actually accepted by Retell, not inferred from Codex model names. GPT-5.4 mini skipped a separate email confirmation and supplied `recipient_confirmed:true` anyway. GPT-4.1 mini still skipped corrected-address confirmation or promised delivery to an untrusted changed address. These fail the minimum correctness requirement despite lower headline price.

| Same 22-case corrected-flow comparison | Standard LLM component price/min | Native evaluator pass | Timestamped text-turn median / p90 |
| --- | ---: | ---: | ---: |
| GPT-4.1, V95 | $0.045 | 17/22 | 1208 / 2856 ms (78 pairs) |
| GPT-5.4 mini, V93 | $0.036 | 16/22 | 1771 / 2886 ms (69 pairs) |
| GPT-4.1 mini, V94 | $0.016 | 20/22 | 1622 / 3760 ms (75 pairs) |

After structural email delivery fixes, an identical 26-case comparison scored GPT-4.1 26/26 and GPT-4.1 mini 23/26. Its text-turn medians were 942 ms and 1176 ms respectively. Manual review found a false positive in one SMS-to-email case, so a later stricter method-switch protocol was required. Evaluator totals are recorded as returned, not represented as perfect independent judgments.

The pricing figures above are only the [published standard LLM component](https://www.retellai.com/pricing), not actual all-in cost. Voice infrastructure, TTS, telephony and enabled add-ons are separate. Current [billing exceptions](https://docs.retellai.com/accounts/billing-exceptions) scale billed duration above 4,000 LLM prompt tokens, using tokens / 4,000 as the scaling factor. That context includes global and active-node instructions, tools, transcript, tool history/results, and retrieved knowledge-base content. Older indexed search excerpts said 3,500; the freshly opened billing page and fresh Context7 query both say 4,000. Those are the current documented references, while account-specific charges remain unmeasured. Dynamic AI-first openings also have a ten-second minimum when the call is shorter. No token counts were inferred from characters or words. Native simulation payloads exposed no actual token-usage or cost fields; retained no-answer calls showed zero duration/cost. [Testing billing](https://docs.retellai.com/test/testing-pricing) is per message for both the agent and simulated-user model, plus one grading analysis unit per batch case; it must not be estimated from the voice-per-minute table. Exact workspace charges were not available in these payloads. Savings from a shorter prompt are not quantified.

## Prompt review and comparison

The [current prompting guide](https://docs.retellai.com/build/prompt-engineering-guide) recommends focused sections, concise responses and specialized flow nodes for complex tool coordination. The [flow debugging guide](https://docs.retellai.com/build/conversation-flow/debug-guide) recommends splitting unreliable tasks and making transition triggers precise. Those principles motivated dedicated confirmation, delivery, date-refusal, callback-confirmation and privacy terminal nodes. Voice settings and successful spoken conventions were retained.

A shorter global prompt reduces 31,190 to 21,001 characters (4,468 to 2,861 whitespace-delimited words). This is a text-size measurement, not token usage. Model, nodes, tools, examples, variables and scenario definitions were held constant.

| Outbound prompt experiment, same GPT-4.1 | Evaluator | Text-turn median | Native batch |
| --- | ---: | ---: | --- |
| Full V95 control | 28/28 | 1047 ms, 104 pairs | `test_batch_44bbada6b267` |
| Shorter V96 | 27/28 | 1076 ms, 104 pairs | `test_batch_91b96200c731` |

The single shorter-prompt failure was a judge inconsistency: the passing control and failing shorter run used the same assistant sentences after an early polite goodbye, both logged manual review, both avoided do-not-contact, and both ended natively. Four additional goodbye tests pass on each variant. Callback comparison also passes all 20 scenarios on both the full and shorter prompt. Select the shorter GPT-4.1 prompt: outbound V96 and callback V7. No behavior regression was observed in this fixed scenario suite; this remains bounded simulation evidence. The 29 ms median difference is not proof of a telephony latency change. No prompt-length cost saving is claimed without measured billable context.

## Response-variable integration correction

Current [custom-function documentation](https://docs.retellai.com/build/conversation-flow/custom-function) specifies dot paths such as `user.name`. Recovered configurations used `$.field`. The first six callback provider tests passed behaviorally, yet their actual snapshot variables retained initial values: the model was compensating from tool-result text. Repeating the identical six cases with dot paths passed 6/6 and populated `inbound_lookup_verified`, the actual provider/readiness flags, and the returned expected-payment date correctly. This disproves the earlier local note that native mocks do not apply response variables. Correct dot paths now apply to all tools in selected V96/V7; the full final suites are recorded below.

A separate backend review found that the new native email-confirmation route could still be blocked by a historical invoice-level agreement gate. The backend now validates the fresh signed request, exact trusted recipient, and call identifier, records a call-scoped confirmation digest, and sends once. Old agreement cannot bypass new confirmation. Replay success requires the same business, invoice, and recipient digest; mismatches never claim delivery. These are mocked signed-route regressions, not the single permitted real provider-send proof.

## Native evidence ledger

| Evidence | Batch | Result |
| --- | --- | --- |
| GPT-4.1 corrected comparison | `test_batch_2797d0616c2a` | 17 pass, 5 fail, 0 error |
| GPT-5.4 mini corrected comparison | `test_batch_442d0a350ce5` | 16 pass, 6 fail, 0 error |
| GPT-4.1 mini corrected comparison | `test_batch_e5f5d3094901` | 20 pass, 2 fail, 0 error |
| GPT-4.1 structural email graph | `test_batch_dfb60666c385` | 26 evaluator pass; method-switch false positive adjudicated |
| GPT-4.1 mini structural graph | `test_batch_45585e455b90` | 23 pass, 3 fail; two real contact-correction defects |
| Callback privacy and native endings | `test_batch_2e7a7e4a6da8` | 10/10 |
| Callback email, signed-number suppression success/failure, refusal, polite goodbye | `test_batch_1d3140b930ec` | 10/10, repeated critical cases |
| Full vs shorter outbound prompt, including four forced SMS-to-email cases | batches above | 28/28 vs 27/28 evaluator; manual behavior review 28/28 each after identical-response judge discrepancy |
| Full vs shorter callback prompt, privacy and repeated critical cases | `test_batch_be8696f23a3a` / `test_batch_85a62b0c31cd` | 20/20 each; all ended natively |
| Full vs shorter repeated polite goodbyes | `test_batch_37400d1212e5` / `test_batch_43f02aac8af7` | 4/4 each; no opt-out misclassification |
| Callback Stripe/QuickBooks/missing-link behavior, each repeated | `test_batch_830524df4599` | 6/6; snapshot exposed unchanged initial variables |
| Identical cases after dot-path correction | `test_batch_b256a6ab06b4` | 6/6; snapshot values now correctly extracted |
| Final V96 full outbound suite after mapping correction | `test_batch_f236bd24c2b0` | 27/28 evaluator; only the same early-goodbye final-check criterion |
| Final V7 full callback suite after mapping correction | `test_batch_d875d219f264` | 20/20 |

The final outbound evaluator again flags one final-check question after an early goodbye. The call logs manual review, never opt-out, and ends natively after the caller declines further help. This matches the full control; it is an explicit remaining conversational limitation, not a claimed perfect evaluator score.

Tests cover identity/wrong person, receipt, link accepted/declined, date capture/refusal, email phonetics/correction, SMS-to-email selection, tool success/failure, payment refusal, disputes, already-paid claims, AI/scam questions, callbacks, off-topic recovery, polite goodbye, explicit opt-out and callback privacy. Provider voicemail settings are preserved by readback; no phone/audio voicemail scenario was executed. Tool mocks cannot prove webhook authentication, actual backend persistence, email receipt, accounting reconciliation, or phone audio.

## Deprecated endpoint incident and prevention

The reported September 14, 06:48 PDT notice matches a one-off review request at `2026-09-14T13:48:21.842Z`: Python urllib called the removed call-list endpoint while collecting the initial audit snapshot. This was review tooling, not the deployed application. It was an audit error and must not be repeated.

The exact [Retell deprecation notice](https://docs.retellai.com/deprecation-notice/2026/06-15_legacy_list_endpoints) requires `POST /v3/list-calls` and the unified `items`, `pagination_key`, `has_more` response. A fresh supported request succeeded with two scoped records and `has_more:false`; an exhausted response need not contain a cursor.

The source guard now scans Python as well as TypeScript/JavaScript, repository scripts, local review/evidence tools and optional additional roots. `scripts/retell_readonly_inventory.py` uses a fixed provider host, explicit agent IDs, supported endpoints, and fails closed on absent/repeated cursors or non-read-only requests. Its four tests and the existing three endpoint-guard tests pass. API keys stay in the private environment and are not emitted in diagnostics.

## Local verification

After the final response-mapping correction, 35 focused TypeScript tests passed across collections safety, callback isolation, native regression routes and the deprecated-endpoint guard. Four Python read-only client tests passed. `git diff --check` passed. Ten signed webhook-contract tests also passed, including first-email confirmation and recipient/business/invoice replay boundaries. Fresh source-to-provider comparison found no editable-field differences from V96/V7. Full application deployment checks are recorded by the deployment review, not inferred from these scoped checks.

## Publication gate

Selected unpublished versions are outbound V96 and callback V7. Publish only after the dependent backend routes and migrations are deployed and verified. Read back selected agent/flow versions, tools, unchanged voice settings and both collections number bindings after publication. Preserve V91/V5 for rollback. Deployment/publication verification belongs in the final deployment ledger; a native mock pass is not a production integration pass.
