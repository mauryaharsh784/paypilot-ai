// TEST DOUBLE, NOT PAYPAL. A tiny local stand-in for the PayPal REST endpoints PayPilot calls, used only by
// scripts/test-payments.sh so the server-side payment verification logic can be exercised without network access
// or sandbox credentials. It proves PayPilot's handling of responses; it does NOT prove PayPal itself works.
// A real Sandbox payment is still required before submitting (see docs/PAYPAL.md).
import http from 'node:http';

const PORT = Number(process.env.MOCK_PAYPAL_PORT || 4010);
const byRequestId = new Map();
const orders = new Map();
let n = 0;
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase(); // real PayPal ids are globally unique; keep ours unique across restarts too
let mode = 'ok';       // ok | wrong_amount | pending | declined
let signature = 'SUCCESS'; // verification_status returned for webhook signature checks

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } }); });

http.createServer(async (req, res) => {
  const url = req.url || '';
  const body = req.method === 'POST' ? await readBody(req) : {};

  if (url === '/__mode' && req.method === 'POST') { mode = body.mode || mode; signature = body.signature || signature; return send(res, 200, { mode, signature }); }
  if (url === '/__state') return send(res, 200, { mode, signature, orders: [...orders.values()] });
  if (url === '/v1/oauth2/token') return send(res, 200, { access_token: 'mock-token', expires_in: 3600 });

  if (url === '/v2/checkout/orders' && req.method === 'POST') {
    const rid = req.headers['paypal-request-id'];
    if (rid && byRequestId.has(rid)) return send(res, 201, orders.get(byRequestId.get(rid)));
    const unit = body.purchase_units?.[0] || {};
    const id = `MOCK${RUN}O${++n}`;
    const o = { id, status: 'CREATED', purchase_units: [{ custom_id: unit.custom_id, amount: unit.amount }] };
    orders.set(id, o); if (rid) byRequestId.set(rid, id);
    return send(res, 201, o);
  }

  const m = url.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
  if (m) {
    const o = orders.get(m[1]);
    if (!o) return send(res, 404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] });
    if (!m[2]) return send(res, 200, o);
    if (o.status === 'COMPLETED') return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED', description: 'Already captured' }] });
    if (mode === 'declined') return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED', description: 'Declined' }] });
    const unit = o.purchase_units[0];
    const value = mode === 'wrong_amount' ? (Number(unit.amount.value) + 1).toFixed(2) : unit.amount.value;
    const status = mode === 'pending' ? 'PENDING' : 'COMPLETED';
    const cap = { id: `CAP${o.id}`, status, amount: { value, currency_code: unit.amount.currency_code }, custom_id: unit.custom_id };
    o.status = status === 'PENDING' ? 'CREATED' : 'COMPLETED';
    o.purchase_units = [{ ...unit, payments: { captures: [cap] } }];
    return send(res, 201, o);
  }

  if (url === '/v1/notifications/verify-webhook-signature') return send(res, 200, { verification_status: signature });
  send(res, 404, { name: 'NOT_FOUND', message: url });
}).listen(PORT, '127.0.0.1', () => console.log(`mock PayPal (test double) on :${PORT}`));
