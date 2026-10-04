import { get, run } from './db.js';

/** Append-only record of admin and financial actions. */
export function audit(adminId: number | null, action: string, entityType: string, entityId: string | number | null, metadata: unknown = {}) {
  run(
    'INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    adminId,
    action,
    entityType,
    entityId === null ? null : String(entityId),
    JSON.stringify(metadata),
  );
}

// ---- Notifications -------------------------------------------------------
// In-app notifications are stored in the DB and always work. Email / SMS / push
// go through provider adapters. Only a console adapter ships now; plug real
// providers (Resend, Termii, FCM) in by implementing `ChannelProvider`.

export interface ChannelProvider {
  send(to: { userId: number; email?: string; phone?: string }, title: string, message: string): void | Promise<void>;
}

const consoleProvider = (channel: string): ChannelProvider => ({
  send(to, title) {
    if (process.env.NODE_ENV !== 'test') console.log(`[notify:${channel}] user=${to.userId} ${title}`);
  },
});

export const channelProviders: Record<'email' | 'sms' | 'push', ChannelProvider> = {
  email: consoleProvider('email'),
  sms: consoleProvider('sms'),
  push: consoleProvider('push'),
};

export function notify(userId: number, type: string, title: string, message: string, data: Record<string, unknown> = {}) {
  run('INSERT INTO notifications (user_id, title, message, type, data) VALUES (?, ?, ?, ?, ?)', userId, title, message, type, JSON.stringify(data));
  const u = get<any>('SELECT email, phone, notify_prefs FROM users WHERE id = ?', userId);
  if (!u) return;
  let prefs: any = {};
  try {
    prefs = JSON.parse(u.notify_prefs);
  } catch {
    /* defaults */
  }
  const to = { userId, email: u.email, phone: u.phone };
  for (const ch of ['email', 'sms', 'push'] as const) {
    if (prefs[ch]) Promise.resolve(channelProviders[ch].send(to, title, message)).catch(() => {});
  }
}
