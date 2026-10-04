import { get, run, tx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { notify } from '../notify.js';
import { getSettings } from '../settings.js';
import { audit } from '../notify.js';
import { providerFor } from './payments.js';

export const BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '058', name: 'Guaranty Trust Bank (GTBank)' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa (UBA)' },
  { code: '057', name: 'Zenith Bank' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '032', name: 'Union Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '214', name: 'First City Monument Bank (FCMB)' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '999992', name: 'OPay' },
  { code: '999991', name: 'PalmPay' },
  { code: '50211', name: 'Kuda Microfinance Bank' },
  { code: '50515', name: 'Moniepoint MFB' },
]; // Verify codes against Paystack's /bank list before going live.

export function ensureWallet(barberId: number): { id: number; available_balance_kobo: number } {
  run('INSERT OR IGNORE INTO wallets (barber_id) VALUES (?)', barberId);
  return get('SELECT id, available_balance_kobo FROM wallets WHERE barber_id = ?', barberId)!;
}

/**
 * Single choke point for balance changes. Every change writes a ledger row with
 * before/after balances. MUST be called inside tx().
 */
export function postLedger(opts: {
  barberId: number;
  type: 'SERVICE_EARNING' | 'PLATFORM_FEE' | 'WITHDRAWAL' | 'REFUND' | 'ADJUSTMENT' | 'REVERSAL';
  amountKobo: number; // signed: + credits, - debits
  description: string;
  bookingId?: number | null;
  withdrawalId?: number | null;
  status?: string;
}) {
  const w = ensureWallet(opts.barberId);
  const before = w.available_balance_kobo;
  const after = before + opts.amountKobo;
  if (after < 0) throw badRequest('Insufficient wallet balance.', 'INSUFFICIENT_FUNDS');
  const r = run(
    `INSERT INTO wallet_transactions (wallet_id, barber_id, booking_id, withdrawal_id, type, amount_kobo, balance_before_kobo, balance_after_kobo, status, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    w.id,
    opts.barberId,
    opts.bookingId ?? null,
    opts.withdrawalId ?? null,
    opts.type,
    opts.amountKobo,
    before,
    after,
    opts.status ?? 'COMPLETED',
    opts.description,
  );
  run('UPDATE wallets SET available_balance_kobo = ? WHERE id = ?', after, w.id);
  return { id: r.id, before, after };
}

/** Credits the barber for a completed booking. Idempotent via a unique index on (booking_id, type). MUST run in tx(). */
export function creditCompletedBooking(booking: any) {
  const already = get('SELECT 1 FROM wallet_transactions WHERE booking_id = ? AND type = ?', booking.id, 'SERVICE_EARNING');
  if (already) return false;
  const commission = booking.service_price_kobo - booking.barber_earning_kobo;
  postLedger({
    barberId: booking.barber_id,
    type: 'SERVICE_EARNING',
    amountKobo: booking.service_price_kobo,
    bookingId: booking.id,
    description: `${booking.service_name} (${booking.code})`,
  });
  postLedger({
    barberId: booking.barber_id,
    type: 'PLATFORM_FEE',
    amountKobo: -commission,
    bookingId: booking.id,
    description: `Platform commission ${(booking.commission_bps / 100).toFixed(2)}% (${booking.code})`,
  });
  run('UPDATE wallets SET total_earnings_kobo = total_earnings_kobo + ? WHERE barber_id = ?', booking.barber_earning_kobo, booking.barber_id);
  return true;
}

/** Reverses a previously credited booking (admin dispute refund). MUST run in tx(). */
export function reverseBookingCredit(booking: any, adminId: number) {
  const credited = get('SELECT 1 FROM wallet_transactions WHERE booking_id = ? AND type = ?', booking.id, 'SERVICE_EARNING');
  const reversed = get('SELECT 1 FROM wallet_transactions WHERE booking_id = ? AND type = ?', booking.id, 'REVERSAL');
  if (!credited || reversed) return false;
  // Allow wallet to cover as much as it can; a shortfall is recorded for admin follow-up.
  const w = ensureWallet(booking.barber_id);
  const amount = Math.min(booking.barber_earning_kobo, w.available_balance_kobo);
  postLedger({
    barberId: booking.barber_id,
    type: 'REVERSAL',
    amountKobo: -amount,
    bookingId: booking.id,
    description: `Earning reversed after dispute (${booking.code})`,
  });
  run('UPDATE wallets SET total_earnings_kobo = MAX(0, total_earnings_kobo - ?) WHERE barber_id = ?', booking.barber_earning_kobo, booking.barber_id);
  audit(adminId, 'WALLET_REVERSAL', 'booking', booking.id, { amount, shortfall: booking.barber_earning_kobo - amount });
  return true;
}

export function getWalletSummary(barberId: number) {
  const w = ensureWallet(barberId);
  const row = get<any>('SELECT * FROM wallets WHERE id = ?', w.id);
  // Pending = net earnings on accepted, not-yet-completed jobs (held by the platform until QR scan).
  const pending = get<{ s: number }>(
    `SELECT COALESCE(SUM(barber_earning_kobo),0) AS s FROM bookings WHERE barber_id = ? AND status IN ('ACCEPTED','ON_THE_WAY','ARRIVED','VERIFIED','IN_PROGRESS')`,
    barberId,
  )!.s;
  const withdrawalsPending = get<{ s: number }>(
    `SELECT COALESCE(SUM(amount_kobo),0) AS s FROM withdrawals WHERE barber_id = ? AND status IN ('PENDING','PROCESSING')`,
    barberId,
  )!.s;
  return {
    availableKobo: row.available_balance_kobo,
    pendingKobo: pending,
    totalEarningsKobo: row.total_earnings_kobo,
    totalWithdrawnKobo: row.total_withdrawn_kobo,
    withdrawalsInProgressKobo: withdrawalsPending,
  };
}

// ---- Withdrawals ----------------------------------------------------------

export function requestWithdrawal(barberId: number, amountKobo: number) {
  const s = getSettings();
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) throw badRequest('Enter a valid amount.');
  if (amountKobo < s.min_withdrawal_kobo) {
    throw badRequest(`The minimum withdrawal is ₦${(s.min_withdrawal_kobo / 100).toLocaleString('en-NG')}.`, 'BELOW_MINIMUM');
  }
  return tx(() => {
    const profile = get<any>('SELECT * FROM barber_profiles WHERE user_id = ?', barberId);
    if (!profile || profile.verification_status !== 'VERIFIED') throw conflict('Only verified barbers can withdraw.');
    if (!profile.bank_name || !profile.account_number || !profile.account_name) {
      throw badRequest('Add your bank details in your profile before withdrawing.', 'NO_BANK_DETAILS');
    }
    const open = get('SELECT 1 FROM withdrawals WHERE barber_id = ? AND status IN (\'PENDING\',\'PROCESSING\')', barberId);
    if (open) throw conflict('You already have a withdrawal in progress.', 'WITHDRAWAL_IN_PROGRESS');
    const w = ensureWallet(barberId);
    if (w.available_balance_kobo < amountKobo) throw badRequest('Withdrawal amount is more than your available balance.', 'INSUFFICIENT_FUNDS');
    const reference = `WD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const wd = run(
      `INSERT INTO withdrawals (barber_id, amount_kobo, bank_code, bank_name, account_number, account_name, reference) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      barberId,
      amountKobo,
      profile.bank_code,
      profile.bank_name,
      profile.account_number,
      profile.account_name,
      reference,
    );
    // Funds are held (debited) immediately so they cannot be withdrawn twice.
    postLedger({ barberId, type: 'WITHDRAWAL', amountKobo: -amountKobo, withdrawalId: wd.id, status: 'PENDING', description: `Withdrawal ${reference}` });
    notify(barberId, 'withdrawal_requested', 'Withdrawal requested', `Your withdrawal request ${reference} is being reviewed.`, { withdrawalId: wd.id });
    return get<any>('SELECT * FROM withdrawals WHERE id = ?', wd.id);
  });
}

function releaseWithdrawal(w: any, finalStatus: 'FAILED' | 'REJECTED', note: string) {
  postLedger({ barberId: w.barber_id, type: 'REVERSAL', amountKobo: w.amount_kobo, withdrawalId: w.id, description: `Withdrawal ${w.reference} ${finalStatus.toLowerCase()} — funds returned` });
  run(`UPDATE wallet_transactions SET status = ? WHERE withdrawal_id = ? AND type = 'WITHDRAWAL'`, 'REVERSED', w.id);
  run(`UPDATE withdrawals SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?`, finalStatus, note, w.id);
}

export function rejectWithdrawal(id: number, adminId: number, note: string) {
  tx(() => {
    const w = get<any>('SELECT * FROM withdrawals WHERE id = ?', id);
    if (!w) throw notFound('Withdrawal not found.');
    if (!['PENDING', 'PROCESSING'].includes(w.status)) throw conflict('This withdrawal has already been finalised.');
    releaseWithdrawal(w, 'REJECTED', note);
    audit(adminId, 'WITHDRAWAL_REJECTED', 'withdrawal', id, { note });
    notify(w.barber_id, 'withdrawal_rejected', 'Withdrawal rejected', `Your withdrawal ${w.reference} was rejected. The funds are back in your wallet. ${note}`, { withdrawalId: id });
  });
}

export function approveWithdrawal(id: number, adminId: number) {
  tx(() => {
    const w = get<any>('SELECT * FROM withdrawals WHERE id = ?', id);
    if (!w) throw notFound('Withdrawal not found.');
    if (w.status !== 'PENDING') throw conflict('Only pending withdrawals can be approved.');
    run(`UPDATE withdrawals SET status = 'PROCESSING', updated_at = datetime('now') WHERE id = ?`, id);
    audit(adminId, 'WITHDRAWAL_APPROVED', 'withdrawal', id, { amount: w.amount_kobo });
  });
}

/** Sends the payout through the payment provider, then finalises. Never trusts the client. */
export async function processWithdrawal(id: number, adminId: number) {
  const w = get<any>('SELECT * FROM withdrawals WHERE id = ?', id);
  if (!w) throw notFound('Withdrawal not found.');
  if (w.status !== 'PROCESSING') throw conflict('Approve the withdrawal before processing it.');
  let result: { ok: boolean; message: string };
  try {
    result = await providerFor().transfer({ reference: w.reference, amountKobo: w.amount_kobo, bankCode: w.bank_code, accountNumber: w.account_number, accountName: w.account_name });
  } catch (e) {
    result = { ok: false, message: 'Payout provider error' };
  }
  tx(() => {
    const fresh = get<any>('SELECT * FROM withdrawals WHERE id = ?', id);
    if (fresh.status !== 'PROCESSING') return; // already finalised elsewhere
    if (result.ok) {
      run(`UPDATE withdrawals SET status = 'SUCCESSFUL', admin_note = ?, updated_at = datetime('now') WHERE id = ?`, result.message, id);
      run(`UPDATE wallet_transactions SET status = 'COMPLETED' WHERE withdrawal_id = ? AND type = 'WITHDRAWAL'`, id);
      run('UPDATE wallets SET total_withdrawn_kobo = total_withdrawn_kobo + ? WHERE barber_id = ?', fresh.amount_kobo, fresh.barber_id);
      audit(adminId, 'WITHDRAWAL_PROCESSED', 'withdrawal', id, { amount: fresh.amount_kobo, message: result.message });
      notify(fresh.barber_id, 'withdrawal_completed', 'Withdrawal completed', `₦${(fresh.amount_kobo / 100).toLocaleString('en-NG')} has been sent to your bank account.`, { withdrawalId: id });
    } else {
      releaseWithdrawal(fresh, 'FAILED', result.message);
      audit(adminId, 'WITHDRAWAL_FAILED', 'withdrawal', id, { message: result.message });
      notify(fresh.barber_id, 'withdrawal_failed', 'Withdrawal failed', `Your withdrawal ${fresh.reference} could not be processed. The funds are back in your wallet.`, { withdrawalId: id });
    }
  });
  return get<any>('SELECT * FROM withdrawals WHERE id = ?', id);
}
