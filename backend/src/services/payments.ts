import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { all, get, run, tx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { notify } from '../notify.js';
import { issueQr, revokeQr } from './qr.js';
import { transition } from './state.js';
import { formatNaira } from '../money.js';

// ---------------------------------------------------------------------------
// Provider abstraction. `paystack` talks to the real Paystack API.
// `demo` is a clearly-labelled simulator for development ONLY (config.ts refuses
// to start with PAYMENT_MODE=demo when NODE_ENV=production). Both run through
// the exact same verify -> settle path, so the booking logic is the real thing.
// ---------------------------------------------------------------------------

export interface VerifyResult {
  status: 'success' | 'failed' | 'pending';
  amountKobo: number;
  currency: string;
  raw?: unknown;
}

export interface PaymentProvider {
  name: 'demo' | 'paystack';
  initialize(p: { reference: string; amountKobo: number; currency: string; email: string; bookingId: number }): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<VerifyResult>;
  refund(p: { reference: string; amountKobo: number; refundReference: string }): Promise<{ ok: boolean; pending: boolean; message: string }>;
  transfer(p: { reference: string; amountKobo: number; bankCode: string | null; accountNumber: string; accountName: string }): Promise<{ ok: boolean; message: string }>;
}

const demoProvider: PaymentProvider = {
  name: 'demo',
  async initialize({ reference }) {
    return { authorizationUrl: `demo-checkout://${reference}` };
  },
  async verify(reference) {
    const p = get<any>('SELECT * FROM payments WHERE reference = ?', reference);
    if (!p) return { status: 'failed', amountKobo: 0, currency: 'NGN' };
    const outcome = (() => {
      try {
        return JSON.parse(p.provider_payload ?? '{}').demo_outcome;
      } catch {
        return undefined;
      }
    })();
    if (outcome === 'success') return { status: 'success', amountKobo: p.amount_kobo, currency: p.currency };
    if (outcome === 'failed') return { status: 'failed', amountKobo: p.amount_kobo, currency: p.currency };
    return { status: 'pending', amountKobo: p.amount_kobo, currency: p.currency };
  },
  async refund() {
    return { ok: true, pending: false, message: 'Demo refund recorded (no real money moved).' };
  },
  async transfer() {
    return { ok: true, message: 'Demo payout recorded (no real money moved).' };
  },
};

async function paystackFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.paystackSecretKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok && json.status !== false, json };
}

const paystackProvider: PaymentProvider = {
  name: 'paystack',
  async initialize({ reference, amountKobo, currency, email, bookingId }) {
    const r = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({ email, amount: amountKobo, currency, reference, callback_url: `${config.appUrl}/payment/callback`, metadata: { bookingId } }),
    });
    if (!r.ok) throw badRequest('Payment could not be started. Please try again.', 'PAYMENT_INIT_FAILED');
    return { authorizationUrl: r.json.data.authorization_url };
  },
  async verify(reference) {
    const r = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!r.ok) return { status: 'pending', amountKobo: 0, currency: 'NGN', raw: r.json };
    const d = r.json.data;
    const status = d.status === 'success' ? 'success' : ['failed', 'abandoned', 'reversed'].includes(d.status) ? 'failed' : 'pending';
    return { status, amountKobo: Number(d.amount), currency: String(d.currency), raw: d };
  },
  async refund({ reference, amountKobo }) {
    const r = await paystackFetch('/refund', { method: 'POST', body: JSON.stringify({ transaction: reference, amount: amountKobo }) });
    return { ok: r.ok, pending: true, message: r.ok ? 'Refund submitted to Paystack.' : 'Paystack rejected the refund request.' };
  },
  async transfer({ reference, amountKobo, bankCode, accountNumber, accountName }) {
    // Requires Paystack Transfers to be enabled on the business account.
    if (!bankCode) return { ok: false, message: 'Missing bank code.' };
    const rec = await paystackFetch('/transferrecipient', { method: 'POST', body: JSON.stringify({ type: 'nuban', name: accountName, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' }) });
    if (!rec.ok) return { ok: false, message: 'Could not create transfer recipient.' };
    const tr = await paystackFetch('/transfer', { method: 'POST', body: JSON.stringify({ source: 'balance', amount: amountKobo, recipient: rec.json.data.recipient_code, reference: reference.toLowerCase(), reason: 'CallNBarb payout' }) });
    return { ok: tr.ok, message: tr.ok ? `Transfer ${tr.json.data?.status ?? 'queued'}` : 'Transfer was rejected by Paystack.' };
  },
};

export const providerFor = (): PaymentProvider => (config.paymentMode === 'paystack' ? paystackProvider : demoProvider);

// ---------------------------------------------------------------------------

export const newReference = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(5).toString('hex').toUpperCase()}`;

export async function initializePayment(customer: { id: number; email: string }, bookingId: number) {
  const booking = get<any>('SELECT * FROM bookings WHERE id = ?', bookingId);
  if (!booking || booking.customer_id !== customer.id) throw notFound('Booking not found.');
  if (booking.status !== 'PENDING_PAYMENT') throw conflict('This booking is not awaiting payment.', 'NOT_PAYABLE');
  if (booking.hold_expires_at && booking.hold_expires_at < Date.now()) throw conflict('This time slot is no longer available.', 'HOLD_EXPIRED');

  const existing = get<any>(`SELECT * FROM payments WHERE booking_id = ? AND status = 'PENDING' ORDER BY id DESC`, bookingId);
  if (existing) {
    return { reference: existing.reference, authorizationUrl: existing.authorization_url, mode: providerFor().name, amountKobo: existing.amount_kobo, currency: existing.currency };
  }
  const reference = newReference('CNB');
  // The amount always comes from the booking row, never from the client.
  const init = await providerFor().initialize({ reference, amountKobo: booking.amount_kobo, currency: config.currency, email: customer.email, bookingId });
  run(
    `INSERT INTO payments (booking_id, customer_id, amount_kobo, currency, provider, reference, authorization_url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    bookingId, customer.id, booking.amount_kobo, config.currency, providerFor().name, reference, init.authorizationUrl,
  );
  return { reference, authorizationUrl: init.authorizationUrl, mode: providerFor().name, amountKobo: booking.amount_kobo, currency: config.currency };
}

export interface SettleOutcome {
  status: 'SUCCESSFUL' | 'FAILED' | 'PENDING';
  alreadyProcessed: boolean;
  refundId?: number;
  bookingId: number;
}

/** Idempotent: safe to call from verify, webhook, and reconciliation for the same reference any number of times. */
export function settlePayment(reference: string, result: VerifyResult): SettleOutcome {
  return tx(() => {
    const p = get<any>('SELECT * FROM payments WHERE reference = ?', reference);
    if (!p) throw notFound('Payment not found.');
    if (p.status === 'SUCCESSFUL' || p.status === 'REFUNDED') return { status: 'SUCCESSFUL', alreadyProcessed: true, bookingId: p.booking_id };
    if (p.status === 'FAILED' && result.status !== 'success') return { status: 'FAILED', alreadyProcessed: true, bookingId: p.booking_id };
    if (result.status === 'pending') return { status: 'PENDING', alreadyProcessed: false, bookingId: p.booking_id };

    if (result.status === 'failed') {
      run(`UPDATE payments SET status = 'FAILED', provider_payload = COALESCE(?, provider_payload) WHERE id = ?`, result.raw ? JSON.stringify(result.raw) : null, p.id);
      notify(p.customer_id, 'payment_failed', 'Payment failed', 'Payment could not be completed. Please try again.', { bookingId: p.booking_id });
      return { status: 'FAILED', alreadyProcessed: false, bookingId: p.booking_id };
    }

    // success: the provider must confirm the exact amount and currency we expect.
    if (result.amountKobo !== p.amount_kobo || result.currency !== p.currency) {
      run(`UPDATE payments SET status = 'FAILED', provider_payload = ? WHERE id = ?`, JSON.stringify({ error: 'amount_mismatch', got: result.amountKobo, expected: p.amount_kobo }), p.id);
      return { status: 'FAILED', alreadyProcessed: false, bookingId: p.booking_id };
    }
    run(`UPDATE payments SET status = 'SUCCESSFUL', verified = 1, verified_at = datetime('now') WHERE id = ?`, p.id);

    const b = get<any>('SELECT * FROM bookings WHERE id = ?', p.booking_id);
    if (b.status !== 'PENDING_PAYMENT') {
      // Paid after the hold expired / booking was cancelled: refund in full rather than keep the money.
      const r = run(
        `INSERT INTO refunds (payment_id, booking_id, amount_kobo, reason, reference) VALUES (?, ?, ?, ?, ?)`,
        p.id, b.id, p.amount_kobo, 'Payment received after booking expired', newReference('RF'),
      );
      return { status: 'SUCCESSFUL', alreadyProcessed: false, bookingId: b.id, refundId: r.id };
    }

    transition(b.id, 'CONFIRMED', { id: null, role: 'system' }, 'Payment verified');
    transition(b.id, 'BARBER_PENDING', { id: null, role: 'system' }, 'Awaiting barber acceptance');
    run('UPDATE bookings SET hold_expires_at = NULL WHERE id = ?', b.id);
    issueQr(b);
    notify(b.customer_id, 'payment_success', 'Payment successful', `We received ${formatNaira(p.amount_kobo)}. Your booking ${b.code} is confirmed — waiting for your barber to accept.`, { bookingId: b.id });
    notify(b.barber_id, 'new_booking', 'New booking request', `${b.service_name} on ${b.booking_date} at ${b.start_time}. Open the app to accept.`, { bookingId: b.id });
    return { status: 'SUCCESSFUL', alreadyProcessed: false, bookingId: b.id };
  });
}

export async function verifyAndSettle(reference: string): Promise<SettleOutcome> {
  const p = get<any>('SELECT * FROM payments WHERE reference = ?', reference);
  if (!p) throw notFound('Payment not found.');
  if (p.status === 'SUCCESSFUL' || p.status === 'REFUNDED') return { status: 'SUCCESSFUL', alreadyProcessed: true, bookingId: p.booking_id };
  const result = await providerFor().verify(reference); // always asked of the provider, never of the client
  const outcome = settlePayment(reference, result);
  if (outcome.refundId) await processRefund(outcome.refundId);
  return outcome;
}

// ---- Webhooks ---------------------------------------------------------------

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !config.paystackWebhookSecret) return false;
  const expected = createHmac('sha512', config.paystackWebhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleWebhookEvent(event: any): Promise<void> {
  const type: string = event?.event ?? '';
  const data = event?.data ?? {};
  const key = `${type}:${data.id ?? data.reference ?? ''}`;
  // Event-level idempotency: duplicates from Paystack are ignored.
  try {
    run('INSERT INTO webhook_events (event_key, event_type) VALUES (?, ?)', key, type);
  } catch {
    return;
  }
  if (type === 'charge.success' && data.reference) {
    // Do not trust the payload: re-verify with Paystack, then settle.
    if (get('SELECT 1 FROM payments WHERE reference = ?', String(data.reference))) await verifyAndSettle(String(data.reference));
  } else if (type === 'refund.processed' && data.transaction_reference) {
    const pay = get<any>('SELECT * FROM payments WHERE reference = ?', String(data.transaction_reference));
    if (pay) markRefundsSuccessful(pay.id);
  }
}

function markRefundsSuccessful(paymentId: number) {
  tx(() => {
    const rows = all<any>(`SELECT * FROM refunds WHERE payment_id = ? AND status IN ('PENDING','PROCESSING')`, paymentId);
    for (const r of rows) finishRefund(r.id, true);
  });
}

// ---- Refunds ------------------------------------------------------------------

/** Creates a refund row (inside the caller's tx). Returns its id; call processRefund() after the tx commits. */
export function createRefund(booking: any, amountKobo: number, reason: string, initiatedBy: number | null): number | null {
  if (amountKobo <= 0) return null;
  const p = get<any>(`SELECT * FROM payments WHERE booking_id = ? AND status = 'SUCCESSFUL' ORDER BY id DESC`, booking.id);
  if (!p) return null;
  const already = get<{ s: number }>(`SELECT COALESCE(SUM(amount_kobo),0) AS s FROM refunds WHERE payment_id = ? AND status != 'FAILED'`, p.id)!.s;
  const amount = Math.min(amountKobo, p.amount_kobo - already);
  if (amount <= 0) return null;
  return run(`INSERT INTO refunds (payment_id, booking_id, amount_kobo, reason, reference, initiated_by) VALUES (?, ?, ?, ?, ?, ?)`, p.id, booking.id, amount, reason, newReference('RF'), initiatedBy).id;
}

export function finishRefund(refundId: number, success: boolean) {
  const r = get<any>('SELECT * FROM refunds WHERE id = ?', refundId);
  if (!r || r.status === 'SUCCESSFUL') return;
  run('UPDATE refunds SET status = ? WHERE id = ?', success ? 'SUCCESSFUL' : 'FAILED', refundId);
  if (!success) return;
  const p = get<any>('SELECT * FROM payments WHERE id = ?', r.payment_id);
  const refunded = get<{ s: number }>(`SELECT COALESCE(SUM(amount_kobo),0) AS s FROM refunds WHERE payment_id = ? AND status = 'SUCCESSFUL'`, p.id)!.s;
  if (refunded >= p.amount_kobo) run(`UPDATE payments SET status = 'REFUNDED' WHERE id = ?`, p.id);
  const b = get<any>('SELECT * FROM bookings WHERE id = ?', r.booking_id);
  if (b.status === 'CANCELLED' && refunded >= p.amount_kobo) transition(b.id, 'REFUNDED', { id: null, role: 'system' }, 'Full refund processed');
  notify(b.customer_id, 'refund_processed', 'Refund processed', `${formatNaira(r.amount_kobo)} refund for booking ${b.code} has been processed.`, { bookingId: b.id });
}

export async function processRefund(refundId: number): Promise<void> {
  const r = get<any>('SELECT * FROM refunds WHERE id = ?', refundId);
  if (!r || r.status !== 'PENDING') return;
  const p = get<any>('SELECT * FROM payments WHERE id = ?', r.payment_id);
  run(`UPDATE refunds SET status = 'PROCESSING' WHERE id = ?`, refundId);
  let res: { ok: boolean; pending: boolean };
  try {
    res = await providerFor().refund({ reference: p.reference, amountKobo: r.amount_kobo, refundReference: r.reference });
  } catch {
    res = { ok: false, pending: false };
  }
  tx(() => {
    if (!res.ok) finishRefund(refundId, false);
    else if (!res.pending) finishRefund(refundId, true);
    // pending: stays PROCESSING until the refund.processed webhook arrives
  });
}

/** Retry sweep for refunds that were created but never submitted. */
export async function retryPendingRefunds() {
  for (const r of all<any>(`SELECT id FROM refunds WHERE status = 'PENDING'`)) await processRefund(r.id);
}

export function demoPayOutcome(reference: string, outcome: 'success' | 'failed') {
  if (config.paymentMode !== 'demo') throw badRequest('Demo checkout is disabled.', 'DEMO_DISABLED');
  const p = get<any>('SELECT * FROM payments WHERE reference = ?', reference);
  if (!p) throw notFound('Payment not found.');
  if (p.status !== 'PENDING') throw conflict('This payment has already been processed.');
  run('UPDATE payments SET provider_payload = ? WHERE id = ?', JSON.stringify({ demo_outcome: outcome }), p.id);
  return p;
}

export { revokeQr };
