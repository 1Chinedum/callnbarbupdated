import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx } from '../db.js';
import { me, requireAuth, requireRole } from '../auth.js';
import { audit, notify } from '../notify.js';
import { badRequest, conflict, notFound, parse, wrap } from '../errors.js';
import { getSettings, updateSettings } from '../settings.js';
import { addDays, lagosNow } from '../time.js';
import { approveWithdrawal, creditCompletedBooking, getWalletSummary, processWithdrawal, rejectWithdrawal, reverseBookingCredit } from '../services/wallet.js';
import { createRefund, processRefund, verifyAndSettle } from '../services/payments.js';
import { revokeQr } from '../services/qr.js';
import { transition } from '../services/state.js';
import { viewBooking, cancelBooking } from '../services/bookings.js';
import { refreshRating } from './bookings.js';
import { page, str } from './util.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const like = (q: string) => `%${q.replace(/[%_]/g, '')}%`;

// ---- dashboard & analytics ---------------------------------------------------------------

function rangeOf(req: any): { from: string; to: string } {
  const today = lagosNow().date;
  const preset = str(req.query.range) || '30d';
  if (str(req.query.from) && str(req.query.to)) return { from: str(req.query.from), to: str(req.query.to) };
  const days = { today: 0, '7d': 6, '30d': 29, '3m': 89 }[preset] ?? 29;
  return { from: addDays(today, -days), to: today };
}

adminRouter.get('/dashboard', (req, res) => {
  const { from, to } = rangeOf(req);
  const one = <T = number>(sql: string, ...p: any[]) => get<{ v: T }>(sql, ...p)!.v;
  const totals = {
    customers: one(`SELECT COUNT(*) AS v FROM users WHERE role = 'customer'`),
    barbers: one(`SELECT COUNT(*) AS v FROM users WHERE role = 'barber'`),
    verifiedBarbers: one(`SELECT COUNT(*) AS v FROM barber_profiles WHERE verification_status = 'VERIFIED'`),
    pendingVerification: one(`SELECT COUNT(*) AS v FROM barber_profiles WHERE verification_status = 'PENDING' AND submitted_at IS NOT NULL`),
    bookings: one(`SELECT COUNT(*) AS v FROM bookings WHERE status != 'PENDING_PAYMENT'`),
    completedBookings: one(`SELECT COUNT(*) AS v FROM bookings WHERE status = 'COMPLETED'`),
    cancelledBookings: one(`SELECT COUNT(*) AS v FROM bookings WHERE status IN ('CANCELLED','REFUNDED') AND cancelled_by != 'system'`),
    revenueKobo: one(`SELECT COALESCE(SUM(amount_kobo),0) AS v FROM bookings WHERE status = 'COMPLETED'`),
    platformCommissionKobo: one(`SELECT COALESCE(SUM(platform_fee_kobo),0) AS v FROM bookings WHERE status = 'COMPLETED'`),
    barberEarningsKobo: one(`SELECT COALESCE(SUM(barber_earning_kobo),0) AS v FROM bookings WHERE status = 'COMPLETED'`),
    pendingWithdrawals: one(`SELECT COUNT(*) AS v FROM withdrawals WHERE status IN ('PENDING','PROCESSING')`),
    pendingWithdrawalsKobo: one(`SELECT COALESCE(SUM(amount_kobo),0) AS v FROM withdrawals WHERE status IN ('PENDING','PROCESSING')`),
    openDisputes: one(`SELECT COUNT(*) AS v FROM disputes WHERE status IN ('OPEN','INVESTIGATING')`),
    openTickets: one(`SELECT COUNT(*) AS v FROM support_tickets WHERE status IN ('OPEN','IN_PROGRESS','WAITING')`),
  };
  const series = {
    bookingsPerDay: all<any>(`SELECT date(created_at) AS day, COUNT(*) AS count FROM bookings WHERE status != 'PENDING_PAYMENT' AND date(created_at) BETWEEN ? AND ? GROUP BY day ORDER BY day`, from, to),
    revenuePerDay: all<any>(`SELECT date(completed_at) AS day, SUM(amount_kobo) AS revenueKobo, SUM(platform_fee_kobo) AS commissionKobo FROM bookings WHERE status = 'COMPLETED' AND date(completed_at) BETWEEN ? AND ? GROUP BY day ORDER BY day`, from, to),
    newCustomers: all<any>(`SELECT date(created_at) AS day, COUNT(*) AS count FROM users WHERE role = 'customer' AND date(created_at) BETWEEN ? AND ? GROUP BY day ORDER BY day`, from, to),
    newBarbers: all<any>(`SELECT date(created_at) AS day, COUNT(*) AS count FROM users WHERE role = 'barber' AND date(created_at) BETWEEN ? AND ? GROUP BY day ORDER BY day`, from, to),
  };
  const period = {
    bookings: one(`SELECT COUNT(*) AS v FROM bookings WHERE status != 'PENDING_PAYMENT' AND date(created_at) BETWEEN ? AND ?`, from, to),
    completed: one(`SELECT COUNT(*) AS v FROM bookings WHERE status = 'COMPLETED' AND date(completed_at) BETWEEN ? AND ?`, from, to),
    cancelled: one(`SELECT COUNT(*) AS v FROM bookings WHERE status IN ('CANCELLED','REFUNDED') AND cancelled_by != 'system' AND date(created_at) BETWEEN ? AND ?`, from, to),
    commissionKobo: one(`SELECT COALESCE(SUM(platform_fee_kobo),0) AS v FROM bookings WHERE status = 'COMPLETED' AND date(completed_at) BETWEEN ? AND ?`, from, to),
    withdrawalVolumeKobo: one(`SELECT COALESCE(SUM(amount_kobo),0) AS v FROM withdrawals WHERE status = 'SUCCESSFUL' AND date(created_at) BETWEEN ? AND ?`, from, to),
  };
  const cancellationRate = period.bookings ? Math.round((period.cancelled / period.bookings) * 1000) / 10 : 0;
  res.json({ range: { from, to }, totals, period: { ...period, cancellationRate }, series });
});

// ---- users --------------------------------------------------------------------------------------

adminRouter.get('/users', (req, res) => {
  const { limit, offset } = page(req);
  const role = str(req.query.role);
  const q = str(req.query.q).trim();
  const status = str(req.query.status);
  const where: string[] = [`role != 'admin'`];
  const p: any[] = [];
  if (role === 'customer' || role === 'barber') { where.push('role = ?'); p.push(role); }
  if (status === 'active' || status === 'suspended') { where.push('status = ?'); p.push(status); }
  if (q) { where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)'); p.push(like(q), like(q), like(q)); }
  const total = get<{ c: number }>(`SELECT COUNT(*) AS c FROM users WHERE ${where.join(' AND ')}`, ...p)!.c;
  const rows = all<any>(`SELECT id, role, name, email, phone, status, created_at AS createdAt FROM users WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  res.json({ users: rows, total });
});

adminRouter.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = get<any>('SELECT id, role, name, email, phone, status, profile_image AS image, created_at AS createdAt FROM users WHERE id = ?', id);
  if (!u) throw notFound('User not found.');
  const col = u.role === 'barber' ? 'barber_id' : 'customer_id';
  const bookings = all<any>(`SELECT * FROM bookings WHERE ${col} = ? ORDER BY id DESC LIMIT 50`, id).map((b) => viewBooking(b, { id: 0, role: 'admin' }));
  const payments = u.role === 'customer' ? all('SELECT reference, amount_kobo AS amountKobo, status, created_at AS createdAt, booking_id AS bookingId FROM payments WHERE customer_id = ? ORDER BY id DESC LIMIT 50', id) : [];
  res.json({ user: u, bookings, payments });
});

adminRouter.post('/users/:id/suspend', (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const u = get<any>('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!u || u.role === 'admin') throw notFound('User not found.');
  run(`UPDATE users SET status = 'suspended' WHERE id = ?`, u.id);
  if (u.role === 'barber') run(`UPDATE barber_profiles SET verification_status = 'SUSPENDED' WHERE user_id = ?`, u.id);
  audit(me(req).id, 'USER_SUSPENDED', 'user', u.id, { reason: d.reason });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/reactivate', (req, res) => {
  const u = get<any>('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!u || u.role === 'admin') throw notFound('User not found.');
  run(`UPDATE users SET status = 'active' WHERE id = ?`, u.id);
  if (u.role === 'barber') run(`UPDATE barber_profiles SET verification_status = 'VERIFIED' WHERE user_id = ? AND verification_status = 'SUSPENDED'`, u.id);
  audit(me(req).id, 'USER_REACTIVATED', 'user', u.id);
  res.json({ ok: true });
});

// ---- barbers & verification ------------------------------------------------------------------------

adminRouter.get('/barbers', (req, res) => {
  const { limit, offset } = page(req);
  const st = str(req.query.status);
  const q = str(req.query.q).trim();
  const queue = str(req.query.queue) === '1';
  const where: string[] = ['1=1'];
  const p: any[] = [];
  if (st) { where.push('bp.verification_status = ?'); p.push(st); }
  if (queue) where.push(`bp.verification_status = 'PENDING' AND bp.submitted_at IS NOT NULL`);
  if (q) { where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'); p.push(like(q), like(q), like(q)); }
  const rows = all<any>(
    `SELECT u.id, u.name, u.email, u.phone, u.status, u.created_at AS createdAt, bp.verification_status AS verificationStatus, bp.service_area AS serviceArea, bp.submitted_at AS submittedAt,
            bp.rating_avg AS rating, bp.total_reviews AS reviews, (bp.id_document IS NOT NULL) AS hasDocument
     FROM users u JOIN barber_profiles bp ON bp.user_id = u.id WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  res.json({ barbers: rows });
});

adminRouter.get('/barbers/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = get<any>(`SELECT id, name, email, phone, status, profile_image AS image, created_at AS createdAt FROM users WHERE id = ? AND role = 'barber'`, id);
  if (!u) throw notFound('Barber not found.');
  const bp = get<any>('SELECT * FROM barber_profiles WHERE user_id = ?', id);
  res.json({
    barber: u,
    profile: {
      bio: bp.bio, experienceYears: bp.experience_years, serviceArea: bp.service_area, address: bp.address, verificationStatus: bp.verification_status,
      rejectionReason: bp.rejection_reason, submittedAt: bp.submitted_at, idDocumentUrl: bp.id_document,
      bank: { bankName: bp.bank_name, accountNumber: bp.account_number, accountName: bp.account_name },
    },
    wallet: getWalletSummary(id),
    withdrawals: all('SELECT id, amount_kobo AS amountKobo, status, reference, created_at AS createdAt FROM withdrawals WHERE barber_id = ? ORDER BY id DESC LIMIT 50', id),
    bookings: all<any>('SELECT * FROM bookings WHERE barber_id = ? ORDER BY id DESC LIMIT 50', id).map((b) => viewBooking(b, { id: 0, role: 'admin' })),
    transactions: all('SELECT id, type, amount_kobo AS amountKobo, balance_after_kobo AS balanceAfterKobo, description, created_at AS createdAt FROM wallet_transactions WHERE barber_id = ? ORDER BY id DESC LIMIT 50', id),
  });
});

adminRouter.post('/barbers/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const bp = get<any>('SELECT * FROM barber_profiles WHERE user_id = ?', id);
  if (!bp) throw notFound('Barber not found.');
  if (!bp.id_document || !bp.submitted_at) throw conflict('This barber has not submitted verification documents yet.', 'NOT_SUBMITTED');
  run(`UPDATE barber_profiles SET verification_status = 'VERIFIED', rejection_reason = NULL, verified_at = datetime('now') WHERE user_id = ?`, id);
  audit(me(req).id, 'BARBER_APPROVED', 'barber', id);
  notify(id, 'verification_approved', "You're verified!", 'Your CallNBarb account is verified. Set your services and hours to start receiving bookings.', {});
  res.json({ ok: true });
});

adminRouter.post('/barbers/:id/reject', (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(300) }), req.body);
  const id = Number(req.params.id);
  if (!get('SELECT 1 FROM barber_profiles WHERE user_id = ?', id)) throw notFound('Barber not found.');
  run(`UPDATE barber_profiles SET verification_status = 'REJECTED', rejection_reason = ? WHERE user_id = ?`, d.reason, id);
  audit(me(req).id, 'BARBER_REJECTED', 'barber', id, { reason: d.reason });
  notify(id, 'verification_rejected', 'Verification needs attention', `We could not verify your account: ${d.reason}`, {});
  res.json({ ok: true });
});

// ---- bookings & payments -----------------------------------------------------------------------------

adminRouter.get('/bookings', (req, res) => {
  const { limit, offset } = page(req);
  const where: string[] = ['1=1'];
  const p: any[] = [];
  const f = (col: string, v: string) => { if (v) { where.push(`${col} = ?`); p.push(v); } };
  f('b.status', str(req.query.status));
  f('b.barber_id', str(req.query.barberId));
  f('b.customer_id', str(req.query.customerId));
  f('b.booking_date', str(req.query.date));
  if (str(req.query.paymentStatus)) { where.push(`(SELECT status FROM payments WHERE booking_id = b.id ORDER BY id DESC LIMIT 1) = ?`); p.push(str(req.query.paymentStatus)); }
  if (str(req.query.q)) { where.push('(b.code LIKE ?)'); p.push(like(str(req.query.q))); }
  const total = get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings b WHERE ${where.join(' AND ')}`, ...p)!.c;
  const rows = all<any>(
    `SELECT b.id, b.code, b.status, b.booking_date AS date, b.start_time AS startTime, b.service_name AS serviceName, b.amount_kobo AS amountKobo, b.platform_fee_kobo AS platformFeeKobo,
            cu.name AS customer, ba.name AS barber, (SELECT status FROM payments WHERE booking_id = b.id ORDER BY id DESC LIMIT 1) AS paymentStatus
     FROM bookings b JOIN users cu ON cu.id = b.customer_id JOIN users ba ON ba.id = b.barber_id WHERE ${where.join(' AND ')} ORDER BY b.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  res.json({ bookings: rows, total });
});

adminRouter.get('/bookings/:id', (req, res) => {
  const b = get<any>('SELECT * FROM bookings WHERE id = ?', Number(req.params.id));
  if (!b) throw notFound('Booking not found.');
  res.json({
    booking: viewBooking(b, { id: 0, role: 'admin' }),
    events: all('SELECT from_status AS fromStatus, to_status AS toStatus, actor_role AS actorRole, note, created_at AS createdAt FROM booking_events WHERE booking_id = ? ORDER BY id', b.id),
    payments: all('SELECT id, reference, amount_kobo AS amountKobo, status, provider, verified, created_at AS createdAt FROM payments WHERE booking_id = ?', b.id),
    refunds: all('SELECT id, reference, amount_kobo AS amountKobo, reason, status, created_at AS createdAt FROM refunds WHERE booking_id = ?', b.id),
    scans: all('SELECT result, created_at AS createdAt, device FROM qr_scans WHERE booking_id = ? ORDER BY id DESC LIMIT 20', b.id),
  });
});

adminRouter.post('/bookings/:id/cancel', wrap(async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const out = await cancelBooking(Number(req.params.id), { id: me(req).id, role: 'admin' }, d.reason);
  audit(me(req).id, 'BOOKING_CANCELLED_BY_ADMIN', 'booking', out.id, { reason: d.reason });
  res.json({ booking: viewBooking(out, { id: 0, role: 'admin' }) });
}));

adminRouter.get('/payments', (req, res) => {
  const { limit, offset } = page(req);
  const where: string[] = ['1=1'];
  const p: any[] = [];
  if (str(req.query.status)) { where.push('p.status = ?'); p.push(str(req.query.status)); }
  if (str(req.query.q)) { where.push('(p.reference LIKE ? OR b.code LIKE ?)'); p.push(like(str(req.query.q)), like(str(req.query.q))); }
  const rows = all<any>(
    `SELECT p.id, p.reference, p.amount_kobo AS amountKobo, p.currency, p.status, p.provider, p.verified, p.created_at AS createdAt, p.verified_at AS verifiedAt,
            b.code AS bookingCode, b.id AS bookingId, cu.name AS customer, ba.name AS barber
     FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN users cu ON cu.id = p.customer_id JOIN users ba ON ba.id = b.barber_id
     WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  res.json({ payments: rows });
});

// Reconciliation: re-ask the provider about a payment and settle it idempotently.
adminRouter.post('/payments/:reference/reconcile', wrap(async (req, res) => {
  const ref = String(req.params.reference);
  if (!get('SELECT 1 FROM payments WHERE reference = ?', ref)) throw notFound('Payment not found.');
  const out = await verifyAndSettle(ref);
  audit(me(req).id, 'PAYMENT_RECONCILED', 'payment', ref, out);
  res.json(out);
}));

adminRouter.get('/refunds', (_req, res) => {
  res.json({ refunds: all('SELECT r.id, r.reference, r.amount_kobo AS amountKobo, r.reason, r.status, r.created_at AS createdAt, b.code AS bookingCode FROM refunds r JOIN bookings b ON b.id = r.booking_id ORDER BY r.id DESC LIMIT 100') });
});

// ---- withdrawals ----------------------------------------------------------------------------------------

adminRouter.get('/withdrawals', (req, res) => {
  const { limit, offset } = page(req);
  const st = str(req.query.status);
  const rows = all<any>(
    `SELECT w.id, w.reference, w.amount_kobo AS amountKobo, w.bank_name AS bankName, w.account_number AS accountNumber, w.account_name AS accountName, w.status, w.admin_note AS note, w.created_at AS createdAt, u.name AS barber, u.id AS barberId
     FROM withdrawals w JOIN users u ON u.id = w.barber_id ${st ? 'WHERE w.status = ?' : ''} ORDER BY w.id DESC LIMIT ? OFFSET ?`,
    ...(st ? [st] : []), limit, offset);
  res.json({ withdrawals: rows });
});
adminRouter.post('/withdrawals/:id/approve', (req, res) => { approveWithdrawal(Number(req.params.id), me(req).id); res.json({ ok: true }); });
adminRouter.post('/withdrawals/:id/reject', (req, res) => {
  const d = parse(z.object({ note: z.string().trim().min(3).max(300) }), req.body);
  rejectWithdrawal(Number(req.params.id), me(req).id, d.note);
  res.json({ ok: true });
});
adminRouter.post('/withdrawals/:id/process', wrap(async (req, res) => {
  res.json({ withdrawal: await processWithdrawal(Number(req.params.id), me(req).id) });
}));

// ---- services catalogue ----------------------------------------------------------------------------------

adminRouter.get('/services', (_req, res) => res.json({ services: all('SELECT id, name, description, icon, active FROM services ORDER BY id') }));
adminRouter.post('/services', (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(2).max(60), description: z.string().max(200).default(''), icon: z.string().max(40).optional() }), req.body);
  if (get('SELECT 1 FROM services WHERE name = ?', d.name)) throw conflict('A service with that name already exists.');
  const id = run('INSERT INTO services (name, description, icon) VALUES (?, ?, ?)', d.name, d.description, d.icon ?? null).id;
  audit(me(req).id, 'SERVICE_CREATED', 'service', id, d);
  res.status(201).json({ id });
});
adminRouter.put('/services/:id', (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), description: z.string().max(200).optional(), active: z.boolean().optional() }), req.body);
  const s = get<any>('SELECT * FROM services WHERE id = ?', Number(req.params.id));
  if (!s) throw notFound('Service not found.');
  run('UPDATE services SET name = ?, description = ?, active = ? WHERE id = ?', d.name ?? s.name, d.description ?? s.description, d.active === undefined ? s.active : d.active ? 1 : 0, s.id);
  audit(me(req).id, 'SERVICE_UPDATED', 'service', s.id, d);
  res.json({ ok: true });
});

// ---- reviews ----------------------------------------------------------------------------------------------

adminRouter.get('/reviews', (_req, res) => {
  res.json({ reviews: all('SELECT r.id, r.rating, r.comment, r.hidden, r.created_at AS createdAt, cu.name AS customer, ba.name AS barber, b.code AS bookingCode FROM reviews r JOIN users cu ON cu.id = r.customer_id JOIN users ba ON ba.id = r.barber_id JOIN bookings b ON b.id = r.booking_id ORDER BY r.id DESC LIMIT 200') });
});
adminRouter.post('/reviews/:id/visibility', (req, res) => {
  const d = parse(z.object({ hidden: z.boolean() }), req.body);
  const r = get<any>('SELECT * FROM reviews WHERE id = ?', Number(req.params.id));
  if (!r) throw notFound('Review not found.');
  tx(() => { run('UPDATE reviews SET hidden = ? WHERE id = ?', d.hidden ? 1 : 0, r.id); refreshRating(r.barber_id); audit(me(req).id, d.hidden ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED', 'review', r.id); });
  res.json({ ok: true });
});

// ---- disputes ------------------------------------------------------------------------------------------------

adminRouter.get('/disputes', (req, res) => {
  const st = str(req.query.status);
  const rows = all<any>(
    `SELECT d.id, d.booking_id AS bookingId, d.reason, d.description, d.evidence, d.status, d.admin_notes AS adminNotes, d.resolution, d.created_at AS createdAt,
            b.code AS bookingCode, b.status AS bookingStatus, b.amount_kobo AS amountKobo, ou.name AS openedBy, ou.role AS openedByRole, cu.name AS customer, ba.name AS barber
     FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN users ou ON ou.id = d.opened_by JOIN users cu ON cu.id = b.customer_id JOIN users ba ON ba.id = b.barber_id
     ${st ? 'WHERE d.status = ?' : ''} ORDER BY d.id DESC LIMIT 200`, ...(st ? [st] : []));
  res.json({ disputes: rows });
});

adminRouter.post('/disputes/:id/investigate', (req, res) => {
  const d = parse(z.object({ notes: z.string().trim().max(1000).default('') }), req.body);
  run(`UPDATE disputes SET status = 'INVESTIGATING', admin_notes = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('OPEN','INVESTIGATING')`, d.notes, Number(req.params.id));
  audit(me(req).id, 'DISPUTE_INVESTIGATING', 'dispute', Number(req.params.id));
  res.json({ ok: true });
});

/**
 * Final decision. outcome:
 *  - dismiss          : booking returns to its prior status; dispute REJECTED
 *  - refund_customer  : full refund to customer; if the barber was already paid the earning is reversed
 *  - release_to_barber: job treated as done; barber credited (if not already)
 */
adminRouter.post('/disputes/:id/resolve', wrap(async (req, res) => {
  const d = parse(z.object({ outcome: z.enum(['dismiss', 'refund_customer', 'release_to_barber']), resolution: z.string().trim().min(3).max(1000) }), req.body);
  const adminId = me(req).id;
  const refundId = tx(() => {
    const dp = get<any>('SELECT * FROM disputes WHERE id = ?', Number(req.params.id));
    if (!dp) throw notFound('Dispute not found.');
    if (!['OPEN', 'INVESTIGATING'].includes(dp.status)) throw conflict('This dispute is already closed.');
    const b = get<any>('SELECT * FROM bookings WHERE id = ?', dp.booking_id);
    const actor = { id: adminId, role: 'admin' as const };
    let refund: number | null = null;
    const prior = get<any>(`SELECT from_status FROM booking_events WHERE booking_id = ? AND to_status = 'DISPUTED' ORDER BY id DESC LIMIT 1`, b.id)?.from_status ?? 'ACCEPTED';
    if (b.status === 'DISPUTED') {
      if (d.outcome === 'dismiss') transition(b.id, prior, actor, 'Dispute dismissed');
      else if (d.outcome === 'release_to_barber') {
        transition(b.id, 'COMPLETED', actor, 'Dispute resolved in barber\'s favour');
        run(`UPDATE bookings SET completed_at = COALESCE(completed_at, datetime('now')) WHERE id = ?`, b.id);
        creditCompletedBooking(b);
        revokeQr(b.id);
      } else {
        transition(b.id, 'CANCELLED', actor, 'Dispute resolved: refunded');
        run(`UPDATE bookings SET cancelled_by = 'admin', cancel_reason = ?, cancelled_at = datetime('now') WHERE id = ?`, d.resolution, b.id);
        revokeQr(b.id);
        reverseBookingCredit(b, adminId);
        refund = createRefund(b, b.amount_kobo, `Dispute #${dp.id} refund`, adminId);
      }
    }
    run(`UPDATE disputes SET status = ?, resolution = ?, updated_at = datetime('now') WHERE id = ?`, d.outcome === 'dismiss' ? 'REJECTED' : 'RESOLVED', d.resolution, dp.id);
    audit(adminId, 'DISPUTE_RESOLVED', 'dispute', dp.id, { outcome: d.outcome, resolution: d.resolution });
    for (const uid of [b.customer_id, b.barber_id]) notify(uid, 'dispute_resolved', 'Dispute resolved', `The dispute for booking ${b.code} was resolved. ${d.resolution}`, { bookingId: b.id });
    return refund;
  });
  if (refundId) await processRefund(refundId);
  res.json({ ok: true });
}));

// ---- support -----------------------------------------------------------------------------------------------------

adminRouter.get('/tickets', (req, res) => {
  const st = str(req.query.status);
  res.json({
    tickets: all(
      `SELECT t.id, t.category, t.subject, t.description, t.status, t.admin_reply AS adminReply, t.created_at AS createdAt, t.booking_id AS bookingId, u.name AS user, u.role AS userRole
       FROM support_tickets t JOIN users u ON u.id = t.user_id ${st ? 'WHERE t.status = ?' : ''} ORDER BY t.id DESC LIMIT 200`, ...(st ? [st] : []),
    ),
  });
});
adminRouter.put('/tickets/:id', (req, res) => {
  const d = parse(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']), reply: z.string().trim().max(2000).optional() }), req.body);
  const t = get<any>('SELECT * FROM support_tickets WHERE id = ?', Number(req.params.id));
  if (!t) throw notFound('Ticket not found.');
  run(`UPDATE support_tickets SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = datetime('now') WHERE id = ?`, d.status, d.reply ?? null, t.id);
  if (d.reply) notify(t.user_id, 'support_reply', 'Support replied', d.reply.slice(0, 140), { ticketId: t.id });
  audit(me(req).id, 'TICKET_UPDATED', 'ticket', t.id, { status: d.status });
  res.json({ ok: true });
});

// ---- notifications broadcast ------------------------------------------------------------------------------------------

adminRouter.post('/notifications/broadcast', (req, res) => {
  const d = parse(z.object({ audience: z.enum(['all', 'customers', 'barbers']), title: z.string().trim().min(2).max(80), message: z.string().trim().min(2).max(300) }), req.body);
  const role = d.audience === 'all' ? `role IN ('customer','barber')` : `role = '${d.audience === 'customers' ? 'customer' : 'barber'}'`;
  const users = all<{ id: number }>(`SELECT id FROM users WHERE status = 'active' AND ${role}`);
  tx(() => { for (const u of users) notify(u.id, 'announcement', d.title, d.message); });
  audit(me(req).id, 'BROADCAST_SENT', 'notification', null, { audience: d.audience, recipients: users.length });
  res.json({ sent: users.length });
});

// ---- settings & audit ---------------------------------------------------------------------------------------------------

adminRouter.get('/settings', (_req, res) => res.json({ settings: getSettings() }));
adminRouter.put('/settings', (req, res) => {
  const before = getSettings();
  let changed: Record<string, number>;
  try {
    changed = tx(() => updateSettings(req.body ?? {}));
  } catch (e) {
    throw badRequest((e as Error).message, 'VALIDATION_ERROR');
  }
  audit(me(req).id, 'SETTINGS_CHANGED', 'settings', null, { before: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as any)[k]])), after: changed });
  res.json({ settings: getSettings() });
});

adminRouter.get('/audit-logs', (req, res) => {
  const { limit, offset } = page(req, 50);
  const rows = all<any>(
    `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.metadata, a.created_at AS createdAt, u.name AS admin FROM audit_logs a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT ? OFFSET ?`, limit, offset);
  res.json({ logs: rows.map((r) => ({ ...r, metadata: JSON.parse(r.metadata ?? '{}') })) });
});
