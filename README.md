# CallNBarb: your barber, wherever you are (Delta State, Nigeria)

Three parts in one repo:

| Folder | What it is |
|---|---|
| `backend/` | Node 22 + Express API, SQLite database, QR tokens, wallet ledger, demo/Paystack payments. Also serves the web app. |
| `app/www/` | The app itself (no build step): customer app, barber app (`index.html`) and admin dashboard (`admin.html`). |
| `app/android/` | Android project (Capacitor) wrapping `app/www`. Build the APK from this. |

## 1. Run it on your computer (2 minutes)

Needs Node 22 or newer.

```bash
cd backend
npm install
cp .env.example .env        # keep PAYMENT_MODE=demo for now
npx tsx src/seed.ts         # demo accounts and Delta State barbers
npx tsx src/server.ts       # http://localhost:4000
```

Open http://localhost:4000 (customer/barber app) and http://localhost:4000/admin.html (admin).
All demo passwords are `Demo#1234` (admin: `@Edu2025`):

* Customer `customer@callnbarb.test`
* Barbers `tunde@callnbarb.test` (Asaba), `emeka@callnbarb.test` (Warri), `samuel@callnbarb.test` (Sapele), `victor@callnbarb.test` (Ughelli)
* Admin `10eduaso7@gmail.com`

## 2. How the money flows

1. Customer books and pays (demo checkout now, Paystack later). Money is held by the platform.
2. Barber accepts, travels, taps "I've arrived".
3. After the haircut the **barber scans the customer's QR code** (or pastes its code). The server checks it (single use, right barber, paid, within the time window), completes the job and credits the barber's wallet in one step.
4. Barber requests a withdrawal; admin approves and pays out.

The commission, minimum withdrawal, cancellation rules and QR time window are editable in Admin, Settings.

## 3. Build the Android app (APK)

Needs Android Studio (includes the Android SDK and JDK).

```bash
cd app
npm install
npm run cap:sync            # copies www into the Android project
npm run cap:open            # opens Android Studio; press Run, or Build > Build APK(s)
```

The Android project is already created in `app/android` with camera, location and internet permissions.

**Server address:** the app talks to your backend over the internet. On first launch, open the server screen (link on the login page) and enter your server address. On the Android emulator the default `http://10.0.2.2:4000` reaches the server on your computer. For real phones, host the backend (section 4) and enter that `https://` address.

## 4. Put it online

**Option A, simplest (works today, no code changes):** any host that runs Node or Docker with a *persistent disk*, such as Render, Railway or Fly.io. Use the included `Dockerfile`, mount a volume at `/data`, and set environment variables:

`NODE_ENV=production`, `APP_URL=https://your-domain`, `JWT_SECRET` and `QR_SECRET` (long random strings, e.g. `openssl rand -hex 48`), `PAYMENT_MODE=demo`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Then run once: `npx tsx src/seed.ts --admin-only` to create the admin.

**Option B, Neon:** Neon is a hosted *Postgres database only*; it cannot host this app, and the backend currently uses SQLite. To use Neon, the database layer (`backend/src/db.ts` and the SQL in `services/` and `routes/`) must be ported to Postgres, and the server still needs a host (Option A's providers, without the disk). Do this before real customers, since free-tier disks can be wiped.

## 5. Before real money

* Set `PAYMENT_MODE=paystack` and add your Paystack keys; set the webhook URL to `https://your-domain/api/payments/webhook`. Test with Paystack test keys first.
* Replace the placeholder legal pages (terms, privacy) with real ones.
* Change every demo password; do not seed demo data in production.
* Use HTTPS only; email/SMS/push providers are not connected yet (in-app notifications work).

## 6. Tests

```bash
cd backend && npm test      # backend rules
cd tools && npm install && node e2e-customer.mjs && node e2e-barber.mjs && node e2e-admin.mjs   # browser tests (server must be running)
```
