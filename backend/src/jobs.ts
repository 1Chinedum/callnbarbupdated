import { all, get, run, tx } from './db.js';
import { notify } from './notify.js';
import { expireHolds } from './services/bookings.js';
import { retryPendingRefunds } from './services/payments.js';
import { lagosToEpoch } from './time.js';

/** Periodic maintenance: expire unpaid holds, retry refunds, send appointment reminders. Safe to run repeatedly. */
export async function runJobs(now = Date.now()) {
  tx(() => expireHolds(now));
  await retryPendingRefunds();
  sendReminders(now);
}

export function sendReminders(now = Date.now()) {
  // Only live, accepted/awaiting appointments get reminders — never cancelled/refunded/completed ones.
  const rows = all<any>(`SELECT * FROM bookings WHERE status IN ('BARBER_PENDING','ACCEPTED','ON_THE_WAY') AND (reminder_24h_sent = 0 OR reminder_1h_sent = 0)`);
  for (const b of rows) {
    const until = lagosToEpoch(b.booking_date, b.start_time) - now;
    if (until <= 0) continue;
    if (until <= 3_600_000 && !b.reminder_1h_sent) {
      remind(b, 'in 1 hour');
      run('UPDATE bookings SET reminder_1h_sent = 1, reminder_24h_sent = 1 WHERE id = ?', b.id);
    } else if (until <= 86_400_000 && !b.reminder_24h_sent) {
      remind(b, 'tomorrow');
      run('UPDATE bookings SET reminder_24h_sent = 1 WHERE id = ?', b.id);
    }
  }
}

function remind(b: any, when: string) {
  const msg = `Reminder: ${b.service_name} ${when} (${b.booking_date} at ${b.start_time}).`;
  notify(b.customer_id, 'reminder', 'Appointment reminder', msg, { bookingId: b.id });
  notify(b.barber_id, 'reminder', 'Appointment reminder', msg, { bookingId: b.id });
}

export function startJobs() {
  const t = setInterval(() => runJobs().catch((e) => console.error('[jobs]', e)), 60_000);
  t.unref();
}

export const _get = get;
