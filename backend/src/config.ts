import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name: string, fallback?: string): string {
  const v = env[name] ?? fallback;
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  isProd,
  port: Number(env.PORT ?? 4000),
  appUrl: env.APP_URL ?? 'http://localhost:4000',
  dbPath: env.DB_PATH ?? './data/callnbarb.db',
  uploadDir: env.UPLOAD_DIR ?? './data/uploads',
  webDir: env.WEB_DIR ?? '../app/www',
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-only-jwt-secret-change-me'),
  qrSecret: required('QR_SECRET', isProd ? undefined : 'dev-only-qr-secret-change-me'),
  paymentMode: (env.PAYMENT_MODE ?? 'demo') as 'demo' | 'paystack',
  paystackPublicKey: env.PAYSTACK_PUBLIC_KEY ?? '',
  paystackSecretKey: env.PAYSTACK_SECRET_KEY ?? '',
  paystackWebhookSecret: env.PAYSTACK_WEBHOOK_SECRET || env.PAYSTACK_SECRET_KEY || '',
  adminEmail: env.ADMIN_EMAIL ?? '',
  adminPassword: env.ADMIN_PASSWORD ?? '',
  currency: 'NGN',
};

if (isProd && config.paymentMode === 'demo') {
  throw new Error('PAYMENT_MODE=demo is not allowed when NODE_ENV=production');
}
if (config.paymentMode === 'paystack' && !config.paystackSecretKey) {
  throw new Error('PAYMENT_MODE=paystack requires PAYSTACK_SECRET_KEY');
}
