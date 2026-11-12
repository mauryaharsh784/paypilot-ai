# Architecture

```
React (Vite, Tailwind, Recharts)  --/api-->  Express API  --> MongoDB (Mongoose)
        |                                       |   |
        | PayPal JS Buttons                     |   +--> LLM (Gemini/OpenAI) or rules mode
        v                                       v
   PayPal Sandbox <---- Orders API / Webhooks --+
```

## Server (`server/src`)
| File | Responsibility |
|---|---|
| `index.ts` | Express app, Helmet, CORS (credentials, single origin), rate limits (general, auth, AI), raw-body webhook route, central error handler |
| `config.ts` | Env-based config. Refuses to boot in production without `JWT_SECRET` |
| `auth.ts` | Register/login/logout/me, bcrypt, JWT in an HTTP-only cookie, `requireAuth`, `requireAdmin` (role re-read from the DB) |
| `models.ts` | Mongoose models, validation, indexes |
| `tools.ts` | Data tools used by agents and routes: search, compare, budget, cart, recommendations |
| `agents.ts` | Five agents and the orchestration pipeline, AgentRun logging |
| `llm.ts` | Gemini/OpenAI function-calling adapter with zod-validated JSON output |
| `payments.ts` | Order preparation, PayPal order creation, capture, `markPaid` |
| `paypal.ts` | Thin PayPal REST client (OAuth, Orders v2, webhook verification) |
| `routes.ts` | REST routes (customer, admin, webhook) |
| `seed.ts` | Demo catalog (25 products) and admin user |

## Data model
| Spec model | Implementation |
|---|---|
| User | `User` (bcrypt hash, role, preferences, settings) |
| ShoppingPreference | Embedded in `User.preferences` (brands, categories, maxBudget, specs). Editable and clearable in Profile |
| Product | `Product` plus `PricePoint` (real price history) |
| Cart | `Cart` (one per user, items, optional budget) |
| Order | `Order` (server-computed totals, INR and charge currency, status machine, capture lock) |
| Transaction | `Transaction` (capture, failure, pending, cancel, refund; unique partial index on capture id) |
| Conversation, Message | `ChatSession` with embedded messages (capped at 60) |
| Wishlist, PriceWatch, Notification | Own collections, unique per user and product where relevant |
| (extra) WebhookEvent | Stores PayPal event ids for idempotency |
| (extra) AgentRun | One row per assistant request for admin AI monitoring |

No card numbers or PayPal credentials are ever stored. Only PayPal order and capture ids are kept.

## Order status machine
`awaiting_approval` -> (user approves) -> `awaiting_payment` -> (verified capture or webhook) -> `paid`.
Side exits: `cancelled`, `failed`. `paid` is only ever set by `markPaid` in `payments.ts`.

## Frontend (`client/src`)
React Router pages: Landing, Auth, Dashboard, Assistant, Catalog (discover, compare, product), Cart/Purchase, History (orders, transactions), Lists (wishlist, price watch), Account (profile, settings, notifications), Admin. Zustand holds session and compare state. The API client sends cookies and never holds secrets. Only `VITE_API_URL` is exposed to the browser, and it is optional.

## Demo data policy
The catalog is a seeded sample with fictional brands. The UI shows a persistent "Demo data" notice and "Demo data" badges on recommendations. Nothing is scraped, and no live pricing or inventory is claimed. To use a real provider, replace the seed with an importer that writes to `Product` (the admin API `POST /api/admin/products` already accepts the same shape).
