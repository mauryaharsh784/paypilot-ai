# PayPal integration (Sandbox)

## Flow
1. `POST /api/checkout/prepare` creates an order with server-computed totals (INR converted to `PAYPAL_CURRENCY` at `INR_PER_UNIT`).
2. `POST /api/orders/:id/approve {confirm:true}` (alias `POST /api/paypal/create-order {orderId, confirm:true}`) re-prices from the live catalog (409 `PRICE_CHANGED` if anything moved), then creates the PayPal order with a `PayPal-Request-Id` for idempotency (`create-<orderId>`, plus an attempt suffix after a price change, because PayPal replays the original response for a reused id).
3. The browser shows PayPal Buttons. On approval it calls `POST /api/orders/:id/capture {paypalOrderId}` (alias `POST /api/paypal/capture-order`). The server takes a per-order lock, captures, then verifies status, amount, currency and `custom_id` (required) before `markPaid`.
4. `POST /api/webhooks/paypal` (alias `/api/paypal/webhook`) receives raw bytes, verifies the signature with PayPal's `verify-webhook-signature` API, stores the event id once, and reaches the same idempotent `markPaid`. An event that is still being processed returns 409 (PayPal retries); one whose earlier run crashed is taken over after 2 minutes. A capture whose PayPal order id differs from the one the order holds is logged as `order_mismatch` and ignored. Handled: `PAYMENT.CAPTURE.COMPLETED`, `DENIED`, `DECLINED`, `REFUNDED`.
5. Client-reported cancel or error only writes a log row. It never changes payment state.
6. `POST /api/admin/orders/:id/sync` (admin only) reconciles one order with PayPal when a webhook was missed. It reuses the same verification and `markPaid`.

## Setup
1. developer.paypal.com > Apps & Credentials > Sandbox > create an app. Put Client ID and Secret in `server/.env`.
2. Add a webhook to the app pointing at `https://<public-api-host>/api/webhooks/paypal` (ngrok locally). Subscribe to the four capture events above. Put its id in `PAYPAL_WEBHOOK_ID`. Without it, webhooks are rejected (400) by design.
3. Pay with a Sandbox *personal* account.

## What is verified automatically, and what is not
`npm run test:payments` runs 47 checks against `scripts/mock-paypal.mjs`, a **local test double, not PayPal**. It proves PayPilot correctly handles: approval gate, foreign order ids, amount and currency mismatch, tampered and non-COMPLETED webhooks, bad signatures, duplicate events, webhook-only completion, declined and pending captures, concurrent captures (one wins), idempotent re-capture, stock and cart effects, price change between review and approval.

It does **not** prove that real PayPal accepts our requests. Before submitting, run one real Sandbox checkout and one real webhook delivery, and tick them off in the checklist in the README.

`PAYPAL_API_BASE` exists only for the mock and is ignored when `NODE_ENV=production`.

## Known limits
- Refunds are not issued by the app. A refund made in PayPal is recorded via webhook.
- A webhook whose amount fails verification returns an error and is removed from the dedupe table, so PayPal will retry it. This is intentional, and the mismatch is logged as a rejected transaction.
- INR is converted at a fixed rate. Use a live rate source for production.
