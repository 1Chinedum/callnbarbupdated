import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { join, resolve } from 'node:path';
import { config } from './config.js';
import { errorHandler, notFound } from './errors.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { meRouter } from './routes/me.js';
import { barberRouter } from './routes/barber.js';
import { bookingsRouter, paymentsRouter, qrRouter } from './routes/bookings.js';
import { adminRouter } from './routes/admin.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // The same server also serves the web app, so the CSP must allow OpenStreetMap tiles, inline styles
    // set by the map library, and camera/blob streams for the QR scanner.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        workerSrc: ["'self'", 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  }));
  // The Android app and admin dashboard send a bearer token (no cookies), so CSRF does not apply.
  app.use(cors());

  const isTest = process.env.NODE_ENV === 'test';
  const limiter = (windowMs: number, max: number) => rateLimit({ windowMs, max: isTest ? 100_000 : max, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' } } });

  app.use('/api', limiter(60_000, 300));
  app.use('/api/auth', limiter(15 * 60_000, 40));
  app.use('/api/qr', limiter(60_000, 30));

  // Webhook needs the raw body, so it is mounted before the JSON parser.
  app.use('/api/payments', paymentsRouterWithParsers());

  const json = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path === '/api/me/uploads' ? next() : json(req, res, next)));

  app.get('/health', (_req, res) => res.json({ ok: true, paymentMode: config.paymentMode }));
  app.use('/uploads', express.static(resolve(join(config.uploadDir, 'public')), { maxAge: '7d', index: false }));

  app.use('/api/auth', authRouter);
  app.use('/api', publicRouter);
  app.use('/api/me', meRouter);
  app.use('/api/barber', barberRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/qr', qrRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Endpoint not found.')));

  // The Android app, mobile web app and admin dashboard (static files; routing is client-side via #hash).
  app.use(express.static(resolve(config.webDir), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));
  app.use(errorHandler);
  return app;
}

// payments router handles its own body parsing (raw for webhook, JSON for the rest)
function paymentsRouterWithParsers() {
  const r = express.Router();
  r.use((req, res, next) => (req.path === '/webhook' ? next() : express.json({ limit: '100kb' })(req, res, next)));
  r.use(paymentsRouter);
  return r;
}
