# Demo video script (target 2:40)

Prep: seeded DB, Sandbox buyer account logged in to PayPal in another tab, an admin session ready.

| Time | Screen | Say / do |
|---|---|---|
| 0:00 | Landing | "PayPilot AI: describe what you need, AI agents research and budget it, you approve, PayPal Sandbox pays, the server verifies." Point at the Demo data notice. |
| 0:15 | Assistant | Type: "I need a laptop under 60000 for programming." Show product cards, budget verdict and the Agent activity trace (tools called). |
| 0:45 | Assistant | "Compare the first two." Show the comparison table. "Add the first one to my cart." |
| 1:00 | Cart | Show totals and the budget bar. Click Checkout: order is created as *awaiting approval*. |
| 1:15 | Checkout | Tick approval. "The agent cannot pay. Only I can, with PayPal's own buttons." Pay with the Sandbox buyer. |
| 1:35 | Checkout (optional) | Before paying, close the PayPal popup once: "Cancelled. Nothing was charged, the order is still open, and the client message never changes payment state." Then pay. |
| 1:45 | Order page | Status Paid, transaction row. "Marked paid only after the server verified amount, currency and order id. The webhook reaches the same idempotent code." |
| 2:00 | Dashboard | Totals, budget overview, recommendations with reasons, transaction analytics. "All from real records." |
| 2:15 | Admin | Users and roles, AI activity, payment overview, webhook log. |
| 2:30 | Close | "Honest limits: demo catalog, fixed FX rate, no refunds in-app. Code, docs and tests are in the repo." |
