import { Router } from 'express';
import { config } from '../config.js';
import { all, get } from '../db.js';
import { DELTA_CENTER, DELTA_TOWNS, SERVICE_STATE, findTown, haversineKm } from '../delta.js';
import { badRequest, notFound, wrap } from '../errors.js';
import { getSettings } from '../settings.js';
import { getAvailableDates, getSlots } from '../services/slots.js';
import { BANKS } from '../services/wallet.js';
import { isDate, lagosNow } from '../time.js';
import { LEGAL } from '../legal.js';
import { num, str } from './util.js';

export const publicRouter = Router();

publicRouter.get('/meta', (_req, res) => {
  const s = getSettings();
  res.json({
    state: SERVICE_STATE,
    towns: DELTA_TOWNS,
    center: DELTA_CENTER,
    currency: config.currency,
    paymentMode: config.paymentMode, // 'demo' shows a "demo payments" banner in the app
    banks: BANKS,
    rules: {
      minWithdrawalKobo: s.min_withdrawal_kobo,
      customerFeeKobo: s.customer_fee_kobo,
      cancelFreeHours: s.cancel_free_hours,
      lateCancelRefundPercent: s.late_cancel_refund_percent,
      bookingHoldMinutes: s.booking_hold_minutes,
      maxAdvanceDays: s.max_advance_days,
    },
  });
});

publicRouter.get('/services', (_req, res) => {
  res.json({ services: all('SELECT id, name, description, icon FROM services WHERE active = 1 ORDER BY id') });
});

publicRouter.get('/legal/:slug', (req, res) => {
  const doc = LEGAL[req.params.slug];
  if (!doc) throw notFound('Page not found.');
  res.json(doc);
});
publicRouter.get('/legal', (_req, res) => res.json({ pages: Object.entries(LEGAL).map(([slug, d]) => ({ slug, title: d.title })) }));

// ---- Barber discovery ---------------------------------------------------------

function barberCard(r: any, from?: { lat: number; lng: number }) {
  const services = all<any>(
    `SELECT bs.service_id AS serviceId, s.name, bs.price_kobo AS priceKobo, bs.duration_min AS durationMin FROM barber_services bs JOIN services s ON s.id = bs.service_id
     WHERE bs.barber_id = ? AND bs.active = 1 AND s.active = 1 ORDER BY bs.price_kobo`,
    r.user_id, // NB: bp.* also has an `id` column, so always use user_id for the user
  );
  const town = findTown(r.service_area);
  const lat = r.latitude ?? town?.lat;
  const lng = r.longitude ?? town?.lng;
  const distanceKm = from && lat != null && lng != null ? Math.round(haversineKm(from.lat, from.lng, lat, lng) * 10) / 10 : null;
  const dur = services[0]?.durationMin ?? 60;
  const next = services.length ? getAvailableDates(r.user_id, dur).slice(0, 1)[0] ?? null : null;
  return {
    id: r.user_id,
    name: r.name,
    image: r.profile_image,
    verified: r.verification_status === 'VERIFIED',
    rating: Math.round(r.rating_avg * 10) / 10,
    reviews: r.total_reviews,
    experienceYears: r.experience_years,
    serviceArea: r.service_area,
    homeService: !!r.home_service,
    completedJobs: r.completed_jobs,
    startingPriceKobo: services[0]?.priceKobo ?? null,
    services,
    nextAvailableDate: next,
    availableToday: next === lagosNow().date,
    distanceKm,
    latitude: lat ?? null,
    longitude: lat != null ? lng : null,
  };
}

const BASE = `
  SELECT u.id, u.name, u.profile_image, bp.*,
    (SELECT COUNT(*) FROM bookings b WHERE b.barber_id = u.id AND b.status = 'COMPLETED') AS completed_jobs
  FROM users u JOIN barber_profiles bp ON bp.user_id = u.id
  WHERE u.role = 'barber' AND u.status = 'active' AND bp.verification_status = 'VERIFIED'`;

publicRouter.get('/barbers', wrap(async (req, res) => {
  const q = str(req.query.q).trim().toLowerCase();
  const town = str(req.query.town).trim();
  const serviceId = num(req.query.serviceId);
  const maxPrice = num(req.query.maxPriceKobo);
  const minPrice = num(req.query.minPriceKobo);
  const minRating = num(req.query.minRating);
  const maxDistance = num(req.query.maxDistanceKm);
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  const sort = str(req.query.sort) || 'recommended';
  const from = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;

  let rows = all<any>(BASE);
  if (town) rows = rows.filter((r) => r.service_area.toLowerCase() === town.toLowerCase());
  if (str(req.query.homeService) === '1') rows = rows.filter((r) => r.home_service);
  if (minRating !== undefined) rows = rows.filter((r) => r.rating_avg >= minRating);

  let cards = rows.map((r) => barberCard(r, from)).filter((c) => c.services.length > 0);
  if (q) {
    cards = cards.filter(
      (c) => c.name.toLowerCase().includes(q) || c.serviceArea.toLowerCase().includes(q) || c.services.some((s) => s.name.toLowerCase().includes(q)),
    );
  }
  if (serviceId !== undefined) cards = cards.filter((c) => c.services.some((s) => s.serviceId === serviceId));
  if (maxPrice !== undefined) cards = cards.filter((c) => (c.startingPriceKobo ?? Infinity) <= maxPrice);
  if (minPrice !== undefined) cards = cards.filter((c) => (c.startingPriceKobo ?? 0) >= minPrice);
  if (maxDistance !== undefined) cards = cards.filter((c) => c.distanceKm !== null && c.distanceKm <= maxDistance);
  if (str(req.query.availableToday) === '1') cards = cards.filter((c) => c.availableToday);

  const score = (c: (typeof cards)[number]) => c.rating * Math.log(c.reviews + 2) + Math.log(c.completedJobs + 1);
  const sorters: Record<string, (a: any, b: any) => number> = {
    recommended: (a, b) => score(b) - score(a),
    nearest: (a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
    rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
    price_low: (a, b) => (a.startingPriceKobo ?? 1e12) - (b.startingPriceKobo ?? 1e12),
    price_high: (a, b) => (b.startingPriceKobo ?? 0) - (a.startingPriceKobo ?? 0),
    popularity: (a, b) => b.completedJobs - a.completedJobs,
  };
  cards.sort(sorters[sort] ?? sorters.recommended);
  res.json({ barbers: cards.slice(0, 50), total: cards.length });
}));

publicRouter.get('/barbers/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const row = get<any>(`${BASE} AND u.id = ?`, id);
  if (!row) throw notFound('This barber is not available.');
  const card = barberCard(row);
  const availability = all<any>('SELECT day_of_week AS dayOfWeek, start_time AS startTime, end_time AS endTime FROM availability WHERE barber_id = ? AND active = 1 ORDER BY day_of_week', id);
  const reviews = all<any>(
    `SELECT r.id, r.rating, r.comment, r.created_at AS createdAt, u.name AS customerName FROM reviews r JOIN users u ON u.id = r.customer_id
     WHERE r.barber_id = ? AND r.hidden = 0 ORDER BY r.id DESC LIMIT 20`,
    id,
  ).map((r) => ({ ...r, customerName: r.customerName.split(' ')[0] })); // first name only
  const portfolio = all<{ url: string }>('SELECT url FROM portfolio_images WHERE barber_id = ? ORDER BY id DESC LIMIT 20', id).map((p) => p.url);
  // Private details (phone, address, bank) are never exposed here.
  res.json({ barber: { ...card, bio: row.bio, availability, reviewsList: reviews, portfolio } });
}));

publicRouter.get('/barbers/:id/dates', wrap(async (req, res) => {
  const duration = num(req.query.durationMin) ?? 60;
  const serviceId = num(req.query.serviceId);
  const id = Number(req.params.id);
  const dur = serviceId
    ? get<any>('SELECT duration_min FROM barber_services WHERE barber_id = ? AND service_id = ? AND active = 1', id, serviceId)?.duration_min
    : duration;
  if (!dur) throw notFound('Service not found.');
  res.json({ dates: getAvailableDates(id, dur) });
}));

publicRouter.get('/barbers/:id/slots', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const date = str(req.query.date);
  const serviceId = num(req.query.serviceId);
  if (!isDate(date)) throw badRequest('Choose a valid date.');
  if (serviceId === undefined) throw badRequest('serviceId is required.');
  const offer = get<any>('SELECT duration_min FROM barber_services WHERE barber_id = ? AND service_id = ? AND active = 1', id, serviceId);
  if (!offer) throw notFound('Service not found.');
  res.json({ date, slots: getSlots(id, date, offer.duration_min) });
}));
