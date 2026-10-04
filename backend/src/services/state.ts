import { get, run } from '../db.js';
import { conflict, notFound } from '../errors.js';

export type BookingStatus =
  | 'PENDING_PAYMENT' | 'CONFIRMED' | 'BARBER_PENDING' | 'ACCEPTED' | 'ON_THE_WAY' | 'ARRIVED'
  | 'VERIFIED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED' | 'REFUNDED';

// The only legal status changes. Everything goes through transition(); clients can never set a status.
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'BARBER_PENDING', 'CANCELLED'],
  CONFIRMED: ['BARBER_PENDING', 'CANCELLED'],
  BARBER_PENDING: ['ACCEPTED', 'CANCELLED', 'DISPUTED'],
  ACCEPTED: ['ON_THE_WAY', 'VERIFIED', 'CANCELLED', 'DISPUTED'],
  ON_THE_WAY: ['ARRIVED', 'VERIFIED', 'CANCELLED', 'DISPUTED'],
  ARRIVED: ['VERIFIED', 'CANCELLED', 'DISPUTED'],
  VERIFIED: ['IN_PROGRESS', 'COMPLETED', 'DISPUTED'],
  IN_PROGRESS: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['DISPUTED'],
  CANCELLED: ['REFUNDED'],
  DISPUTED: ['BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'REFUNDED'],
  REFUNDED: [],
};

export interface Actor {
  id: number | null;
  role: 'customer' | 'barber' | 'admin' | 'system';
}

/** Validates and applies a status change and records it in booking_events. MUST run inside tx(). */
export function transition(bookingId: number, to: BookingStatus, actor: Actor, note?: string): any {
  const b = get<any>('SELECT * FROM bookings WHERE id = ?', bookingId);
  if (!b) throw notFound('Booking not found.');
  const from = b.status as BookingStatus;
  if (!TRANSITIONS[from]?.includes(to)) {
    throw conflict(`This booking cannot move from ${from} to ${to}.`, 'INVALID_TRANSITION');
  }
  run(`UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?`, to, bookingId);
  run('INSERT INTO booking_events (booking_id, from_status, to_status, actor_id, actor_role, note) VALUES (?, ?, ?, ?, ?, ?)', bookingId, from, to, actor.id, actor.role, note ?? null);
  return { ...b, status: to };
}

export const ACTIVE_STATUSES: BookingStatus[] = ['BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'VERIFIED', 'IN_PROGRESS'];
