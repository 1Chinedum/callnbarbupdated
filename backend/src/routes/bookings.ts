import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { all, get, run, tx } from '../db.js';
import { me, requireAuth, requireRole } from '../auth.js';
import { badRequest, conflict, parse, wrap } from '../errors.js';
import { notify } from '../notify.js';
import {
  acceptBooking, advanceTravel, cancelBooking, createBooking, customerQr, listBookings, loadBookingFor,
  lookupScan, ScanError, verifyScan, viewBooking,
} from '../services/bookings.js';
import { demoPayOutcome, handleWebhookEvent, initializePayment, verifyAndSettle, verifyWebhookSignature } from '../services/payments.js';
import { transition } from '../services/state.js';
import { isDate, isTime } from '../time.js';
import { clientIp, device } from './util.js';

// ---- bookings --------------------------------------------------------------------------

export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

const addressInput = z.object({
  address: z.string().trim().min(5).max(200),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().default('Delta'),
  landmark: z.string().trim().max(120).default(''),
  instructions: z.string().trim().max(300).default(''),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  save: z.boolean().optional(),
  label: z.string().trim().max(30).optional(),
});

bookingsRouter.post('/', requireRole('customer'), (req, res) => {
  // Note what is NOT accepted: price, fees, status, payment state. The server derives all of it.
  const d = parse(
    z.object({
      barberId: z.number().int(),
      serviceId: z.number().int(),
      date: z.string().refine(isDate, 'Choose a valid date'),
      startTime: z.string().refine(isTime, 'Choose a valid time'),
      addressId: z.number().int().optional(),
      address: addressInput.optional(),
    }),
    req.body,
  );
  const b = createBooking(me(req).id, d);
  res.status(201).json({ booking: viewBooking(b, me(req)) });
});

bookingsRouter.get('/', requireRole('customer'), (req, res) => {
  res.json({ bookings: listBookings({ id: me(req).id, role: 'customer' }, typeof req.query.group === 'string' ? req.query.group : undefined) });
});

bookingsRouter.get('/:id', (req, res) => {
  const b = loadBookingFor(Number(req.params.id), me(req));
  const events = all('SELECT from_status AS fromStatus, to_status AS toStatus, actor_role AS actorRole, note, created_at AS createdAt FROM booking_events WHERE booking_id = ? ORDER BY id', b.id);
  res.json({ booking: viewBooking(b, me(req)), events });
});

bookingsRouter.post('/:id/cancel', requireRole('customer', 'barber'), wrap(async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(300) }), req.body);
  const b = await cancelBooking(Number(req.params.id), { id: me(req).id, role: me(req).role as 'customer' | 'barber' }, d.reason);
  res.json({ booking: viewBooking(b, me(req)) });
}));

bookingsRouter.post('/:id/accept', requireRole('barber'), (req, res) => {
  res.json({ booking: viewBooking(acceptBooking(Number(req.params.id), me(req).id), me(req)) });
});
bookingsRouter.post('/:id/reject', requireRole('barber'), wrap(async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().max(300).default('Barber unavailable') }), req.body);
  const b = loadBookingFor(Number(req.params.id), me(req));
  if (b.status !== 'BARBER_PENDING') throw conflict('Only new requests can be rejected.', 'INVALID_TRANSITION');
  const out = await cancelBooking(b.id, { id: me(req).id, role: 'barber' }, d.reason || 'Barber unavailable');
  res.json({ booking: viewBooking(out, me(req)) });
}));
bookingsRouter.post('/:id/on-the-way', requireRole('barber'), (req, res) => {
  res.json({ booking: viewBooking(advanceTravel(Number(req.params.id), me(req).id, 'ON_THE_WAY'), me(req)) });
});
bookingsRouter.post('/:id/arrived', requireRole('barber'), (req, res) => {
  res.json({ booking: viewBooking(advanceTravel(Number(req.params.id), me(req).id, 'ARRIVED'), me(req)) });
});

bookingsRouter.get('/:id/qr', requireRole('customer'), (req, res) => {
  res.json(customerQr(Number(req.params.id), me(req).id));
});

bookingsRouter.post('/:id/review', requireRole('customer'), (req, res) => {
  const d = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).default('') }), req.body);
  const b = loadBookingFor(Number(req.params.id), me(req));
  if (b.status !== 'COMPLETED') throw conflict('You can review a barber after the service is completed.', 'NOT_COMPLETED');
  tx(() => {
    if (get('SELECT 1 FROM reviews WHERE booking_id = ?', b.id)) throw conflict('You have already reviewed this appointment.', 'ALREADY_REVIEWED');
    run('INSERT INTO reviews (booking_id, customer_id, barber_id, rating, comment) VALUES (?, ?, ?, ?, ?)', b.id, b.customer_id, b.barber_id, d.rating, d.comment);
    refreshRating(b.barber_id);
    notify(b.barber_id, 'new_review', 'New review', `${d.rating}★ for ${b.service_name}.`, { bookingId: b.id });
  });
  res.status(201).json({ ok: true });
});

export function refreshRating(barberId: number) {
  const r = get<{ avg: number | null; c: number }>('SELECT AVG(rating) AS avg, COUNT(*) AS c FROM reviews WHERE barber_id = ? AND hidden = 0', barberId)!;
  run('UPDATE barber_profiles SET rating_avg = ?, total_reviews = ? WHERE user_id = ?', r.avg ?? 0, r.c, barberId);
}

bookingsRouter.post('/:id/dispute', requireRole('customer', 'barber'), (req, res) => {
  const d = parse(
    z.object({ reason: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(2000), evidence: z.string().max(300).optional() }),
    req.body,
  );
  const b = loadBookingFor(Number(req.params.id), me(req));
  if (!['BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'COMPLETED'].includes(b.status)) throw conflict('A dispute cannot be opened for this booking.', 'NOT_DISPUTABLE');
  const id = tx(() => {
    if (get(`SELECT 1 FROM disputes WHERE booking_id = ? AND status IN ('OPEN','INVESTIGATING')`, b.id)) throw conflict('A dispute is already open for this booking.');
    const did = run('INSERT INTO disputes (booking_id, opened_by, reason, description, evidence) VALUES (?, ?, ?, ?, ?)', b.id, me(req).id, d.reason, d.description, d.evidence ?? null).id;
    transition(b.id, 'DISPUTED', { id: me(req).id, role: me(req).role }, d.reason);
    const other = me(req).role === 'customer' ? b.barber_id : b.customer_id;
    notify(other, 'dispute_opened', 'Dispute opened', `A dispute was opened for booking ${b.code}. Our team will review it.`, { bookingId: b.id });
    for (const a of all<{ id: number }>(`SELECT id FROM users WHERE role = 'admin'`)) notify(a.id, 'dispute_opened', 'New dispute', `Booking ${b.code}: ${d.reason}`, { disputeId: did });
    return did;
  });
  res.status(201).json({ dispute: get('SELECT * FROM disputes WHERE id = ?', id) });
});

// ---- QR scanning (barber) ------------------------------------------------------------------

export const qrRouter = Router();
qrRouter.use(requireAuth, requireRole('barber'));

const scanBody = z.object({ payload: z.string().min(5).max(200) });

function scanErrorToResponse(e: unknown): never {
  // Rejected scans are a normal outcome (422), not a server error.
  if (e instanceof ScanError) throw Object.assign(badRequest(e.message, `QR_${e.reason}`), { status: 422 });
  throw e;
}

// Step 1: show the barber what they scanned. Changes nothing.
qrRouter.post('/lookup', wrap(async (req, res) => {
  const d = parse(scanBody, req.body);
  try {
    res.json({ booking: lookupScan(me(req).id, d.payload, device(req), clientIp(req)) });
  } catch (e) {
    scanErrorToResponse(e);
  }
}));

// Step 2: "Verify & Complete". Marks the QR used, completes the job and credits the barber's wallet atomically.
qrRouter.post('/verify', wrap(async (req, res) => {
  const d = parse(scanBody, req.body);
  try {
    const booking = verifyScan(me(req).id, d.payload, device(req), clientIp(req));
    res.json({ verified: true, booking });
  } catch (e) {
    scanErrorToResponse(e);
  }
}));

// ---- payments ----------------------------------------------------------------------------------

export const paymentsRouter = Router();

// Paystack webhook: raw body (for HMAC), no auth. Signature is mandatory.
paymentsRouter.post('/webhook', express.raw({ type: '*/*', limit: '1mb' }), wrap(async (req, res) => {
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!verifyWebhookSignature(raw, req.headers['x-paystack-signature'] as string | undefined)) {
    return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature.' } });
  }
  let event: any;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } });
  }
  await handleWebhookEvent(event);
  res.sendStatus(200); // always 200 quickly so Paystack does not retry duplicates
}));

paymentsRouter.use(requireAuth, requireRole('customer'));

paymentsRouter.post('/initialize', wrap(async (req, res) => {
  const d = parse(z.object({ bookingId: z.number().int() }), req.body);
  res.json(await initializePayment({ id: me(req).id, email: me(req).email }, d.bookingId));
}));

// Customer asks "did my payment go through?" — the answer always comes from the provider, not the client.
paymentsRouter.post('/verify', wrap(async (req, res) => {
  const d = parse(z.object({ reference: z.string().min(5).max(80) }), req.body);
  const p = get<any>('SELECT * FROM payments WHERE reference = ? AND customer_id = ?', d.reference, me(req).id);
  if (!p) throw badRequest('Payment not found.', 'NOT_FOUND');
  const out = await verifyAndSettle(d.reference);
  res.json({ status: out.status, bookingId: out.bookingId });
}));

// DEMO ONLY: simulates the customer finishing (or failing) checkout. Disabled unless PAYMENT_MODE=demo.
paymentsRouter.post('/demo/pay', wrap(async (req, res) => {
  const d = parse(z.object({ reference: z.string(), outcome: z.enum(['success', 'failed']) }), req.body);
  const p = get<any>('SELECT * FROM payments WHERE reference = ? AND customer_id = ?', d.reference, me(req).id);
  if (!p) throw badRequest('Payment not found.', 'NOT_FOUND');
  demoPayOutcome(d.reference, d.outcome);
  const out = await verifyAndSettle(d.reference);
  res.json({ status: out.status, bookingId: out.bookingId });
}));
