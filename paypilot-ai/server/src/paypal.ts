import { config } from './config';

export class PayPalError extends Error {
  constructor(public status: number, message: string, public issue?: string, public debugId?: string) { super(message); }
}

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.secret}`).toString('base64');
  const r = await fetch(`${config.paypal.base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PayPalError(r.status, j.error_description || 'PayPal authentication failed', j.error);
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function call(path: string, init: { method?: string; body?: any; requestId?: string } = {}) {
  const token = await accessToken();
  const r = await fetch(`${config.paypal.base}${path}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.requestId ? { 'PayPal-Request-Id': init.requestId } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const issue = j.details?.[0]?.issue || j.name;
    throw new PayPalError(r.status, j.details?.[0]?.description || j.message || 'PayPal request failed', issue, j.debug_id);
  }
  return j;
}

export const paypal = {
  configured: () => !!(config.paypal.clientId && config.paypal.secret),

  createOrder: (o: { id: string; amount: number; currency: string; attempt?: number }) =>
    call('/v2/checkout/orders', {
      method: 'POST',
      requestId: `create-${o.id}${o.attempt ? `-${o.attempt}` : ''}`, // new id per attempt: PayPal replays the old response for a reused id, even if the amount changed
      body: {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: o.id,
          custom_id: o.id,
          description: `PayPilot AI order ${o.id.slice(-8)}`,
          amount: { currency_code: o.currency, value: o.amount.toFixed(2) },
        }],
        application_context: { brand_name: 'PayPilot AI', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
      },
    }),

  capture: (paypalOrderId: string, requestId: string) =>
    call(`/v2/checkout/orders/${paypalOrderId}/capture`, { method: 'POST', body: {}, requestId }),

  getOrder: (paypalOrderId: string) => call(`/v2/checkout/orders/${paypalOrderId}`),

  async verifyWebhook(headers: Record<string, any>, rawBody: string): Promise<boolean> {
    if (!config.paypal.webhookId) return false;
    const j = await call('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: {
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: config.paypal.webhookId,
        webhook_event: JSON.parse(rawBody),
      },
    });
    return j.verification_status === 'SUCCESS';
  },
};
