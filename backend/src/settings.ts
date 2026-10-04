import { all, get, run } from './db.js';

export interface Settings {
  commission_bps: number;
  min_withdrawal_kobo: number;
  customer_fee_kobo: number;
  cancel_free_hours: number;
  late_cancel_refund_percent: number;
  booking_hold_minutes: number;
  lead_time_minutes: number;
  max_advance_days: number;
  qr_window_before_min: number;
  qr_window_after_min: number;
}

export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = Number(r.value);
  return out as unknown as Settings;
}

const LIMITS: Record<keyof Settings, [number, number]> = {
  commission_bps: [0, 5000],
  min_withdrawal_kobo: [0, 100_000_000],
  customer_fee_kobo: [0, 10_000_000],
  cancel_free_hours: [0, 168],
  late_cancel_refund_percent: [0, 100],
  booking_hold_minutes: [5, 120],
  lead_time_minutes: [0, 1440],
  max_advance_days: [1, 180],
  qr_window_before_min: [0, 1440],
  qr_window_after_min: [0, 4320],
};

export function updateSettings(patch: Record<string, unknown>): Record<string, number> {
  const changed: Record<string, number> = {};
  for (const [k, v] of Object.entries(patch)) {
    const lim = LIMITS[k as keyof Settings];
    if (!lim) throw new Error(`Unknown setting ${k}`);
    const n = Number(v);
    if (!Number.isInteger(n) || n < lim[0] || n > lim[1]) throw new Error(`${k} must be an integer between ${lim[0]} and ${lim[1]}`);
    run(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, k, String(n));
    changed[k] = n;
  }
  return changed;
}

export const settingExists = (key: string) => !!get('SELECT 1 FROM settings WHERE key = ?', key);
