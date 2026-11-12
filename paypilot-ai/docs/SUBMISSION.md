# PayPilot AI: submission write-up

Hackathon: "Build What's Next with PayPal and AI". Copy the sections below into the submission form and keep the checklist at the end up to date.

## One-liner
PayPilot AI is a shopping assistant where AI agents research, compare and budget a cart, the user explicitly approves it, and PayPal Sandbox takes the payment. The server verifies every payment before an order counts as paid.

## Problem
AI shopping assistants are good at suggesting products but are not trusted with payments. Naive integrations either let the model trigger a charge, or trust the browser's "payment succeeded" message. Both are unsafe.

## What it does
- Five tool-calling agents (Shopping, Research, Comparison, Budget, Payment) work from the real product database. Product ids are validated against the DB and the budget is a hard filter, so a model cannot invent a product or exceed the budget.
- Agents can only prepare an order. They cannot call PayPal. Payment starts only after an explicit user approval.
- Checkout re-prices from the live catalog, creates a PayPal order, and captures after the buyer approves in the PayPal Buttons.
- The dashboard, orders, transactions, wishlist, price watch and admin views show the whole lifecycle.

## How PayPal is used
- **Orders API v2:** create (`intent: CAPTURE`, `custom_id` = our order id), capture, and get.
- **Webhooks:** `PAYMENT.CAPTURE.COMPLETED`, `DENIED`, `DECLINED`, `REFUNDED`, verified with PayPal's `verify-webhook-signature` API on the raw request body.
- **Sandbox** buyer accounts. No card data ever touches our server.

## Why the payment flow is safe
| Risk | How it is handled |
|---|---|
| Model or client triggers a charge | Agents only prepare orders. Approval requires an explicit `confirm: true`. |
| Client claims "paid" | Client cancel/error events are only logged. Only a server-side capture or a verified webhook can mark an order paid. |
| Wrong or tampered amount | `markPaid` checks status, amount, currency and `custom_id` (must equal the order id). A mismatch is logged as a rejected transaction and the order stays unpaid. |
| Price changed after review | Re-priced on approval. The user gets `PRICE_CHANGED` and must approve the new total. |
| Double capture or double click | Per-order capture lock, deterministic `PayPal-Request-Id`, atomic paid transition, unique index on the capture id. |
| Reused request id | A new request id per PayPal order attempt, so PayPal cannot replay an old amount. |
| Duplicate or replayed webhooks | Event id stored once. Finished duplicates are ignored. In-progress events get a 409 so PayPal retries. Crashed runs are taken over after 2 minutes. |
| Forged webhook | Signature verified through PayPal. Missing headers or webhook id are rejected. |
| Missed webhook | `POST /api/admin/orders/:id/sync` reconciles one order with PayPal. |

## Built with
React 18, TypeScript, Vite, Tailwind, Node, Express, MongoDB/Mongoose, Gemini or OpenAI function calling (with a labelled rules mode when no key is set), PayPal Orders API v2 and Webhooks.

## Challenges
- Keeping agents useful without letting them touch money.
- Making payment state correct when the browser, the capture call and the webhook can all arrive in any order, more than once.
- PayPal request-id replay: a reused id returns the original order, so the id has to change when the amount changes.

## Honest limitations
- The catalog is sample data with fictional brands. Product images are illustrations unless you add photos.
- INR prices are converted to the PayPal currency at a fixed rate.
- Refunds are not issued by the app. Refunds made in PayPal are recorded via webhook.
- Real Sandbox checkout and webhook delivery must be demonstrated by the team (see checklist).

## What's next
Live FX rates, refunds from the admin view (with order status and stock handling), a scheduled reconciliation job, unit tests, and a real product catalog import.

## Links (fill in before submitting)
- Repository: TODO
- Live demo: TODO
- Demo video: TODO
- Sandbox buyer login for judges: put it in the private submission notes, never in the repo.

## Submission checklist
Code (run from `server/` and `client/`):
- [ ] `npm run typecheck` and `npm run build` pass in both folders
- [ ] `npm run test:e2e`, `npm run test:payments`, `npm run test:acceptance` all pass against a seeded MongoDB
- [ ] CI (`.github/workflows/ci.yml`) is green on the repo

Real PayPal evidence (the mock does not prove PayPal accepts our requests):
- [ ] One real Sandbox checkout reaches Paid (screenshot of the order and the PayPal Sandbox transaction)
- [ ] One real webhook appears in Admin > Overview > Webhook log
- [ ] One failed or cancelled payment shown in the demo

Repository hygiene:
- [ ] No `.env` file or key committed (`.gitignore` already excludes them). Rotate any key that was ever pasted into a chat or commit.
- [ ] `JWT_SECRET`, admin password and PayPal keys set as host environment variables, not in files
- [ ] LICENSE present (MIT)

Deployment and demo:
- [ ] Atlas, Render and Vercel set up as in the README "Deploy" section, and the webhook registered with the Render URL
- [ ] Demo video recorded following `docs/DEMO_SCRIPT.md`
- [ ] Links above filled in
