import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { forbidden, unauthorized } from './errors.js';
import { get } from './db.js';

export type Role = 'customer' | 'barber' | 'admin';

export interface AuthUser {
  id: number;
  role: Role;
  name: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signToken(user: { id: number; role: Role }): string {
  // Admin sessions expire quickly; app sessions last longer.
  const expiresIn = user.role === 'admin' ? '2h' : '14d';
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw unauthorized();
    let payload: any;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('Your session has expired. Please log in again.');
    }
    // Always re-read the user: role and suspension must come from the DB, never the token alone.
    const u = get<any>('SELECT id, role, name, email, status FROM users WHERE id = ?', Number(payload.sub));
    if (!u) throw unauthorized();
    if (u.status !== 'active') throw forbidden('This account has been suspended. Please contact support.');
    req.user = { id: u.id, role: u.role, name: u.name, email: u.email };
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export const me = (req: Request): AuthUser => {
  if (!req.user) throw unauthorized();
  return req.user;
};
