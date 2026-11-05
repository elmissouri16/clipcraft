# Model-specific thinking controls

The CraftAI model picker saves effort by provider and selected model ID. Changing
models restores that model's own choice; an override is never inherited from a
different model or fallback provider. Both saving and sending a non-default
choice validate it against that model's capabilities. Default can be restored
without a working capability service, and failed checks preserve saved values.

| Provider | Allowed choices | Request field |
| --- | --- | --- |
| Codex SDK | Installed catalog's reasoning levels, intersected with the pinned SDK's supported enum | `modelReasoningEffort` |
| Claude Agent SDK | `supportedEffortLevels`; canonical `resolvedModel` IDs share alias capabilities | `effort` |
| OpenAI | Model metadata, or an explicit documented model entry | Responses `reasoning.effort` |
| Groq | Model metadata, or documented GPT-OSS / Muse Spark levels | `reasoning_effort` |
| OpenRouter | Model `reasoning.supported_efforts` | `reasoning.effort` |
| Custom compatible API | Explicit model metadata only | `reasoning_effort` |
| Claude API | Model `capabilities.effort` support flags | `output_config.effort` |
| Gemini | Model level metadata, or an explicit documented model entry | `generationConfig.thinkingConfig.thinkingLevel` |
| Ollama | `/api/show` `thinking.values`, including supported on/off controls | Native `/api/chat` `think` |

Explicit OpenAI reasoning choices and known GPT-6 models use Responses for tool calling and preserve opaque
reasoning items and real function-call IDs between steps. Requests use `store:
false` and request encrypted reasoning for replay. Claude API tool turns likewise
retain signed thinking blocks. OpenAI Responses and explicit Claude effort calls
have an output ceiling of at least 8192 tokens so thinking can finish before the
editor response; this is a ceiling, not a target. Other provider budgets and
ordinary chat-completion routes are retained. A response that exhausts its budget
without an answer or tool call reports an error instead of claiming success.

Catalog checks are cached for three minutes and scoped to provider, model,
endpoint, key and executable. Refresh and explicit effort saves recheck the source.
The preference write revalidates the active provider/model after that async check.
Credentials, other models and unrelated settings are untouched by this write.

An unresolved CLI default has no model-specific override. Unknown models and
models that expose only numeric thinking budgets do not receive invented named
levels. **Default** preserves existing behavior, including the existing low-effort
GPT-OSS compatibility default when no override was selected.

Primary references (checked 2026-11-05):

- [OpenAI reasoning and per-model support](https://developers.openai.com/api/docs/guides/reasoning)
- [Claude model capabilities](https://platform.claude.com/docs/en/api/models/retrieve)
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Gemini thinking levels](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Groq reasoning levels](https://console.groq.com/docs/reasoning)
- [OpenRouter per-model reasoning metadata](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [Ollama thinking discovery](https://docs.ollama.com/capabilities/thinking)
