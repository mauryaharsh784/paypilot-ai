import 'dotenv/config';

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
const provider = process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : 'none');

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/paypilot',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  cookieSameSite: (process.env.COOKIE_SAMESITE || 'lax') as 'lax' | 'none' | 'strict',
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    secret: process.env.PAYPAL_CLIENT_SECRET || '',
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
    // PAYPAL_API_BASE exists only so the automated tests can point at scripts/mock-paypal.mjs. It is ignored in production.
    base: (process.env.NODE_ENV !== 'production' && process.env.PAYPAL_API_BASE) || (process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'),
    currency: process.env.PAYPAL_CURRENCY || 'USD',
    inrPerUnit: num(process.env.INR_PER_UNIT, 88),
  },
  ai: {
    provider: provider as 'gemini' | 'openai' | 'none',
    geminiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    openaiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
};

if (config.env === 'production' && config.jwtSecret === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
