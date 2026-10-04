import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { get, run } from '../db.js';
import { config } from '../config.js';
import { getSettings } from '../settings.js';
import { lagosToEpoch } from '../time.js';

// QR payload = "CNB1." + HMAC-SHA256(QR_SECRET, bookingId:nonce).
// - Contains no personal data and is not guessable without the server secret.
// - Only the SHA-256 hash of the token is stored for lookup; the token is
//   re-derivable by the server so the customer can re-open their QR.
// - Single-use: marked USED atomically at scan time (see verifyQr).

const PREFIX = 'CNB1.';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const deriveToken = (bookingId: number, nonce: string) => createHmac('sha256', config.qrSecret).update(`${bookingId}:${nonce}`).digest('base64url');

export function issueQr(booking: { id: number; booking_date: string; end_time: string }) {
  const existing = get<any>('SELECT * FROM qr_tokens WHERE booking_id = ?', booking.id);
  if (existing) return existing;
  const nonce = randomBytes(16).toString('hex');
  const token = deriveToken(booking.id, nonce);
  const expiresAt = lagosToEpoch(booking.booking_date, booking.end_time) + getSettings().qr_window_after_min * 60_000;
  run('INSERT INTO qr_tokens (booking_id, nonce, token_hash, expires_at) VALUES (?, ?, ?, ?)', booking.id, nonce, hashToken(token), expiresAt);
  return get<any>('SELECT * FROM qr_tokens WHERE booking_id = ?', booking.id);
}

export function revokeQr(bookingId: number) {
  run(`UPDATE qr_tokens SET status = 'REVOKED' WHERE booking_id = ? AND status = 'ACTIVE'`, bookingId);
}

/** Returns the scannable payload for the booking's customer. */
export function qrPayloadFor(bookingId: number): { payload: string; status: string; expiresAt: number } | null {
  const row = get<any>('SELECT * FROM qr_tokens WHERE booking_id = ?', bookingId);
  if (!row) return null;
  return { payload: PREFIX + deriveToken(bookingId, row.nonce), status: row.status, expiresAt: row.expires_at };
}

export function findQrByPayload(payload: string): any | null {
  if (typeof payload !== 'string' || !payload.startsWith(PREFIX) || payload.length > 200) return null;
  const token = payload.slice(PREFIX.length);
  const hash = hashToken(token);
  const row = get<any>('SELECT * FROM qr_tokens WHERE token_hash = ?', hash);
  if (!row) return null;
  // Constant-time confirmation that the token really derives from the server secret.
  const expected = Buffer.from(deriveToken(row.booking_id, row.nonce));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return row;
}

export function logScan(barberId: number, bookingId: number | null, result: string, detail: string | null, device: string | null, ip: string | null) {
  run('INSERT INTO qr_scans (booking_id, barber_id, result, detail, device, ip) VALUES (?, ?, ?, ?, ?, ?)', bookingId, barberId, result, detail, device, ip);
}
