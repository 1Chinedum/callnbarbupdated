export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const appConfig = {
  name: process.env.APP_NAME ?? "CallNBarb",
  url: process.env.APP_URL ?? "http://localhost:3000",
  isProd: process.env.NODE_ENV === "production",
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
  sessionDays: Number(process.env.SESSION_DAYS ?? 7),
  defaultCurrency: process.env.DEFAULT_CURRENCY ?? "NGN",
  defaultCountry: process.env.DEFAULT_COUNTRY ?? "NG",
  defaultCity: process.env.DEFAULT_CITY ?? "Lagos",
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY ?? "",
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? "",
  paystackWebhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET ?? "",
  allowDevPayments:
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_PAYMENTS === "true",
  cronSecret: process.env.CRON_SECRET ?? "",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 5_242_880),
};
