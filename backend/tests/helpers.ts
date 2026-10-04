// Test harness: isolated in-memory database per test file (node:test runs each file in its own process).
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.PAYMENT_MODE = 'demo';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.QR_SECRET = 'test-qr-secret';
process.env.PAYSTACK_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.UPLOAD_DIR = './data/test-uploads';

import bcrypt from 'bcryptjs';
import supertest from 'supertest';

const { createApp } = await import('../src/app.js');
export const dbm = await import('../src/db.js');
export const { addDays, lagosNow, dayOfWeek } = await import('../src/time.js');
export const app = createApp();
export const api = supertest(app);

let n = 0;
export async function register(role: 'customer' | 'barber', name = role === 'customer' ? 'Test Customer' : 'Test Barber') {
  n++;
  const email = `${role}${n}@test.dev`;
  const phone = `0803${String(1000000 + n)}`;
  const r = await api.post('/api/auth/register').send({ name, email, phone, password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x', role });
  if (r.status !== 201) throw new Error('register failed: ' + JSON.stringify(r.body));
  return { token: r.body.token as string, id: r.body.user.id as number, email, user: r.body.user };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function makeAdmin() {
  const hash = await bcrypt.hash('AdminPass#123', 4);
  const id = dbm.run(`INSERT INTO users (role, name, email, phone, password_hash) VALUES ('admin', 'Admin', 'admin@test.dev', '08000000001', ?)`, hash).id;
  const r = await api.post('/api/auth/login').send({ email: 'admin@test.dev', password: 'AdminPass#123' });
  return { token: r.body.token as string, id };
}

export function seedServices() {
  for (const n of ['Haircut', 'Fade', 'Beard Trim']) dbm.run('INSERT OR IGNORE INTO services (name) VALUES (?)', n);
  return dbm.all<{ id: number; name: string }>('SELECT id, name FROM services');
}

/** A fully set-up, admin-verified barber in Asaba who works every day 09:00–17:00 with 60-min slots. */
export async function makeVerifiedBarber(admin: { token: string }, opts: { priceKobo?: number } = {}) {
  const b = await register('barber');
  const svc = seedServices().find((s) => s.name === 'Haircut')!;
  let r = await api.post('/api/me/uploads').set(auth(b.token)).send({
    kind: 'document',
    dataUrl: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64'),
  });
  const docUrl = r.body.url as string;
  r = await api.put('/api/barber/profile').set(auth(b.token)).send({
    bio: 'Test barber', experienceYears: 5, serviceArea: 'Asaba', address: '1 Test Rd, Asaba', homeService: true, idDocument: docUrl,
    bank: { bankCode: '058', accountNumber: '0123456789', accountName: 'TEST BARBER' },
  });
  if (r.status !== 200) throw new Error('profile: ' + JSON.stringify(r.body));
  await api.post('/api/barber/verification/submit').set(auth(b.token)).send().expect(200);
  await api.post(`/api/admin/barbers/${b.id}/approve`).set(auth(admin.token)).send().expect(200);
  await api.post('/api/barber/services').set(auth(b.token)).send({ serviceId: svc.id, priceKobo: opts.priceKobo ?? 1_000_000, durationMin: 60 }).expect(201);
  await api.put('/api/barber/availability').set(auth(b.token)).send({
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '17:00', active: true })),
  }).expect(200);
  return { ...b, serviceId: svc.id };
}

export const tomorrow = () => addDays(lagosNow().date, 1);
export const inDays = (n: number) => addDays(lagosNow().date, n);

export const asabaAddress = { address: '24 Nnebisi Road', city: 'Asaba', state: 'Delta', landmark: 'Near the mall', instructions: 'Blue gate' };

/** Create a booking and pay it through the demo checkout (same verify→settle path as production). */
export async function bookAndPay(customer: { token: string }, barber: { id: number; serviceId: number }, date: string, startTime: string) {
  const b = await api.post('/api/bookings').set(auth(customer.token)).send({ barberId: barber.id, serviceId: barber.serviceId, date, startTime, address: asabaAddress });
  if (b.status !== 201) throw new Error('booking: ' + JSON.stringify(b.body));
  const bookingId = b.body.booking.id as number;
  const init = await api.post('/api/payments/initialize').set(auth(customer.token)).send({ bookingId }).expect(200);
  const paid = await api.post('/api/payments/demo/pay').set(auth(customer.token)).send({ reference: init.body.reference, outcome: 'success' }).expect(200);
  return { bookingId, reference: init.body.reference as string, payStatus: paid.body.status as string, booking: b.body.booking };
}

export const qrFor = async (customer: { token: string }, bookingId: number) =>
  (await api.get(`/api/bookings/${bookingId}/qr`).set(auth(customer.token)).expect(200)).body.payload as string;

/** Tests override the "too early" window so any future booking is scannable. */
export function openScanWindow() {
  dbm.run(`UPDATE settings SET value = '100000' WHERE key = 'qr_window_before_min'`);
}
