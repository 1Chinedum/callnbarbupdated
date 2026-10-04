import { inboxPage, supportPage } from '../account.js';
import dashboard from './dashboard.js';
import bookings from './bookings.js';
import booking from './booking.js';
import scan from './scan.js';
import wallet from './wallet.js';
import profile from './profile.js';

export function register(router) {
  const b = ['barber'];
  router.add('/b', dashboard, { roles: b });
  router.add('/b/bookings', bookings, { roles: b });
  router.add('/b/booking/:id', booking, { roles: b, back: true, title: 'Booking', tab: '/b/bookings' });
  router.add('/b/scan', scan, { roles: b });
  router.add('/b/wallet', wallet, { roles: b });
  router.add('/b/profile', profile, { roles: b });
  router.add('/b/notifications', (ctx) => inboxPage(ctx, { bookingPath: '/b/booking/' }), { roles: b, back: true, title: 'Notifications', tab: '/b' });
  router.add('/b/support', (ctx) => supportPage(ctx, { bookingsEndpoint: '/barber/bookings' }), { roles: b, back: true, title: 'Support', tab: '/b/profile' });
}
