# AI tools and usage

## Agents (`server/src/agents.ts`)
| Agent | Job | Tools it may call |
|---|---|---|
| Shopping | Turns the message into a structured intent (category, budget, use cases, action) | `get_user_preferences`, `get_cart_summary` |
| Research | Finds candidate products | `search_products`, `get_product` |
| Comparison | Explains trade-offs and picks a top product | `compare_products` |
| Budget | Affordability, value ranking, cheaper alternatives | `analyze_budget` |
| Payment | Prepares a checkout and answers order or refund questions | `prepare_checkout`, `get_my_orders` |

Pipeline for a search: Shopping -> Research -> (Comparison and Budget in parallel) -> response with product cards, budget analysis and an agent trace.

## Guardrails
- Tools read the real database. Research ids are re-checked against the DB, and the budget is a hard filter, so a model cannot invent or over-budget a product.
- Every model output is parsed with zod. If the model errors or returns invalid JSON, that agent falls back to deterministic rules for that step, and the trace records it.
- No agent can call PayPal. `prepare_checkout` only creates an `awaiting_approval` order. The user must tick approval and use PayPal's own buttons.
- Memory (saved preferences) is opt-in per suggestion and can be turned off in Settings, which also stops message previews being stored for monitoring.

## Modes
Set `GEMINI_API_KEY` or `OPENAI_API_KEY` for LLM mode (`GET /api/config` and the UI show the active mode). With no key the same tools and validation run in **rules mode**, which is deterministic and clearly labelled in each reply.

## Monitoring
Each request writes an `AgentRun` (intent, mode, per-agent timings, tool names, success or failure, 120-char message preview). Admins see it under Admin > AI activity.

## Other endpoints
`POST /api/ai/chat` and `POST /api/ai/agent/run` both run the full pipeline (aliases of `/api/assistant/message`). `POST /api/ai/recommendations` returns recommendations computed from preferences, wishlist and paid orders, each with human-readable reasons (no model involved).
