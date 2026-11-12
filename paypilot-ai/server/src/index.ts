import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { config } from './config';
import { authRouter } from './auth';
import { api, webhookHandler } from './routes';
import { AppError } from './http';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.clientUrl, credentials: true }));

// Raw body is required to verify PayPal's webhook signature, so this is mounted before express.json().
const rawBody = express.raw({ type: '*/*', limit: '1mb' });
app.post('/api/webhooks/paypal', rawBody, webhookHandler);
app.post('/api/paypal/webhook', rawBody, webhookHandler); // spec alias, same handler

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false })); // general per-IP cap; stricter limits on auth and AI below
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }), authRouter);
const chatLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
app.use(['/api/assistant/message', '/api/ai'], chatLimit);
app.use('/api/orders/:id/payment-event', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false })); // client-reported events only create log rows
app.use('/api', api);

app.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), code: 'VALIDATION' });
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.data ? { data: err.data } : {}) });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.', code: 'INTERNAL' });
});

mongoose.connect(config.mongoUri).then(() => {
  app.listen(config.port, () => console.log(`PayPilot API on :${config.port} | PayPal ${config.paypal.clientId ? 'configured' : 'NOT configured'} | AI ${config.ai.provider}`));
}).catch((e) => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
