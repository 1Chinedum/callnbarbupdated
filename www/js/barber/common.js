// Shared helpers for the barber screens.
import { api } from '../api.js';
import { h, icon, naira, fmtDate, fmtTime, avatar, statusChip, errorBox, skeletonList, mount, toast, promptDialog, confirmDialog, todayLagos } from '../ui.js';
import { directionsButton } from '../maps.js';

export const addDaysISO = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function dayLabel(date) {
  const t = todayLagos();
  if (date === t) return 'Today';
  if (date === addDaysISO(t, 1)) return 'Tomorrow';
  if (date === addDaysISO(t, -1)) return 'Yesterday';
  return fmtDate(date);
}
export const whenText = (b) => `${dayLabel(b.date)}, ${fmtTime(b.startTime)}`;

/**
 * A page that loads data, shows a skeleton, re-renders on refresh and optionally polls.
 * render(data, refresh) -> Node(s). Returns { root, refresh }.
 */
export function livePage(ctx, { load, render, pollMs = 0, skeleton, sig }) {
  const sk = () => skeleton || skeletonList(3);
  const root = h('div', { class: 'stack barb-live' }, sk());
  let alive = true, busy = false, loaded = false, last = null, timer = null;
  ctx.onLeave(() => { alive = false; if (timer) clearInterval(timer); });
  const refresh = async ({ silent = false, force = false } = {}) => {
    if (busy) return;
    busy = true;
    try {
      const data = await load();
      if (!alive) return;
      const s = (sig || JSON.stringify)(data);
      if (force || s !== last) { last = s; mount(root, render(data, (o) => refresh(o))); }
      loaded = true;
    } catch (e) {
      if (!alive) return;
      if (!silent || !loaded) mount(root, errorBox(e.message, () => { mount(root, sk()); refresh(); }));
      else if (silent === 'toast') toast(e.message, 'error');
    } finally { busy = false; }
  };
  refresh();
  if (pollMs) timer = setInterval(() => { if (!document.hidden && !document.querySelector('.overlay')) refresh({ silent: true }); }, pollMs);
  return { root, refresh };
}

export async function acceptBooking(b) {
  await api(`/bookings/${b.id}/accept`, { method: 'POST' });
  toast('Booking accepted. The customer location is now unlocked.', 'success');
  return true;
}
export async function rejectBooking(b) {
  const reason = await promptDialog('Reject this request?', 'Reason for the customer', { confirmLabel: 'Reject request', placeholder: 'For example: I am not available at that time' });
  if (!reason) return false;
  await api(`/bookings/${b.id}/reject`, { method: 'POST', body: { reason } });
  toast('Request rejected. The customer will be refunded.');
  return true;
}
export async function cancelBookingFlow(b) {
  const reason = await promptDialog('Cancel this booking?', 'Reason for the customer', { confirmLabel: 'Cancel booking', placeholder: 'Tell the customer what happened' });
  if (!reason) return false;
  await api(`/bookings/${b.id}/cancel`, { method: 'POST', body: { reason } });
  toast('Booking cancelled. The customer will be refunded.');
  return true;
}
export { confirmDialog };

/** Small button that runs an async action and then calls done(). Errors become toasts. */
export function actionBtn(label, fn, { cls = 'btn sm', ico, done } = {}) {
  const b = h('button', { class: cls, type: 'button' }, ico ? icon(ico, 18) : null, label);
  b.addEventListener('click', async () => {
    if (b.classList.contains('loading')) return;
    b.classList.add('loading');
    try { const ok = await fn(); if (ok !== false && done) await done(); }
    catch (e) { toast(e.message || 'Something went wrong.', 'error'); }
    finally { b.classList.remove('loading'); }
  });
  return b;
}

const NAVIGABLE = ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'];
/** Appointment card used on the dashboard and the bookings list. */
export function apptCard(b, { onChange } = {}) {
  const loc = b.location || {};
  const link = '#/b/booking/' + b.id;
  const actions = [];
  if (b.status === 'BARBER_PENDING') {
    actions.push(actionBtn('Accept', () => acceptBooking(b), { cls: 'btn sm', ico: 'check', done: onChange }));
    actions.push(actionBtn('Reject', () => rejectBooking(b), { cls: 'btn sm danger', done: onChange }));
  }
  if (NAVIGABLE.includes(b.status) && (loc.address || loc.latitude != null)) actions.push(directionsButton(loc, 'btn sm ghost'));
  if (b.status === 'ARRIVED') actions.push(h('a', { class: 'btn sm red', href: '#/b/scan' }, icon('scan', 18), 'Scan QR'));
  actions.push(h('a', { class: 'btn sm soft', href: link }, 'View details'));
  const done = b.status === 'COMPLETED';
  return h('article', { class: 'card barb-appt' },
    h('a', { class: 'barb-appt-top', href: link, 'aria-label': `${b.customer?.name || 'Customer'}, ${b.serviceName}, ${whenText(b)}` },
      avatar(b.customer || {}, 'sm'),
      h('div', { class: 'grow' }, h('div', { class: 'bold barb-ellipsis' }, b.customer?.name || 'Customer'), h('div', { class: 'muted small barb-ellipsis' }, b.serviceName)),
      statusChip(b.status)),
    h('div', { class: 'barb-meta' },
      h('span', null, icon('clock', 16), whenText(b)),
      h('span', null, icon('pin', 16), loc.city || 'Delta State'),
      h('span', { class: 'barb-earn' + (done ? ' done' : '') }, icon('money', 16), done ? 'Earned ' : 'You earn ', naira(b.barberEarningKobo)),
      h('span', { class: 'muted' }, 'Price ' + naira(b.servicePriceKobo))),
    h('div', { class: 'barb-actions' }, actions));
}

export const pageHead = (title, right) => h('div', { class: 'row between' }, h('h1', { class: 'barb-h1' }, title), right || null);
