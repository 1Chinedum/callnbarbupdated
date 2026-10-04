import { randomBytes } from 'node:crypto';
import { all, get, run, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { findTown, isDeltaState, isInDeltaBox } from '../delta.js';
import { computeFees, formatNaira } from '../money.js';
import { notify } from '../notify.js';
import { getSettings } from '../settings.js';
import { addDays, isDate, isTime, lagosNow, lagosToEpoch, fromMin, toMin } from '../time.js';
import { createRefund, processRefund } from './payments.js';
import { findQrByPayload, logScan, qrPayloadFor, revokeQr } from './qr.js';
import { creditCompletedBooking } from './wallet.js';
import { getSlots } from './slots.js';
import { transition, type Actor } from './state.js';

// ---- helpers ---------------------------------------------------------------

export function expireHolds(now = Date.now()) {
  const stale = all<any>(`SELECT id FROM bookings WHERE status = 'PENDING_PAYMENT' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?`, now);
  for (const b of stale) {
    transition(b.id, 'CANCELLED', { id: null, role: 'system' }, 'Payment window expired');
    run(`UPDATE bookings SET cancelled_by = 'system', cancel_reason = 'Payment window expired', cancelled_at = datetime('now') WHERE id = ?`, b.id);
    run(`UPDATE payments SET status = 'CANCELLED' WHERE booking_id = ? AND status = 'PENDING'`, b.id);
  }
  return stale.length;
}

const newCode = () => `CNB-${randomBytes(4).toString('hex').toUpperCase()}`;

function sqliteConstraint(e: unknown) {
  return e instanceof Error && /UNIQUE constraint failed|constraint/i.test(e.message);
}

export interface AddressInput {
  address: string;
  city: string;
  state?: string;
  landmark?: string;
  instructions?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export function validateDeltaAddress(a: AddressInput) {
  if (!a.address || a.address.trim().length < 5) throw badRequest('Please enter a full street address.', 'VALIDATION_ERROR');
  if (!isDeltaState(a.state ?? 'Delta')) throw badRequest('CallNBarb currently serves Delta State only.', 'OUTSIDE_SERVICE_AREA');
  if (!findTown(a.city)) throw badRequest('Please choose a town in Delta State.', 'OUTSIDE_SERVICE_AREA');
  if ((a.latitude ?? null) !== null && (a.longitude ?? null) !== null && !isInDeltaBox(a.latitude!, a.longitude!)) {
    throw badRequest('That location appears to be outside Delta State.', 'OUTSIDE_SERVICE_AREA');
  }
}

// ---- create -----------------------------------------------------------------

export interface CreateBookingInput {
  barberId: number;
  serviceId: number;
  date: string;
  startTime: string;
  addressId?: number;
  address?: AddressInput & { save?: boolean; label?: string };
}

export function createBooking(customerId: number, input: CreateBookingInput) {
  if (!isDate(input.date) || !isTime(input.startTime)) throw badRequest('Choose a valid date and time.');
  const s = getSettings();
  try {
    return tx(() => {
      expireHolds();
      const barber = get<any>(
        `SELECT u.id, u.status, bp.verification_status FROM users u JOIN barber_profiles bp ON bp.user_id = u.id WHERE u.id = ? AND u.role = 'barber'`,
        input.barberId,
      );
      if (!barber || barber.status !== 'active' || barber.verification_status !== 'VERIFIED') throw notFound('This barber is not available.');

      const offer = get<any>(
        `SELECT bs.*, s.name AS service_name, s.active AS service_active FROM barber_services bs JOIN services s ON s.id = bs.service_id
         WHERE bs.barber_id = ? AND bs.service_id = ? AND bs.active = 1`,
        input.barberId,
        input.serviceId,
      );
      if (!offer || !offer.service_active) throw notFound('This service is not offered by the barber.');

      const unpaid = get<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE customer_id = ? AND status = 'PENDING_PAYMENT'`, customerId)!.c;
      if (unpaid >= 3) throw conflict('You have several unpaid bookings. Please pay or cancel them first.', 'TOO_MANY_UNPAID');

      // Server-side slot check (never trust the client's idea of availability).
      const slots = getSlots(input.barberId, input.date, offer.duration_min);
      if (!slots.some((sl) => sl.start === input.startTime)) throw conflict('This time slot is no longer available.', 'SLOT_UNAVAILABLE');

      // Address
      let addr: any;
      if (input.addressId) {
        addr = get<any>('SELECT * FROM addresses WHERE id = ? AND user_id = ?', input.addressId, customerId);
        if (!addr) throw notFound('Address not found.');
        validateDeltaAddress(addr);
      } else if (input.address) {
        validateDeltaAddress(input.address);
        addr = { ...input.address, state: 'Delta', id: null };
        if (input.address.save) {
          addr.id = run(
            `INSERT INTO addresses (user_id, label, address, city, state, landmark, instructions, latitude, longitude) VALUES (?, ?, ?, ?, 'Delta', ?, ?, ?, ?)`,
            customerId, input.address.label ?? 'Home', input.address.address, input.address.city, input.address.landmark ?? '', input.address.instructions ?? '', input.address.latitude ?? null, input.address.longitude ?? null,
          ).id;
        }
      } else throw badRequest('Please confirm your location before paying.', 'ADDRESS_REQUIRED');

      const fees = computeFees(offer.price_kobo, s.customer_fee_kobo, s.commission_bps);
      const endTime = fromMin(toMin(input.startTime) + offer.duration_min);
      const code = newCode();
      const r = run(
        `INSERT INTO bookings (code, customer_id, barber_id, service_id, service_name, address_id, address_text, address_city, address_landmark, address_instructions, latitude, longitude,
           booking_date, start_time, end_time, duration_min, service_price_kobo, customer_fee_kobo, amount_kobo, commission_bps, platform_fee_kobo, barber_earning_kobo, hold_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        code, customerId, input.barberId, input.serviceId, offer.service_name, addr.id ?? null, addr.address, addr.city, addr.landmark ?? '', addr.instructions ?? '',
        addr.latitude ?? null, addr.longitude ?? null, input.date, input.startTime, endTime, offer.duration_min,
        fees.servicePriceKobo, fees.customerFeeKobo, fees.amountKobo, s.commission_bps, fees.platformFeeKobo, fees.barberEarningKobo,
        Date.now() + s.booking_hold_minutes * 60_000,
      );
      run('INSERT INTO booking_events (booking_id, from_status, to_status, actor_id, actor_role) VALUES (?, NULL, ?, ?, ?)', r.id, 'PENDING_PAYMENT', customerId, 'customer');
      notify(customerId, 'booking_created', 'Booking created', `Complete payment within ${s.booking_hold_minutes} minutes to secure ${input.date} at ${input.startTime}.`, { bookingId: r.id });
      return getBookingRow(r.id);
    });
  } catch (e) {
    if (sqliteConstraint(e)) throw conflict('This time slot is no longer available.', 'SLOT_UNAVAILABLE');
    throw e;
  }
}

export const getBookingRow = (id: number) => get<any>('SELECT * FROM bookings WHERE id = ?', id);

// ---- views --------------------------------------------------------------------

/** Customer-facing and barber-facing shapes. Customer location is only revealed to the barber once the booking is accepted. */
export function viewBooking(b: any, viewer: { id: number; role: string }) {
  const customer = get<any>('SELECT id, name, phone, profile_image FROM users WHERE id = ?', b.customer_id);
  const barber = get<any>(
    `SELECT u.id, u.name, u.phone, u.profile_image, bp.rating_avg, bp.total_reviews FROM users u LEFT JOIN barber_profiles bp ON bp.user_id = u.id WHERE u.id = ?`,
    b.barber_id,
  );
  const isBarber = viewer.role === 'barber';
  const isAdmin = viewer.role === 'admin';
  const locationVisible = isAdmin || !isBarber || ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'VERIFIED', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED'].includes(b.status);
  const payment = get<any>('SELECT status, reference, amount_kobo, verified_at FROM payments WHERE booking_id = ? ORDER BY id DESC', b.id);
  const reviewed = !!get('SELECT 1 FROM reviews WHERE booking_id = ?', b.id);
  const base: any = {
    id: b.id,
    code: b.code,
    status: b.status,
    date: b.booking_date,
    startTime: b.start_time,
    endTime: b.end_time,
    durationMin: b.duration_min,
    serviceId: b.service_id,
    serviceName: b.service_name,
    servicePriceKobo: b.service_price_kobo,
    customerFeeKobo: b.customer_fee_kobo,
    amountKobo: b.amount_kobo,
    holdExpiresAt: b.hold_expires_at,
    cancelledBy: b.cancelled_by,
    cancelReason: b.cancel_reason,
    createdAt: b.created_at,
    payment: payment ? { status: payment.status, reference: payment.reference } : null,
    reviewed,
    barber: barber && { id: barber.id, name: barber.name, image: barber.profile_image, rating: barber.rating_avg, reviews: barber.total_reviews, phone: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'VERIFIED', 'IN_PROGRESS'].includes(b.status) ? barber.phone : undefined },
    customer: customer && { id: customer.id, name: customer.name, image: customer.profile_image, phone: locationVisible ? customer.phone : undefined },
    location: locationVisible
      ? { address: b.address_text, city: b.address_city, landmark: b.address_landmark, instructions: b.address_instructions, latitude: b.latitude, longitude: b.longitude }
      : { city: b.address_city },
  };
  if (isBarber) base.barberEarningKobo = b.barber_earning_kobo;
  if (isAdmin) Object.assign(base, { platformFeeKobo: b.platform_fee_kobo, barberEarningKobo: b.barber_earning_kobo, commissionBps: b.commission_bps });
  return base;
}

export function loadBookingFor(id: number, user: { id: number; role: string }) {
  const b = getBookingRow(id);
  if (!b) throw notFound('Booking not found.');
  if (user.role === 'customer' && b.customer_id !== user.id) throw notFound('Booking not found.');
  if (user.role === 'barber' && b.barber_id !== user.id) throw notFound('Booking not found.');
  return b;
}

// ---- barber actions -----------------------------------------------------------

function ownBarberBooking(id: number, barberId: number) {
  const b = getBookingRow(id);
  if (!b || b.barber_id !== barberId) throw notFound('Booking not found.');
  return b;
}

export function acceptBooking(id: number, barberId: number) {
  return tx(() => {
    const b = ownBarberBooking(id, barberId);
    transition(id, 'ACCEPTED', { id: barberId, role: 'barber' });
    notify(b.customer_id, 'booking_accepted', 'Barber accepted', `Your barber accepted booking ${b.code}. Keep your QR code ready.`, { bookingId: id });
    return getBookingRow(id);
  });
}

export async function cancelBooking(id: number, user: { id: number; role: 'customer' | 'barber' | 'admin' }, reason: string) {
  const s = getSettings();
  const refundId = tx(() => {
    const b = getBookingRow(id);
    if (!b) throw notFound('Booking not found.');
    if (user.role === 'customer' && b.customer_id !== user.id) throw notFound('Booking not found.');
    if (user.role === 'barber' && b.barber_id !== user.id) throw notFound('Booking not found.');

    const cancellable = user.role === 'customer'
      ? ['PENDING_PAYMENT', 'BARBER_PENDING', 'ACCEPTED']
      : user.role === 'barber'
        ? ['BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY']
        : ['PENDING_PAYMENT', 'BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'DISPUTED'];
    if (!cancellable.includes(b.status)) throw conflict('This booking can no longer be cancelled.', 'NOT_CANCELLABLE');

    const wasPaid = b.status !== 'PENDING_PAYMENT';
    transition(id, 'CANCELLED', { id: user.id, role: user.role }, reason);
    run(`UPDATE bookings SET cancelled_by = ?, cancel_reason = ?, cancelled_at = datetime('now'), hold_expires_at = NULL WHERE id = ?`, user.role, reason, id);
    revokeQr(id);
    run(`UPDATE payments SET status = 'CANCELLED' WHERE booking_id = ? AND status = 'PENDING'`, id);

    let refund: number | null = null;
    if (wasPaid) {
      let percent = 100;
      if (user.role === 'customer' && b.status !== 'BARBER_PENDING') {
        const hoursLeft = (lagosToEpoch(b.booking_date, b.start_time) - Date.now()) / 3_600_000;
        if (hoursLeft < s.cancel_free_hours) percent = s.late_cancel_refund_percent;
      }
      const amount = Math.floor((b.amount_kobo * percent) / 100);
      refund = createRefund(b, amount, `${user.role} cancellation: ${reason}`, user.id);
    }
    if (user.role === 'customer') notify(b.barber_id, 'booking_cancelled', 'Booking cancelled', `The customer cancelled booking ${b.code}.`, { bookingId: id });
    else notify(b.customer_id, 'booking_cancelled', user.role === 'barber' ? 'Barber cancelled' : 'Booking cancelled', `Booking ${b.code} was cancelled. ${wasPaid ? 'Your refund is being processed.' : ''}`, { bookingId: id });
    return refund;
  });
  if (refundId) await processRefund(refundId);
  return getBookingRow(id);
}

export function advanceTravel(id: number, barberId: number, to: 'ON_THE_WAY' | 'ARRIVED') {
  return tx(() => {
    const b = ownBarberBooking(id, barberId);
    transition(id, to, { id: barberId, role: 'barber' });
    notify(b.customer_id, to === 'ON_THE_WAY' ? 'barber_on_the_way' : 'barber_arrived', to === 'ON_THE_WAY' ? 'Barber is on the way' : 'Barber has arrived', to === 'ON_THE_WAY' ? `Your barber is heading to you for booking ${b.code}.` : 'Your barber is at your location. Show your QR code.', { bookingId: id });
    return getBookingRow(id);
  });
}

// ---- QR scan: verify appointment, mark job done, pay the barber ---------------

export type ScanRejection = 'INVALID' | 'WRONG_BARBER' | 'NOT_ACCEPTED' | 'CANCELLED' | 'TOO_EARLY' | 'EXPIRED' | 'ALREADY_USED' | 'NOT_PAID';

const SCAN_MESSAGES: Record<ScanRejection, string> = {
  INVALID: 'This appointment QR code is invalid or has already been used.',
  WRONG_BARBER: 'This appointment QR code is invalid or has already been used.',
  ALREADY_USED: 'This appointment QR code is invalid or has already been used.',
  CANCELLED: 'This appointment was cancelled.',
  NOT_PAID: 'This appointment has not been paid for.',
  NOT_ACCEPTED: 'Accept this booking in the app before verifying the appointment.',
  TOO_EARLY: 'This appointment is not due yet. You can verify it closer to the appointment time.',
  EXPIRED: 'This appointment QR code has expired. Please contact support.',
};

export class ScanError extends Error {
  constructor(public reason: ScanRejection) {
    super(SCAN_MESSAGES[reason]);
  }
}

function checkScan(barberId: number, payload: string, now = Date.now()) {
  const qr = findQrByPayload(payload);
  if (!qr) throw new ScanError('INVALID');
  const b = getBookingRow(qr.booking_id);
  if (!b) throw new ScanError('INVALID');
  if (b.barber_id !== barberId) throw new ScanError('WRONG_BARBER');
  if (qr.status === 'USED' || b.status === 'COMPLETED') throw new ScanError('ALREADY_USED');
  if (qr.status === 'REVOKED' || ['CANCELLED', 'REFUNDED'].includes(b.status)) throw new ScanError('CANCELLED');
  if (['PENDING_PAYMENT', 'CONFIRMED'].includes(b.status)) throw new ScanError('NOT_PAID');
  const paid = get('SELECT 1 FROM payments WHERE booking_id = ? AND status = ? AND verified = 1', b.id, 'SUCCESSFUL');
  if (!paid) throw new ScanError('NOT_PAID');
  if (b.status === 'BARBER_PENDING') throw new ScanError('NOT_ACCEPTED');
  if (!['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'].includes(b.status)) throw new ScanError('INVALID');
  const s = getSettings();
  const start = lagosToEpoch(b.booking_date, b.start_time);
  if (now < start - s.qr_window_before_min * 60_000) throw new ScanError('TOO_EARLY');
  if (now > qr.expires_at || qr.status === 'EXPIRED') throw new ScanError('EXPIRED');
  return { qr, booking: b };
}

export function lookupScan(barberId: number, payload: string, device: string | null, ip: string | null) {
  try {
    const { booking } = checkScan(barberId, payload);
    logScan(barberId, booking.id, 'LOOKUP_OK', null, device, ip);
    return viewBooking(booking, { id: barberId, role: 'barber' });
  } catch (e) {
    if (e instanceof ScanError) logScan(barberId, findQrByPayload(payload)?.booking_id ?? null, e.reason, null, device, ip);
    throw e;
  }
}

export function verifyScan(barberId: number, payload: string, device: string | null, ip: string | null) {
  try {
    const out = tx(() => {
      const { qr, booking } = checkScan(barberId, payload);
      // Atomic single-use: only one request can flip ACTIVE -> USED, so replays and double-taps fail.
      const flipped = run(`UPDATE qr_tokens SET status = 'USED', used_at = datetime('now') WHERE id = ? AND status = 'ACTIVE'`, qr.id);
      if (flipped.changes !== 1) throw new ScanError('ALREADY_USED');

      const actor: Actor = { id: barberId, role: 'barber' };
      transition(booking.id, 'VERIFIED', actor, 'Customer QR scanned');
      transition(booking.id, 'COMPLETED', actor, 'Service completed — verified by QR');
      run(`UPDATE bookings SET completed_at = datetime('now') WHERE id = ?`, booking.id);
      creditCompletedBooking(booking);
      logScan(barberId, booking.id, 'VERIFIED_COMPLETED', null, device, ip);

      notify(booking.customer_id, 'service_completed', 'Service completed', `Your appointment ${booking.code} is complete. Tell us how it went — leave a review!`, { bookingId: booking.id });
      notify(booking.barber_id, 'earnings_credited', 'Earnings credited', `${formatNaira(booking.barber_earning_kobo)} has been added to your wallet for ${booking.code}.`, { bookingId: booking.id });
      return getBookingRow(booking.id);
    });
    return viewBooking(out, { id: barberId, role: 'barber' });
  } catch (e) {
    if (e instanceof ScanError) {
      logScan(barberId, findQrByPayload(payload)?.booking_id ?? null, e.reason, null, device, ip);
    }
    throw e;
  }
}

export function customerQr(id: number, customerId: number) {
  const b = getBookingRow(id);
  if (!b || b.customer_id !== customerId) throw notFound('Booking not found.');
  const qr = qrPayloadFor(id);
  if (!qr) throw conflict('Your QR code is available once payment is confirmed.', 'NO_QR');
  return { payload: qr.payload, status: qr.status, booking: viewBooking(b, { id: customerId, role: 'customer' }) };
}

// ---- lists ----------------------------------------------------------------------

export const GROUPS: Record<string, string[]> = {
  upcoming: ['PENDING_PAYMENT', 'BARBER_PENDING', 'ACCEPTED'],
  active: ['ON_THE_WAY', 'ARRIVED', 'VERIFIED', 'IN_PROGRESS'],
  completed: ['COMPLETED'],
  cancelled: ['CANCELLED', 'REFUNDED'],
  disputed: ['DISPUTED'],
};

export function listBookings(user: { id: number; role: 'customer' | 'barber' }, group?: string) {
  const col = user.role === 'customer' ? 'customer_id' : 'barber_id';
  let sql = `SELECT * FROM bookings WHERE ${col} = ?`;
  const params: (string | number)[] = [user.id];
  if (user.role === 'barber') sql += ` AND status NOT IN ('PENDING_PAYMENT','CONFIRMED')`; // barbers never see unpaid bookings
  if (group && GROUPS[group]) {
    sql += ` AND status IN (${GROUPS[group].map(() => '?').join(',')})`;
    params.push(...GROUPS[group]);
  }
  sql += ' ORDER BY booking_date DESC, start_time DESC LIMIT 200';
  return all<any>(sql, ...params).map((b) => viewBooking(b, user));
}

export { addDays, lagosNow, forbidden };
