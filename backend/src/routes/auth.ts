import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { get, run, tx } from '../db.js';
import { me, requireAuth, signToken } from '../auth.js';
import { AppError, badRequest, conflict, parse, unauthorized, wrap } from '../errors.js';
import { notify } from '../notify.js';
import { ensureWallet } from '../services/wallet.js';
import { normalizePhone } from './util.js';

export const authRouter = Router();

const referral = () => randomBytes(4).toString('hex').toUpperCase();

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(80),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    phone: z.string().trim(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    confirmPassword: z.string(),
    role: z.enum(['customer', 'barber']),
    referralCode: z.string().trim().max(20).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

export function publicUser(u: any) {
  const out: any = {
    id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, image: u.profile_image,
    status: u.status, emailVerified: !!u.email_verified, phoneVerified: !!u.phone_verified, referralCode: u.referral_code,
    notifyPrefs: (() => { try { return JSON.parse(u.notify_prefs); } catch { return { inapp: true, email: true, sms: false, push: true }; } })(),
  };
  if (u.role === 'barber') {
    const bp = get<any>('SELECT verification_status, rejection_reason FROM barber_profiles WHERE user_id = ?', u.id);
    out.verificationStatus = bp?.verification_status;
    out.rejectionReason = bp?.rejection_reason;
  }
  return out;
}

authRouter.post('/register', wrap(async (req, res) => {
  const d = parse(registerSchema, req.body);
  const phone = normalizePhone(d.phone);
  if (!phone) throw badRequest('Enter a valid Nigerian phone number.', 'VALIDATION_ERROR');
  if (get('SELECT 1 FROM users WHERE email = ?', d.email)) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
  if (get('SELECT 1 FROM users WHERE phone = ?', phone)) throw conflict('An account with this phone number already exists.', 'PHONE_TAKEN');
  const hash = await bcrypt.hash(d.password, 12);
  const referrer = d.referralCode ? get<any>('SELECT id FROM users WHERE referral_code = ?', d.referralCode.toUpperCase()) : undefined;
  const user = tx(() => {
    const id = run(
      `INSERT INTO users (role, name, email, phone, password_hash, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      d.role, d.name, d.email, phone, hash, referral(), referrer?.id ?? null,
    ).id;
    if (d.role === 'barber') {
      run('INSERT INTO barber_profiles (user_id) VALUES (?)', id);
      ensureWallet(id);
    }
    notify(id, 'welcome', 'Welcome to CallNBarb', d.role === 'barber' ? 'Complete your profile and submit your documents so we can verify you.' : 'Find a barber in Delta State and book your first cut.');
    return get<any>('SELECT * FROM users WHERE id = ?', id);
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

authRouter.post('/login', wrap(async (req, res) => {
  const d = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) }), req.body);
  const u = get<any>('SELECT * FROM users WHERE email = ?', d.email);
  // Same message for unknown email and wrong password.
  const ok = u ? await bcrypt.compare(d.password, u.password_hash) : await bcrypt.compare(d.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
  if (!u || !ok) throw unauthorized('Incorrect email or password.');
  if (u.status !== 'active') throw new AppError(403, 'SUSPENDED', 'This account has been suspended. Please contact support.');
  res.json({ token: signToken(u), user: publicUser(u) });
}));

// Tokens are stateless JWTs; the client discards its token. Endpoint exists for symmetry/auditing.
authRouter.post('/logout', requireAuth, (_req, res) => res.json({ ok: true }));

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', me(req).id)) });
});

authRouter.post('/change-password', requireAuth, wrap(async (req, res) => {
  const d = parse(z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(128) }), req.body);
  const u = get<any>('SELECT * FROM users WHERE id = ?', me(req).id);
  if (!(await bcrypt.compare(d.currentPassword, u.password_hash))) throw badRequest('Your current password is incorrect.', 'WRONG_PASSWORD');
  run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, await bcrypt.hash(d.newPassword, 12), u.id);
  res.json({ ok: true });
}));

authRouter.post('/forgot-password', wrap(async (req, res) => {
  const d = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
  const u = get<any>('SELECT id FROM users WHERE email = ?', d.email);
  let devToken: string | undefined;
  if (u) {
    const token = randomBytes(24).toString('hex');
    run('UPDATE users SET reset_token_hash = ?, reset_expires_at = ? WHERE id = ?', createHash('sha256').update(token).digest('hex'), Date.now() + 30 * 60_000, u.id);
    // TODO(email provider): email the reset link. Until an email provider is configured the token is only
    // exposed in development so the flow can be tested.
    if (!config.isProd) devToken = token;
  }
  // Always the same response so the endpoint cannot be used to discover registered emails.
  res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.', ...(devToken ? { devResetToken: devToken } : {}) });
}));

authRouter.post('/reset-password', wrap(async (req, res) => {
  const d = parse(z.object({ token: z.string().min(10), newPassword: z.string().min(8).max(128) }), req.body);
  const hash = createHash('sha256').update(d.token).digest('hex');
  const u = get<any>('SELECT id, reset_expires_at FROM users WHERE reset_token_hash = ?', hash);
  if (!u || !u.reset_expires_at || u.reset_expires_at < Date.now()) throw badRequest('This reset link is invalid or has expired.', 'INVALID_TOKEN');
  run(`UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires_at = NULL, updated_at = datetime('now') WHERE id = ?`, await bcrypt.hash(d.newPassword, 12), u.id);
  res.json({ ok: true });
}));
