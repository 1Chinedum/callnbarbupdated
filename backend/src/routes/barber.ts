import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx } from '../db.js';
import { me, requireAuth, requireRole } from '../auth.js';
import { badRequest, conflict, notFound, parse, wrap } from '../errors.js';
import { findTown, isInDeltaBox } from '../delta.js';
import { notify } from '../notify.js';
import { BANKS, getWalletSummary, requestWithdrawal } from '../services/wallet.js';
import { listBookings } from '../services/bookings.js';
import { lagosNow, isDate, isTime, toMin } from '../time.js';
import { page } from './util.js';

export const barberRouter = Router();
barberRouter.use(requireAuth, requireRole('barber'));

const profileOf = (id: number) => get<any>('SELECT * FROM barber_profiles WHERE user_id = ?', id);

function profileView(id: number) {
  const bp = profileOf(id);
  const u = get<any>('SELECT name, email, phone, profile_image FROM users WHERE id = ?', id);
  return {
    name: u.name, email: u.email, phone: u.phone, image: u.profile_image,
    bio: bp.bio, experienceYears: bp.experience_years, serviceArea: bp.service_area, address: bp.address,
    latitude: bp.latitude, longitude: bp.longitude, homeService: !!bp.home_service,
    slotMinutes: bp.slot_minutes, maxDaily: bp.max_daily,
    verificationStatus: bp.verification_status, rejectionReason: bp.rejection_reason, submittedAt: bp.submitted_at,
    hasIdDocument: !!bp.id_document,
    rating: bp.rating_avg, reviews: bp.total_reviews,
    bank: { bankCode: bp.bank_code, bankName: bp.bank_name, accountNumber: bp.account_number, accountName: bp.account_name },
  };
}

barberRouter.get('/profile', (req, res) => res.json({ profile: profileView(me(req).id) }));

barberRouter.put('/profile', wrap(async (req, res) => {
  const d = parse(
    z.object({
      bio: z.string().trim().max(600).optional(),
      experienceYears: z.number().int().min(0).max(60).optional(),
      serviceArea: z.string().trim().optional(),
      address: z.string().trim().max(200).optional(),
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      homeService: z.boolean().optional(),
      slotMinutes: z.number().int().min(15).max(240).optional(),
      maxDaily: z.number().int().min(1).max(20).optional(),
      idDocument: z.string().max(300).optional(),
      bank: z.object({ bankCode: z.string(), accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'), accountName: z.string().trim().min(3).max(80) }).optional(),
    }),
    req.body,
  );
  const id = me(req).id;
  const bp = profileOf(id);
  if (d.serviceArea !== undefined && !findTown(d.serviceArea)) throw badRequest('Choose a town in Delta State as your service area.', 'OUTSIDE_SERVICE_AREA');
  if (d.latitude != null && d.longitude != null && !isInDeltaBox(d.latitude, d.longitude)) throw badRequest('That location appears to be outside Delta State.', 'OUTSIDE_SERVICE_AREA');
  if (d.idDocument && !/^\/api\/me\/uploads\/private\/[\w.-]+$/.test(d.idDocument)) throw badRequest('Invalid document.');
  let bankName = bp.bank_name;
  if (d.bank) {
    const bank = BANKS.find((b) => b.code === d.bank!.bankCode);
    if (!bank) throw badRequest('Choose a valid bank.', 'VALIDATION_ERROR');
    bankName = bank.name;
  }
  run(
    `UPDATE barber_profiles SET bio = ?, experience_years = ?, service_area = ?, address = ?, latitude = ?, longitude = ?, home_service = ?, slot_minutes = ?, max_daily = ?, id_document = ?,
       bank_code = ?, bank_name = ?, account_number = ?, account_name = ? WHERE user_id = ?`,
    d.bio ?? bp.bio, d.experienceYears ?? bp.experience_years, d.serviceArea ?? bp.service_area, d.address ?? bp.address,
    d.latitude === undefined ? bp.latitude : d.latitude, d.longitude === undefined ? bp.longitude : d.longitude,
    d.homeService === undefined ? bp.home_service : d.homeService ? 1 : 0, d.slotMinutes ?? bp.slot_minutes, d.maxDaily ?? bp.max_daily,
    d.idDocument ?? bp.id_document, d.bank?.bankCode ?? bp.bank_code, bankName, d.bank?.accountNumber ?? bp.account_number, d.bank?.accountName ?? bp.account_name, id,
  );
  res.json({ profile: profileView(id) });
}));

barberRouter.post('/verification/submit', (req, res) => {
  const id = me(req).id;
  const bp = profileOf(id);
  const missing: string[] = [];
  if (!bp.bio) missing.push('bio');
  if (!bp.service_area) missing.push('service area');
  if (!bp.address) missing.push('address');
  if (!bp.id_document) missing.push('ID document');
  if (!bp.account_number) missing.push('bank details');
  if (missing.length) throw badRequest(`Please complete: ${missing.join(', ')}.`, 'INCOMPLETE_PROFILE');
  if (bp.verification_status === 'VERIFIED') throw conflict('You are already verified.');
  if (bp.verification_status === 'SUSPENDED') throw conflict('Your account is suspended. Please contact support.');
  run(`UPDATE barber_profiles SET verification_status = 'PENDING', rejection_reason = NULL, submitted_at = datetime('now') WHERE user_id = ?`, id);
  for (const a of all<{ id: number }>(`SELECT id FROM users WHERE role = 'admin'`)) notify(a.id, 'verification_submitted', 'New barber to verify', `${me(req).name} submitted verification documents.`, { barberId: id });
  res.json({ profile: profileView(id) });
});

// ---- services --------------------------------------------------------------------

const serviceSchema = z.object({
  serviceId: z.number().int(),
  priceKobo: z.number().int().min(50_000, 'Minimum price is ₦500').max(50_000_000),
  durationMin: z.number().int().min(10).max(480),
  description: z.string().trim().max(200).default(''),
  active: z.boolean().default(true),
});

const myServices = (id: number) =>
  all<any>(
    `SELECT bs.id, bs.service_id AS serviceId, s.name, bs.price_kobo AS priceKobo, bs.duration_min AS durationMin, bs.description, bs.active FROM barber_services bs JOIN services s ON s.id = bs.service_id WHERE bs.barber_id = ? ORDER BY bs.id`,
    id,
  ).map((r) => ({ ...r, active: !!r.active }));

barberRouter.get('/services', (req, res) => res.json({ services: myServices(me(req).id) }));

barberRouter.post('/services', (req, res) => {
  const d = parse(serviceSchema, req.body);
  const s = get<any>('SELECT id FROM services WHERE id = ? AND active = 1', d.serviceId);
  if (!s) throw notFound('Service not found.');
  if (get('SELECT 1 FROM barber_services WHERE barber_id = ? AND service_id = ?', me(req).id, d.serviceId)) throw conflict('You already offer this service. Edit it instead.');
  run('INSERT INTO barber_services (barber_id, service_id, price_kobo, duration_min, description, active) VALUES (?, ?, ?, ?, ?, ?)', me(req).id, d.serviceId, d.priceKobo, d.durationMin, d.description, d.active ? 1 : 0);
  res.status(201).json({ services: myServices(me(req).id) });
});

barberRouter.put('/services/:id', (req, res) => {
  const d = parse(serviceSchema.partial().omit({ serviceId: true }), req.body);
  const row = get<any>('SELECT * FROM barber_services WHERE id = ? AND barber_id = ?', Number(req.params.id), me(req).id);
  if (!row) throw notFound('Service not found.');
  run('UPDATE barber_services SET price_kobo = ?, duration_min = ?, description = ?, active = ? WHERE id = ?', d.priceKobo ?? row.price_kobo, d.durationMin ?? row.duration_min, d.description ?? row.description, d.active === undefined ? row.active : d.active ? 1 : 0, row.id);
  res.json({ services: myServices(me(req).id) });
});

barberRouter.delete('/services/:id', (req, res) => {
  // Soft-delete: existing bookings keep their price snapshot; the service just stops being offered.
  const r = run('UPDATE barber_services SET active = 0 WHERE id = ? AND barber_id = ?', Number(req.params.id), me(req).id);
  if (!r.changes) throw notFound('Service not found.');
  res.json({ services: myServices(me(req).id) });
});

// ---- availability ------------------------------------------------------------------

const dayRow = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().refine(isTime, 'Use HH:MM'),
    endTime: z.string().refine(isTime, 'Use HH:MM'),
    breakStart: z.string().refine(isTime).nullable().optional(),
    breakEnd: z.string().refine(isTime).nullable().optional(),
    active: z.boolean(),
  })
  .refine((d) => toMin(d.startTime) < toMin(d.endTime), { message: 'End time must be after start time' })
  .refine((d) => !d.breakStart || !d.breakEnd || (toMin(d.breakStart) < toMin(d.breakEnd) && toMin(d.breakStart) >= toMin(d.startTime) && toMin(d.breakEnd) <= toMin(d.endTime)), { message: 'Break must fall inside working hours' });

const availabilityView = (id: number) => ({
  days: all<any>('SELECT day_of_week AS dayOfWeek, start_time AS startTime, end_time AS endTime, break_start AS breakStart, break_end AS breakEnd, active FROM availability WHERE barber_id = ? ORDER BY day_of_week', id).map((r) => ({ ...r, active: !!r.active })),
  unavailableDates: all('SELECT id, date, reason FROM unavailable_dates WHERE barber_id = ? AND date >= ? ORDER BY date', id, lagosNow().date),
});

barberRouter.get('/availability', (req, res) => res.json(availabilityView(me(req).id)));

barberRouter.put('/availability', (req, res) => {
  const d = parse(z.object({ days: z.array(dayRow).max(7) }), req.body);
  const id = me(req).id;
  tx(() => {
    for (const r of d.days) {
      run(
        `INSERT INTO availability (barber_id, day_of_week, start_time, end_time, break_start, break_end, active) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(barber_id, day_of_week) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time, break_start = excluded.break_start, break_end = excluded.break_end, active = excluded.active`,
        id, r.dayOfWeek, r.startTime, r.endTime, r.breakStart ?? null, r.breakEnd ?? null, r.active ? 1 : 0,
      );
    }
  });
  res.json(availabilityView(id));
});

barberRouter.post('/unavailable-dates', (req, res) => {
  const d = parse(z.object({ date: z.string().refine(isDate), reason: z.string().max(100).default('') }), req.body);
  run('INSERT OR IGNORE INTO unavailable_dates (barber_id, date, reason) VALUES (?, ?, ?)', me(req).id, d.date, d.reason);
  res.status(201).json(availabilityView(me(req).id));
});
barberRouter.delete('/unavailable-dates/:id', (req, res) => {
  run('DELETE FROM unavailable_dates WHERE id = ? AND barber_id = ?', Number(req.params.id), me(req).id);
  res.json(availabilityView(me(req).id));
});

// ---- bookings & dashboard ------------------------------------------------------------

barberRouter.get('/bookings', (req, res) => {
  res.json({ bookings: listBookings({ id: me(req).id, role: 'barber' }, typeof req.query.group === 'string' ? req.query.group : undefined) });
});

barberRouter.get('/dashboard', (req, res) => {
  const id = me(req).id;
  const today = lagosNow().date;
  const bp = profileOf(id);
  const todays = listBookings({ id, role: 'barber' }).filter((b) => b.date === today && !['CANCELLED', 'REFUNDED'].includes(b.status));
  const pending = listBookings({ id, role: 'barber' }, undefined).filter((b) => b.status === 'BARBER_PENDING');
  const upcoming = listBookings({ id, role: 'barber' }).filter((b) => ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'].includes(b.status)).reverse().slice(0, 10);
  const todayEarn = get<{ s: number }>(
    `SELECT COALESCE(SUM(barber_earning_kobo),0) AS s FROM bookings WHERE barber_id = ? AND status = 'COMPLETED' AND date(completed_at, '+1 hour') = ?`, id, today,
  )!.s;
  const completed = get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE barber_id = ? AND status = 'COMPLETED'`, id)!.c;
  const wallet = getWalletSummary(id);
  res.json({
    verificationStatus: bp.verification_status,
    todaysAppointments: todays.length,
    pendingRequests: pending.length,
    todaysEarningsKobo: todayEarn,
    totalEarningsKobo: wallet.totalEarningsKobo,
    walletBalanceKobo: wallet.availableKobo,
    completedJobs: completed,
    rating: bp.rating_avg,
    reviews: bp.total_reviews,
    todays,
    pending,
    upcoming,
  });
});

// ---- wallet ---------------------------------------------------------------------------

barberRouter.get('/wallet', (req, res) => res.json({ wallet: getWalletSummary(me(req).id) }));

barberRouter.get('/wallet/transactions', (req, res) => {
  const { limit, offset } = page(req, 30);
  const rows = all<any>(
    `SELECT wt.id, wt.type, wt.amount_kobo AS amountKobo, wt.balance_before_kobo AS balanceBeforeKobo, wt.balance_after_kobo AS balanceAfterKobo, wt.status, wt.description, wt.created_at AS createdAt, b.code AS bookingCode
     FROM wallet_transactions wt LEFT JOIN bookings b ON b.id = wt.booking_id WHERE wt.barber_id = ? ORDER BY wt.id DESC LIMIT ? OFFSET ?`,
    me(req).id, limit, offset,
  );
  res.json({ transactions: rows });
});

barberRouter.post('/withdrawals', (req, res) => {
  const d = parse(z.object({ amountKobo: z.number().int().positive() }), req.body);
  const w = requestWithdrawal(me(req).id, d.amountKobo);
  res.status(201).json({ withdrawal: w, wallet: getWalletSummary(me(req).id) });
});

barberRouter.get('/withdrawals', (req, res) => {
  res.json({
    withdrawals: all('SELECT id, amount_kobo AS amountKobo, bank_name AS bankName, account_number AS accountNumber, account_name AS accountName, status, reference, admin_note AS note, created_at AS createdAt FROM withdrawals WHERE barber_id = ? ORDER BY id DESC LIMIT 100', me(req).id),
  });
});
