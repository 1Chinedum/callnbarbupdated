import { router as _r } from '../router.js';
import { inboxPage, supportPage } from '../account.js';
import home from './home.js';
import explore from './explore.js';
import barberProfile from './barber.js';
import book from './book.js';
import payPage from './pay.js';
import { bookingsPage, bookingDetail, qrPage } from './bookings.js';
import profile from './profile.js';

export function register(router) {
  const c = ['customer'];
  router.add('/', home, { roles: c });
  router.add('/explore', explore, { roles: c });
  router.add('/barber/:id', barberProfile, { roles: c, back: true, title: 'Barber', tab: '/explore' });
  router.add('/book/:barberId', book, { roles: c, back: true, tabs: false, title: 'Book a barber', tab: '/explore' });
  router.add('/pay/:id', payPage, { roles: c, back: true, tabs: false, title: 'Payment', tab: '/bookings' });
  router.add('/bookings', bookingsPage, { roles: c });
  router.add('/booking/:id', bookingDetail, { roles: c, back: '/bookings', title: 'Booking', tab: '/bookings' });
  router.add('/qr/:id', qrPage, { roles: c, back: true, title: 'Appointment QR', tab: '/bookings' });
  router.add('/support', (ctx) => supportPage(ctx, { bookingsEndpoint: '/bookings' }), { roles: c });
  router.add('/profile', profile, { roles: c });
  router.add('/notifications', (ctx) => inboxPage(ctx, { bookingPath: '/booking/' }), { roles: c, back: true, title: 'Notifications', tab: '/profile' });
}
