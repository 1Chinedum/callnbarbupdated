import express, { Router } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { all, get, run } from '../db.js';
import { me, requireAuth, requireRole } from '../auth.js';
import { badRequest, forbidden, notFound, parse, wrap } from '../errors.js';
import { saveUpload } from '../uploads.js';
import { validateDeltaAddress } from '../services/bookings.js';
import { publicUser } from './auth.js';
import { normalizePhone, page } from './util.js';

export const meRouter = Router();
meRouter.use(requireAuth);

// ---- profile -------------------------------------------------------------------

meRouter.get('/profile', (req, res) => {
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', me(req).id)) });
});

meRouter.put('/profile', wrap(async (req, res) => {
  const d = parse(
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      email: z.string().trim().toLowerCase().email().optional(),
      phone: z.string().trim().optional(),
      image: z.string().max(300).nullable().optional(),
    }),
    req.body,
  );
  const u = get<any>('SELECT * FROM users WHERE id = ?', me(req).id);
  let phone = u.phone;
  if (d.phone) {
    const p = normalizePhone(d.phone);
    if (!p) throw badRequest('Enter a valid Nigerian phone number.', 'VALIDATION_ERROR');
    if (p !== u.phone && get('SELECT 1 FROM users WHERE phone = ?', p)) throw badRequest('That phone number is already in use.', 'PHONE_TAKEN');
    phone = p;
  }
  if (d.email && d.email !== u.email.toLowerCase() && get('SELECT 1 FROM users WHERE email = ?', d.email)) throw badRequest('That email is already in use.', 'EMAIL_TAKEN');
  if (d.image && !/^\/uploads\/[\w.-]+$/.test(d.image)) throw badRequest('Invalid image.', 'VALIDATION_ERROR');
  run(
    `UPDATE users SET name = ?, email = ?, phone = ?, profile_image = ?, email_verified = CASE WHEN ? != email THEN 0 ELSE email_verified END, updated_at = datetime('now') WHERE id = ?`,
    d.name ?? u.name, d.email ?? u.email, phone, d.image === undefined ? u.profile_image : d.image, d.email ?? u.email, u.id,
  );
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', u.id)) });
}));

meRouter.put('/notification-prefs', (req, res) => {
  const d = parse(z.object({ inapp: z.boolean(), email: z.boolean(), sms: z.boolean(), push: z.boolean() }), req.body);
  run('UPDATE users SET notify_prefs = ? WHERE id = ?', JSON.stringify({ ...d, inapp: true }), me(req).id);
  res.json({ ok: true });
});

// ---- addresses (Delta State only) ---------------------------------------------

const addressSchema = z.object({
  label: z.string().trim().max(30).default('Home'),
  address: z.string().trim().min(5).max(200),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().default('Delta'),
  landmark: z.string().trim().max(120).default(''),
  instructions: z.string().trim().max(300).default(''),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

meRouter.get('/addresses', (req, res) => {
  res.json({ addresses: all('SELECT * FROM addresses WHERE user_id = ? ORDER BY id DESC', me(req).id) });
});

meRouter.post('/addresses', (req, res) => {
  const d = parse(addressSchema, req.body);
  validateDeltaAddress(d);
  const id = run(
    `INSERT INTO addresses (user_id, label, address, city, state, landmark, instructions, latitude, longitude) VALUES (?, ?, ?, ?, 'Delta', ?, ?, ?, ?)`,
    me(req).id, d.label, d.address, d.city, d.landmark, d.instructions, d.latitude ?? null, d.longitude ?? null,
  ).id;
  res.status(201).json({ address: get('SELECT * FROM addresses WHERE id = ?', id) });
});

meRouter.delete('/addresses/:id', (req, res) => {
  const r = run('DELETE FROM addresses WHERE id = ? AND user_id = ?', Number(req.params.id), me(req).id);
  if (!r.changes) throw notFound('Address not found.');
  res.json({ ok: true });
});

// ---- uploads --------------------------------------------------------------------

meRouter.post('/uploads', express.json({ limit: '7mb' }), (req, res) => {
  const d = parse(z.object({ kind: z.enum(['avatar', 'portfolio', 'document', 'evidence']), dataUrl: z.string() }), req.body);
  if ((d.kind === 'document' || d.kind === 'portfolio') && me(req).role !== 'barber') throw forbidden();
  const out = saveUpload(d.kind, d.dataUrl);
  if (d.kind === 'portfolio') run('INSERT INTO portfolio_images (barber_id, url) VALUES (?, ?)', me(req).id, out.url);
  res.status(201).json(out);
});

// Private files: only the owner's admin reviewers can fetch. Barber documents -> admin; evidence -> admin + parties.
meRouter.get('/uploads/private/:name', (req, res) => {
  const name = String(req.params.name);
  if (!/^[\w-]+\.(jpg|png|webp|pdf)$/.test(name)) throw notFound();
  const u = me(req);
  const url = `/api/me/uploads/private/${name}`;
  if (u.role !== 'admin') {
    const mine =
      get('SELECT 1 FROM barber_profiles WHERE user_id = ? AND id_document = ?', u.id, url) ||
      get('SELECT 1 FROM disputes WHERE opened_by = ? AND evidence = ?', u.id, url) ||
      get('SELECT 1 FROM support_tickets WHERE user_id = ? AND attachment = ?', u.id, url);
    if (!mine) throw forbidden();
  }
  const file = resolve(join(config.uploadDir, 'private', name));
  if (!existsSync(file)) throw notFound();
  res.sendFile(file);
});

// ---- notifications -----------------------------------------------------------------

meRouter.get('/notifications', (req, res) => {
  const { limit, offset } = page(req, 30);
  const rows = all<any>('SELECT id, title, message, type, data, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', me(req).id, limit, offset);
  const unread = get<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', me(req).id)!.c;
  res.json({ notifications: rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : {} })), unread });
});
meRouter.post('/notifications/read-all', (req, res) => {
  run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`, me(req).id);
  res.json({ ok: true });
});
meRouter.post('/notifications/:id/read', (req, res) => {
  run(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?`, Number(req.params.id), me(req).id);
  res.json({ ok: true });
});

// ---- support & disputes --------------------------------------------------------------

const CATEGORIES = ['Payment issue', 'Booking issue', 'Barber issue', 'Customer issue', 'Refund', 'Withdrawal', 'Technical problem', 'Other'] as const;

meRouter.get('/support/categories', (_req, res) => res.json({ categories: CATEGORIES }));

meRouter.post('/support/tickets', requireRole('customer', 'barber'), (req, res) => {
  const d = parse(
    z.object({
      category: z.enum(CATEGORIES),
      subject: z.string().trim().min(3).max(120),
      description: z.string().trim().min(10).max(2000),
      bookingId: z.number().int().optional(),
      attachment: z.string().max(300).optional(),
    }),
    req.body,
  );
  const u = me(req);
  if (d.bookingId) {
    const b = get<any>('SELECT customer_id, barber_id FROM bookings WHERE id = ?', d.bookingId);
    if (!b || (b.customer_id !== u.id && b.barber_id !== u.id)) throw badRequest('Booking not found.');
  }
  const id = run('INSERT INTO support_tickets (user_id, booking_id, category, subject, description, attachment) VALUES (?, ?, ?, ?, ?, ?)', u.id, d.bookingId ?? null, d.category, d.subject, d.description, d.attachment ?? null).id;
  res.status(201).json({ ticket: get('SELECT * FROM support_tickets WHERE id = ?', id) });
});

meRouter.get('/support/tickets', (req, res) => {
  res.json({ tickets: all('SELECT id, booking_id AS bookingId, category, subject, description, status, admin_reply AS adminReply, created_at AS createdAt FROM support_tickets WHERE user_id = ? ORDER BY id DESC', me(req).id) });
});

meRouter.get('/disputes', (req, res) => {
  res.json({ disputes: all('SELECT id, booking_id AS bookingId, reason, description, status, resolution, created_at AS createdAt FROM disputes WHERE opened_by = ? ORDER BY id DESC', me(req).id) });
});
