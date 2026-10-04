import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { all, get, run, tx } from './db.js';
import { computeFees } from './money.js';
import { ensureWallet, creditCompletedBooking } from './services/wallet.js';
import { refreshRating } from './routes/bookings.js';
import { addDays, lagosNow } from './time.js';
import { findTown } from './delta.js';

const adminOnly = process.argv.includes('--admin-only');

const SERVICES: [string, string][] = [
  ['Haircut', 'Classic haircut, neatly finished'],
  ['Low Cut', 'Short, even all-round cut'],
  ['Fade', 'Clean fade with sharp edges'],
  ['Skin Fade', 'Zero-guard skin fade'],
  ['Afro', 'Afro shaping and trim'],
  ['Beard Trim', 'Beard shaping and line-up'],
  ['Hair + Beard', 'Haircut and beard trim combo'],
  ['Kids Haircut', 'Gentle cuts for children'],
  ['Home Service', 'Premium at-home grooming session'],
  ['Styling', 'Styling and finishing'],
  ['Other', 'Other barbering service'],
];

async function createUser(role: 'customer' | 'barber' | 'admin', name: string, email: string, phone: string, password: string) {
  const existing = get<any>('SELECT id FROM users WHERE email = ?', email);
  if (existing) return existing.id as number;
  const hash = await bcrypt.hash(password, 12);
  const id = run(`INSERT INTO users (role, name, email, phone, password_hash, referral_code, email_verified) VALUES (?, ?, ?, ?, ?, ?, 1)`, role, name, email, phone, hash, randomBytes(4).toString('hex').toUpperCase()).id;
  if (role === 'barber') {
    run('INSERT INTO barber_profiles (user_id) VALUES (?)', id);
    ensureWallet(id);
  }
  return id;
}

async function main() {
  for (const [name, description] of SERVICES) run('INSERT OR IGNORE INTO services (name, description) VALUES (?, ?)', name, description);

  // ---- production-safe: just the first admin ---------------------------------------
  if (adminOnly || config.isProd) {
    if (!config.adminEmail || config.adminPassword.length < 8) throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of 8+ characters.');
    await createUser('admin', 'Administrator', config.adminEmail, '08000000000', config.adminPassword);
    console.log(`Admin ready: ${config.adminEmail}`);
    return;
  }

  // ---- development demo data ------------------------------------------------------------
  const PASS = 'Demo#1234';
  await createUser('admin', 'Demo Admin', config.adminEmail || 'admin@callnbarb.test', '08000000000', config.adminPassword || PASS);
  const customer = await createUser('customer', 'Demo Customer', 'customer@callnbarb.test', '08011111111', PASS);
  const customer2 = await createUser('customer', 'Ada Obi', 'ada@callnbarb.test', '08022222222', PASS);

  const barbers = [
    { name: 'Tunde Okafor', email: 'tunde@callnbarb.test', phone: '08033333331', town: 'Asaba', years: 8, bio: 'Precision fades and clean line-ups. I come to you anywhere in Asaba.', prices: { Haircut: 3000, Fade: 4000, 'Skin Fade': 5000, 'Beard Trim': 2000, 'Hair + Beard': 5000, 'Kids Haircut': 2500 } },
    { name: 'Emeka Nwosu', email: 'emeka@callnbarb.test', phone: '08033333332', town: 'Warri', years: 5, bio: 'Warri-based barber specialising in low cuts and afro shaping.', prices: { Haircut: 2500, 'Low Cut': 2000, Afro: 3000, 'Beard Trim': 1500, 'Kids Haircut': 2000 } },
    { name: 'Samuel Ejiro', email: 'samuel@callnbarb.test', phone: '08033333333', town: 'Sapele', years: 11, bio: 'Eleven years behind the clippers. Fades, skin fades, hot-towel beard trims.', prices: { Fade: 3500, 'Skin Fade': 4500, 'Hair + Beard': 5500, Styling: 3000 } },
    { name: 'Victor Aghogho', email: 'victor@callnbarb.test', phone: '08033333334', town: 'Ughelli', years: 3, bio: 'Affordable, neat cuts for the whole family.', prices: { Haircut: 2000, 'Kids Haircut': 1500, 'Low Cut': 1500, 'Beard Trim': 1000 } },
  ];

  const svcId = (name: string) => get<any>('SELECT id FROM services WHERE name = ?', name).id as number;
  const barberIds: number[] = [];
  for (const b of barbers) {
    const id = await createUser('barber', b.name, b.email, b.phone, PASS);
    barberIds.push(id);
    const t = findTown(b.town)!;
    run(
      `UPDATE barber_profiles SET bio = ?, experience_years = ?, service_area = ?, address = ?, latitude = ?, longitude = ?, verification_status = 'VERIFIED', verified_at = datetime('now'), submitted_at = datetime('now'),
         id_document = '/api/me/uploads/private/demo-document.pdf', bank_code = '058', bank_name = 'Guaranty Trust Bank (GTBank)', account_number = '0123456789', account_name = ? WHERE user_id = ?`,
      b.bio, b.years, b.town, `${b.town}, Delta State`, t.lat + (Math.random() - 0.5) * 0.02, t.lng + (Math.random() - 0.5) * 0.02, b.name.toUpperCase(), id,
    );
    for (const [name, price] of Object.entries(b.prices)) {
      run('INSERT OR IGNORE INTO barber_services (barber_id, service_id, price_kobo, duration_min) VALUES (?, ?, ?, ?)', id, svcId(name), price * 100, name === 'Hair + Beard' ? 60 : name.includes('Fade') ? 45 : 30);
    }
    for (let d = 1; d <= 6; d++) run('INSERT OR IGNORE INTO availability (barber_id, day_of_week, start_time, end_time, break_start, break_end, active) VALUES (?, ?, ?, ?, ?, ?, 1)', id, d, '09:00', '19:00', '13:00', '14:00');
    run('UPDATE barber_profiles SET slot_minutes = 30 WHERE user_id = ?', id);
  }

  // Example completed bookings, reviews and wallet credits (clearly demo data).
  if (!get('SELECT 1 FROM bookings LIMIT 1')) {
    const today = lagosNow().date;
    const comments = ['Great fade, arrived on time!', 'Very professional and clean.', 'Best barber I have used in Delta.', 'Neat job, would book again.'];
    tx(() => {
      barberIds.forEach((barberId, bi) => {
        for (let i = 0; i < 3; i++) {
          const offer = get<any>(`SELECT bs.*, s.name FROM barber_services bs JOIN services s ON s.id = bs.service_id WHERE bs.barber_id = ? ORDER BY bs.id LIMIT 1`, barberId);
          const fees = computeFees(offer.price_kobo, 0, 1000);
          const date = addDays(today, -(i + 2 + bi));
          const cust = i % 2 ? customer : customer2;
          const code = `CNB-DEMO${bi}${i}`;
          const bid = run(
            `INSERT INTO bookings (code, customer_id, barber_id, service_id, service_name, address_text, address_city, booking_date, start_time, end_time, duration_min,
               service_price_kobo, customer_fee_kobo, amount_kobo, commission_bps, platform_fee_kobo, barber_earning_kobo, status, completed_at)
             VALUES (?, ?, ?, ?, ?, '12 Demo Street', ?, ?, '10:00', '10:30', ?, ?, 0, ?, 1000, ?, ?, 'COMPLETED', datetime('now', ?))`,
            code, cust, barberId, offer.service_id, offer.name, barbers[bi].town, date, offer.duration_min, fees.servicePriceKobo, fees.amountKobo, fees.platformFeeKobo, fees.barberEarningKobo, `-${i + 2} days`,
          ).id;
          run(`INSERT INTO payments (booking_id, customer_id, amount_kobo, currency, provider, reference, status, verified, verified_at) VALUES (?, ?, ?, 'NGN', 'demo', ?, 'SUCCESSFUL', 1, datetime('now'))`, bid, cust, fees.amountKobo, `DEMO-${code}`);
          run('INSERT INTO booking_events (booking_id, from_status, to_status, actor_role, note) VALUES (?, NULL, ?, ?, ?)', bid, 'COMPLETED', 'system', 'Demo seed data');
          creditCompletedBooking(get<any>('SELECT * FROM bookings WHERE id = ?', bid));
          run('INSERT INTO reviews (booking_id, customer_id, barber_id, rating, comment) VALUES (?, ?, ?, ?, ?)', bid, cust, barberId, 4 + ((i + bi) % 2), comments[(i + bi) % comments.length]);
        }
        refreshRating(barberId);
      });
    });
  }

  // A sample customer address inside Delta State
  if (!get('SELECT 1 FROM addresses WHERE user_id = ?', customer)) {
    const a = findTown('Asaba')!;
    run(`INSERT INTO addresses (user_id, label, address, city, state, landmark, latitude, longitude) VALUES (?, 'Home', '24 Nnebisi Road', 'Asaba', 'Delta', 'Near Asaba Mall', ?, ?)`, customer, a.lat, a.lng);
  }

  console.log('Demo data ready (DEVELOPMENT ONLY — never run in production).');
  console.log('  admin    : ' + (config.adminEmail || 'admin@callnbarb.test') + ' / ' + (config.adminPassword || PASS));
  console.log(`  customer : customer@callnbarb.test / ${PASS}`);
  console.log(`  barber   : tunde@callnbarb.test / ${PASS}  (also emeka@, samuel@, victor@ callnbarb.test)`);
  console.log(`  users in db: ${all('SELECT id FROM users').length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
