// Payment step shared by the booking wizard and the "Pay now" screen.
// The client never decides that a payment worked: it asks the server, which asks the provider.
import { api } from '../api.js';
import { h, icon, naira, fmtDate, fmtTime, kv, banner, asyncButton, mount, errorBox, spinnerBlock, toast } from '../ui.js';
import { router } from '../router.js';
import { state } from '../state.js';

/** Live "hold expires in mm:ss" line. Calls onExpire once when it reaches zero. */
export function holdTimer(ctx, expiresAt, onExpire) {
  const out = h('div', { class: 'banner cust-hold', role: 'timer', 'aria-live': 'off' });
  if (!expiresAt) return out;
  let fired = false;
  const tick = () => {
    const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    mount(out, icon('clock', 20), h('div', null, left ? `We are holding this time for you for ${mm}:${ss}.` : 'The hold on this time has ended.'));
    if (!left && !fired) { fired = true; clearInterval(t); onExpire && onExpire(); }
  };
  const t = setInterval(tick, 1000);
  ctx.onLeave(() => clearInterval(t));
  tick();
  return out;
}

export function summaryRows(b) {
  const loc = b.location || {};
  return h('div', null,
    kv('Barber', b.barber ? b.barber.name : ''),
    kv('Service', b.serviceName),
    kv('Date', fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' })),
    kv('Time', `${fmtTime(b.startTime)} to ${fmtTime(b.endTime)}`),
    kv('Location', [loc.address, loc.city].filter(Boolean).join(', ')),
    h('hr', { class: 'divider' }),
    kv('Service price', naira(b.servicePriceKobo)),
    b.customerFeeKobo ? kv('CallNBarb fee', naira(b.customerFeeKobo)) : null,
    kv('Total', naira(b.amountKobo), 'total'));
}

/**
 * Starts payment for `booking`. onPaid(bookingId) runs only after the server confirms SUCCESSFUL.
 * Returns a Node that manages its own states (starting, checkout, checking, failed).
 */
export function checkoutView(ctx, booking, { onPaid, onExpired } = {}) {
  const host = h('div', { class: 'stack', 'aria-live': 'polite' });
  let alive = true;
  ctx.onLeave(() => { alive = false; });
  const demo = () => state.meta.paymentMode === 'demo';

  async function start() {
    mount(host, spinnerBlock('Getting payment ready'));
    let init;
    try { init = await api('/payments/initialize', { method: 'POST', body: { bookingId: booking.id } }); }
    catch (e) {
      if (!alive) return;
      if (e.code === 'HOLD_EXPIRED') { onExpired && onExpired(); return; }
      mount(host, errorBox(e.message, start)); return;
    }
    if (alive) show(init);
  }

  async function settle(reference, outcomeCall) {
    try {
      const r = outcomeCall ? await outcomeCall() : await api('/payments/verify', { method: 'POST', body: { reference } });
      if (r.status === 'SUCCESSFUL') return onPaid(r.bookingId);
      if (r.status === 'FAILED') return failed();
      toast('We have not received your payment yet. If you have paid, wait a moment and try again.');
    } catch (e) { toast(e.message, 'error'); }
  }

  function failed() {
    mount(host, h('div', { class: 'card stack cust-center' },
      h('div', { class: 'empty-ill', style: { background: 'var(--red-bg)', color: 'var(--red)' } }, icon('alert', 34)),
      h('h2', null, 'Payment could not be completed'),
      h('p', { class: 'muted' }, 'Payment could not be completed. Please try again. You have not been charged.'),
      h('button', { class: 'btn red block', type: 'button', onclick: start }, 'Try again')));
  }

  function show(init) {
    const pay = demo()
      ? [
          banner('Demo checkout. This is a practice payment: no real money moves.', 'info', 'info'),
          asyncButton(`Pay ${naira(init.amountKobo)}`, () => settle(init.reference, () => api('/payments/demo/pay', { method: 'POST', body: { reference: init.reference, outcome: 'success' } })), { cls: 'btn red block cust-paybtn', icon: 'lock' }),
          h('button', { class: 'btn ghost block', type: 'button', onclick: () => settle(init.reference, () => api('/payments/demo/pay', { method: 'POST', body: { reference: init.reference, outcome: 'failed' } })) }, 'Simulate a failed payment'),
        ]
      : [
          h('a', { class: 'btn red block cust-paybtn', href: init.authorizationUrl, target: '_blank', rel: 'noopener' }, icon('lock', 20), `Pay ${naira(init.amountKobo)} with Paystack`),
          asyncButton('I have paid', () => settle(init.reference), { cls: 'btn ghost block' }),
        ];
    mount(host, h('div', { class: 'card stack cust-checkout' },
      h('div', { class: 'row between' }, h('div', { class: 'bold' }, 'CallNBarb'), h('span', { class: 'chip' }, demo() ? 'Demo' : 'Paystack')),
      h('div', { class: 'cust-center' }, h('div', { class: 'muted small' }, 'You pay'), h('div', { class: 'money big' }, naira(init.amountKobo))),
      kv('Reference', init.reference),
      kv('For', `${booking.serviceName}, ${fmtDate(booking.date)} at ${fmtTime(booking.startTime)}`),
      ...pay,
      h('p', { class: 'muted xs cust-center' }, 'Your money is held safely and released to the barber only after your appointment QR code is scanned.')));
  }

  start();
  return host;
}

/** "Booking confirmed!" screen. `b` is a booking view from the API. */
export function confirmedView(b) {
  return h('div', { class: 'stack' },
    h('div', { class: 'cust-center stack' },
      h('div', { class: 'success-mark' }, icon('check', 44)),
      h('h1', null, 'Booking confirmed!'),
      h('p', { class: 'muted' }, 'Your payment was received. We have asked your barber to accept. You will get a notification when they do.')),
    h('div', { class: 'card' }, summaryRows(b), kv('Booking ID', b.code), kv('Amount paid', naira(b.amountKobo))),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn red', href: '#/qr/' + b.id }, icon('qr', 20), 'Show QR code'),
      h('a', { class: 'btn ghost', href: '#/booking/' + b.id }, 'View booking')));
}

/** Route: resume payment for an unpaid booking. */
export default async function payPage(ctx) {
  const { booking } = await api('/bookings/' + ctx.params.id);
  if (booking.status !== 'PENDING_PAYMENT') { router.navigate('/booking/' + booking.id, { replace: true }); return h('div'); }
  const host = h('div', { class: 'stack' });
  const toConfirmed = async () => { const r = await api('/bookings/' + booking.id); mount(host, confirmedView(r.booking)); window.scrollTo(0, 0); };
  mount(host,
    h('h1', null, 'Complete payment'),
    holdTimer(ctx, booking.holdExpiresAt, () => mount(host, errorBox('The hold on this time has ended. Please book again.', () => router.navigate('/book/' + booking.barber.id)))),
    h('div', { class: 'card' }, summaryRows(booking)),
    checkoutView(ctx, booking, { onPaid: toConfirmed, onExpired: () => router.navigate('/book/' + booking.barber.id) }));
  return host;
}
