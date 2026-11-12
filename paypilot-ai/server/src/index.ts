
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

// Security middleware
app.use(helmet());

app.use(
  cors({
    origin: config.clientUrl,
    credentials: true
  })
);

// Root route
app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to PayPilot AI Backend',
    status: 'running',
    health: '/api/health'
  });
});

// Health check
app.get('/api/health', (_req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;

  res.status(dbConnected ? 200 : 503).json({
    success: dbConnected,
    status: dbConnected ? 'healthy' : 'unhealthy',
    service: 'PayPilot AI Backend',
    database: dbConnected ? 'connected' : 'disconnected'
  });
});

// PayPal webhook - raw body required for signature verification
const rawBody = express.raw({
  type: '*/*',
  limit: '1mb'
});

app.post('/api/webhooks/paypal', rawBody, webhookHandler);
app.post('/api/paypal/webhook', rawBody, webhookHandler);

// Body parsers
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// General API rate limiting
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Authentication routes
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false
  }),
  authRouter
);

// AI rate limiting
const chatLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(['/api/assistant/message', '/api/ai'], chatLimit);

// Payment event rate limiting
app.use(
  '/api/orders/:id/payment-event',
  rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Main API routes
app.use('/api', api);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    code: 'NOT_FOUND'
  });
});

// Global error handler
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: err.issues
          .map(
            (i) =>
              `${i.path.join('.') || 'body'}: ${i.message}`
          )
          .join('; '),
        code: 'VALIDATION'
      });
    }

    if (err instanceof AppError) {
      return res.status(err.status).json({
        error: err.message,
        code: err.code,
        ...(err.data ? { data: err.data } : {})
      });
    }

    console.error('Server error:', err);

    return res.status(500).json({
      error: 'Something went wrong on our side. Try again.',
      code: 'INTERNAL'
    });
  }
);

// Start server after successful MongoDB connection
const startServer = async () => {
  try {
    await mongoose.connect(config.mongoUri);

    console.log('MongoDB connected successfully');

    app.listen(config.port, '0.0.0.0', () => {
      console.log(`PayPilot API running on port ${config.port}`);
      console.log(
        `PayPal: ${config.paypal.clientId ? 'Configured' : 'NOT configured'}`
      );
      console.log(`AI Provider: ${config.ai.provider}`);
    });
  } catch (error: any) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

startServer();
