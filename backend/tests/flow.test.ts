import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, auth, bookAndPay, dbm, inDays, makeAdmin, makeVerifiedBarber, openScanWindow, qrFor, register } from './helpers.js';

// The full acceptance scenario: customer books and pays, barber accepts, scans the QR,
// the job completes and the barber's wallet is credited; then withdrawal, review, admin views.
test('end-to-end: book → pay → QR scan completes job → barber paid → withdraw → review', async () => {
  const admin = await makeAdmin();
  const barber = await makeVerifiedBarber(admin, { priceKobo: 1_000_000 }); // ₦10,000
  const customer = await register('customer');

  // discovery shows verified barber with DB price
  const list = await api.get('/api/barbers?town=Asaba').expect(200);
  assert.equal(list.body.barbers.length, 1);
  assert.equal(list.body.barbers[0].startingPriceKobo, 1_000_000);
  assert.equal(list.body.barbers[0].verified, true);

  // dates + slots
  const date = inDays(2);
  const slots = await api.get(`/api/barbers/${barber.id}/slots?date=${date}&serviceId=${barber.serviceId}`).expect(200);
  assert.ok(slots.body.slots.length > 0);
  const start = slots.body.slots[0].start;

  const { bookingId, payStatus } = await bookAndPay(customer, barber, date, start);
  assert.equal(payStatus, 'SUCCESSFUL');

  // booking is now awaiting barber; customer can see the QR; barber cannot see customer's address yet
  let b = await api.get(`/api/bookings/${bookingId}`).set(auth(barber.token)).expect(200);
  assert.equal(b.body.booking.status, 'BARBER_PENDING');
  assert.equal(b.body.booking.location.address, undefined);
  const payload = await qrFor(customer, bookingId);
  assert.match(payload, /^CNB1\./);

  // barber must accept before verifying
  openScanWindow();
  const early = await api.post('/api/qr/verify').set(auth(barber.token)).send({ payload });
  assert.equal(early.status, 422);
  assert.equal(early.body.error.code, 'QR_NOT_ACCEPTED');

  await api.post(`/api/bookings/${bookingId}/accept`).set(auth(barber.token)).expect(200);
  b = await api.get(`/api/bookings/${bookingId}`).set(auth(barber.token));
  assert.equal(b.body.booking.location.address, '24 Nnebisi Road'); // now visible
  await api.post(`/api/bookings/${bookingId}/on-the-way`).set(auth(barber.token)).expect(200);
  await api.post(`/api/bookings/${bookingId}/arrived`).set(auth(barber.token)).expect(200);

  // pending wallet shows the held earning; available is still zero
  let w = await api.get('/api/barber/wallet').set(auth(barber.token)).expect(200);
  assert.equal(w.body.wallet.availableKobo, 0);
  assert.equal(w.body.wallet.pendingKobo, 900_000);

  // scan: lookup changes nothing, verify completes + pays
  const look = await api.post('/api/qr/lookup').set(auth(barber.token)).send({ payload }).expect(200);
  assert.equal(look.body.booking.status, 'ARRIVED');
  const ver = await api.post('/api/qr/verify').set(auth(barber.token)).send({ payload }).expect(200);
  assert.equal(ver.body.booking.status, 'COMPLETED');

  // earnings: ₦10,000 − 10% commission = ₦9,000, ledger-backed
  w = await api.get('/api/barber/wallet').set(auth(barber.token));
  assert.equal(w.body.wallet.availableKobo, 900_000);
  assert.equal(w.body.wallet.totalEarningsKobo, 900_000);
  const tx = await api.get('/api/barber/wallet/transactions').set(auth(barber.token));
  const types = tx.body.transactions.map((t: any) => t.type).sort();
  assert.deepEqual(types, ['PLATFORM_FEE', 'SERVICE_EARNING']);
  const last = tx.body.transactions[0];
  assert.equal(last.balanceAfterKobo, 900_000);

  // replay of the same QR must fail, and must not pay twice
  const replay = await api.post('/api/qr/verify').set(auth(barber.token)).send({ payload });
  assert.equal(replay.status, 422);
  w = await api.get('/api/barber/wallet').set(auth(barber.token));
  assert.equal(w.body.wallet.availableKobo, 900_000);

  // withdrawal: below minimum is rejected, valid one holds funds, admin approves + processes
  const low = await api.post('/api/barber/withdrawals').set(auth(barber.token)).send({ amountKobo: 5000 });
  assert.equal(low.status, 400);
  assert.equal(low.body.error.code, 'BELOW_MINIMUM');
  const wd = await api.post('/api/barber/withdrawals').set(auth(barber.token)).send({ amountKobo: 500_000 }).expect(201);
  assert.equal(wd.body.wallet.availableKobo, 400_000);
  const wdId = wd.body.withdrawal.id;
  await api.post(`/api/admin/withdrawals/${wdId}/process`).set(auth(admin.token)).send().expect(409); // must approve first
  await api.post(`/api/admin/withdrawals/${wdId}/approve`).set(auth(admin.token)).send().expect(200);
  const proc = await api.post(`/api/admin/withdrawals/${wdId}/process`).set(auth(admin.token)).send().expect(200);
  assert.equal(proc.body.withdrawal.status, 'SUCCESSFUL');
  w = await api.get('/api/barber/wallet').set(auth(barber.token));
  assert.equal(w.body.wallet.totalWithdrawnKobo, 500_000);

  // review: only once, only when completed
  await api.post(`/api/bookings/${bookingId}/review`).set(auth(customer.token)).send({ rating: 5, comment: 'Great' }).expect(201);
  const dup = await api.post(`/api/bookings/${bookingId}/review`).set(auth(customer.token)).send({ rating: 1 });
  assert.equal(dup.status, 409);
  const prof = await api.get(`/api/barbers/${barber.id}`).expect(200);
  assert.equal(prof.body.barber.rating, 5);
  assert.equal(prof.body.barber.reviews, 1);

  // admin views
  const dash = await api.get('/api/admin/dashboard').set(auth(admin.token)).expect(200);
  assert.equal(dash.body.totals.completedBookings, 1);
  assert.equal(dash.body.totals.platformCommissionKobo, 100_000);
  const logs = await api.get('/api/admin/audit-logs').set(auth(admin.token)).expect(200);
  assert.ok(logs.body.logs.some((l: any) => l.action === 'BARBER_APPROVED'));
  assert.ok(logs.body.logs.some((l: any) => l.action === 'WITHDRAWAL_PROCESSED'));
});

test('wallet ledger balances always reconcile', () => {
  const rows = dbm.all<any>('SELECT wallet_id, amount_kobo, balance_before_kobo, balance_after_kobo FROM wallet_transactions ORDER BY id');
  for (const r of rows) assert.equal(r.balance_before_kobo + r.amount_kobo, r.balance_after_kobo);
  const sums = dbm.all<any>('SELECT w.available_balance_kobo AS bal, COALESCE(SUM(t.amount_kobo),0) AS s FROM wallets w LEFT JOIN wallet_transactions t ON t.wallet_id = w.id GROUP BY w.id');
  for (const s of sums) assert.equal(s.bal, s.s);
});
