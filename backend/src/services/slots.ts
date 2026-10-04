import { all, get } from '../db.js';
import { getSettings } from '../settings.js';
import { addDays, dayOfWeek, fromMin, lagosNow, toMin } from '../time.js';

export interface Slot {
  start: string;
  end: string;
}

/** Bookings that still block a barber's calendar. Expired payment holds do not. */
const LIVE = `status NOT IN ('CANCELLED','REFUNDED') AND NOT (status = 'PENDING_PAYMENT' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?)`;

export function getSlots(barberId: number, date: string, durationMin: number, now = Date.now()): Slot[] {
  const s = getSettings();
  const today = lagosNow(now);
  if (date < today.date || date > addDays(today.date, s.max_advance_days)) return [];

  const profile = get<any>('SELECT slot_minutes, max_daily FROM barber_profiles WHERE user_id = ?', barberId);
  if (!profile) return [];
  if (get('SELECT 1 FROM unavailable_dates WHERE barber_id = ? AND date = ?', barberId, date)) return [];

  const av = get<any>('SELECT * FROM availability WHERE barber_id = ? AND day_of_week = ? AND active = 1', barberId, dayOfWeek(date));
  if (!av) return [];

  const booked = all<{ start_time: string; end_time: string }>(
    `SELECT start_time, end_time FROM bookings WHERE barber_id = ? AND booking_date = ? AND ${LIVE}`,
    barberId,
    date,
    now,
  );
  if (booked.length >= profile.max_daily) return [];

  const step = Math.max(10, profile.slot_minutes);
  const open = toMin(av.start_time);
  const close = toMin(av.end_time);
  const brk = av.break_start && av.break_end ? [toMin(av.break_start), toMin(av.break_end)] : null;
  const earliestToday = today.minutes + s.lead_time_minutes;

  const slots: Slot[] = [];
  for (let t = open; t + durationMin <= close; t += step) {
    const end = t + durationMin;
    if (date === today.date && t < earliestToday) continue;
    if (brk && t < brk[1] && end > brk[0]) continue;
    if (booked.some((b) => t < toMin(b.end_time) && end > toMin(b.start_time))) continue;
    slots.push({ start: fromMin(t), end: fromMin(end) });
  }
  return slots;
}

/** Dates in the booking window that have at least one free slot. */
export function getAvailableDates(barberId: number, durationMin: number, now = Date.now()): string[] {
  const s = getSettings();
  const start = lagosNow(now).date;
  const out: string[] = [];
  for (let i = 0; i <= s.max_advance_days; i++) {
    const d = addDays(start, i);
    if (getSlots(barberId, d, durationMin, now).length) out.push(d);
  }
  return out;
}

export function isSlotFree(barberId: number, date: string, startTime: string, durationMin: number, now = Date.now()): boolean {
  return getSlots(barberId, date, durationMin, now).some((sl) => sl.start === startTime);
}
