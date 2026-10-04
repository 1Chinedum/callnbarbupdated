import type { Request } from 'express';

export function page(req: Request, defaultLimit = 25) {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || defaultLimit));
  const pg = Math.max(1, Number(req.query.page) || 1);
  return { limit, offset: (pg - 1) * limit, page: pg };
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const num = (v: unknown): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const clientIp = (req: Request): string | null => req.ip ?? null;
export const device = (req: Request): string | null => String(req.headers['user-agent'] ?? '').slice(0, 200) || null;

/** Normalise Nigerian phone numbers to the local 11-digit form (e.g. 08012345678). */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+234')) d = '0' + d.slice(4);
  else if (d.startsWith('234') && d.length === 13) d = '0' + d.slice(3);
  else if (d.length === 10 && /^[789]/.test(d)) d = '0' + d;
  return /^0[789]\d{9}$/.test(d) ? d : null;
}
