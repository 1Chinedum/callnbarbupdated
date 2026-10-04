import { api, uploadFile } from '../api.js';
import { h, icon, naira, fmtDate, fmtTime, fmtDateTime, mount, avatar, statusChip, kv, banner, empty, errorBox, skeletonList, skeleton, asyncButton, promptDialog, confirmDialog, sheet, field, select, toast, formError } from '../ui.js';
import { router } from '../router.js';
import { state } from '../state.js';
import { qrImage } from '../qr.js';
import { mapBox, createMap, addMarker } from '../maps.js';
import { bookingWhen, LIVE_STATUSES } from './common.js';

const GROUPS = [['upcoming', 'Upcoming', 'No upcoming appointments.'], ['active', 'Active', 'No active appointments.'], ['completed', 'Completed', 'No completed appointments yet.'], ['cancelled', 'Cancelled', 'No cancelled appointments.']];

function bookingCard(b) {
  const showQr = ['BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED'].includes(b.status);
  return h('article', { class: 'card cust-bk' },
    h('a', { class: 'cust-bk-top', href: '#/booking/' + b.id, 'aria-label': `${b.serviceName} with ${b.barber ? b.barber.name : 'barber'}, ${bookingWhen(b)}` },
      avatar(b.barber || {}, 'sm'),
      h('div', { class: 'grow' }, h('div', { class: 'bold' }, b.serviceName), h('div', { class: 'muted small' }, (b.barber ? b.barber.name : '') + ' · ' + bookingWhen(b))),
      statusChip(b.status)),
    h('div', { class: 'row between' }, h('span', { class: 'bold' }, naira(b.amountKobo)),
      h('div', { class: 'row', style: { gap: '8px' } },
        b.status === 'PENDING_PAYMENT' && (!b.holdExpiresAt || b.holdExpiresAt > Date.now()) ? h('a', { class: 'btn sm red', href: '#/pay/' + b.id }, 'Pay now') : null,
        showQr ? h('a', { class: 'btn sm ghost', href: '#/qr/' + b.id }, icon('qr', 18), 'QR') : null,
        b.status === 'COMPLETED' && !b.reviewed ? h('a', { class: 'btn sm soft', href: '#/booking/' + b.id }, 'Review') : null)));
}

export function bookingsPage(ctx) {
  let group = GROUPS.some((g) => g[0] === ctx.query.group) ? ctx.query.group : 'upcoming';
  let alive = true; ctx.onLeave(() => { alive = false; });
  const seg = h('div', { class: 'seg cust-seg', role: 'group', 'aria-label': 'Booking groups' });
  const list = h('div', { class: 'stack', 'aria-live': 'polite' });
  const drawSeg = () => mount(seg, GROUPS.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': group === k, onclick: () => { group = k; drawSeg(); load(); } }, t)));
  async function load() {
    const g = group; mount(list, skeletonList(3));
    try {
      const r = await api('/bookings', { query: { group: g } });
      if (!alive || g !== group) return;
      mount(list, r.bookings.length ? r.bookings.map(bookingCard) : empty(GROUPS.find((x) => x[0] === g)[2], g === 'upcoming' ? 'Find a barber and book your first cut.' : '', h('a', { class: 'btn red', href: '#/explore' }, 'Find a barber'), 'calendar'));
    } catch (e) { if (alive && g === group) mount(list, errorBox(e.message, load)); }
  }
  drawSeg(); load();
  return h('div', { class: 'stack' }, h('div', { class: 'page-title' }, h('h1', null, 'My bookings')), seg, list);
}

const TRACK = [['BARBER_PENDING', 'Waiting for barber'], ['ACCEPTED', 'Accepted'], ['ON_THE_WAY', 'On the way'], ['ARRIVED', 'Arrived'], ['COMPLETED', 'Done']];
const EVENT_LABEL = { PENDING_PAYMENT: 'Booking created', CONFIRMED: 'Payment received', BARBER_PENDING: 'Waiting for the barber', ACCEPTED: 'Barber accepted', ON_THE_WAY: 'Barber is on the way', ARRIVED: 'Barber arrived', VERIFIED: 'QR code verified', IN_PROGRESS: 'Service in progress', COMPLETED: 'Service completed', CANCELLED: 'Cancelled', DISPUTED: 'Problem reported', REFUNDED: 'Refunded' };

function tracker(status) {
  const at = ['VERIFIED', 'IN_PROGRESS'].includes(status) ? 3 : TRACK.findIndex((t) => t[0] === status);
  return h('div', null,
    h('div', { class: 'steps' }, TRACK.map((_, i) => h('i', { class: status === 'COMPLETED' || i < at ? 'done' : i === at ? 'now' : '' }))),
    h('div', { class: 'steps-labels' }, TRACK.map((t) => h('span', null, t[1]))));
}

function cancelFlow(b, done) {
  const r = state.meta.rules;
  const paid = b.status !== 'PENDING_PAYMENT';
  const rule = !paid ? 'You have not paid yet, so nothing will be charged.'
    : b.status === 'BARBER_PENDING' ? 'The barber has not accepted yet, so you will get a full refund.'
    : `Cancel more than ${r.cancelFreeHours} hours before your appointment for a full refund. Later cancellations get ${r.lateCancelRefundPercent}% back.`;
  return async () => {
    const ok = await confirmDialog('Cancel this booking?', rule, { confirmLabel: 'Continue', danger: true });
    if (!ok) return;
    const reason = await promptDialog('Why are you cancelling?', 'Reason', { confirmLabel: 'Cancel booking', placeholder: 'For example: I need to change the time' });
    if (!reason) return;
    await api(`/bookings/${b.id}/cancel`, { method: 'POST', body: { reason } });
    toast('Booking cancelled.', 'success'); done();
  };
}

function disputeSheet(b, done) {
  sheet('Report a problem', (close) => {
    const reason = select(['Barber did not arrive', 'Poor service quality', 'Wrong price charged', 'Safety concern', 'Other'].map((x) => [x, x]));
    const desc = h('textarea', { class: 'input', placeholder: 'Tell us what happened (at least 10 characters)' });
    let evidence = null; const lbl = h('span', { class: 'muted small' }, 'No photo added');
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'cust-ev', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { lbl.textContent = 'Uploading…'; evidence = (await uploadFile(f, 'evidence')).url; lbl.textContent = 'Photo added: ' + f.name; } catch (er) { evidence = null; lbl.textContent = er.message; } } });
    const err = h('div');
    const send = asyncButton('Send report', async () => {
      mount(err);
      if (desc.value.trim().length < 10) { mount(err, formError('Please describe the problem in at least 10 characters.')); return; }
      try { await api(`/bookings/${b.id}/dispute`, { method: 'POST', body: { reason: reason.value, description: desc.value.trim(), evidence: evidence || undefined } }); }
      catch (e) { mount(err, formError(e.message)); return; }
      close(); toast('Report sent. Our team will review it.', 'success'); done();
    }, { cls: 'btn red block' });
    return h('div', { class: 'stack' }, banner('Reporting a problem pauses this booking while our team looks into it.', '', 'info'), field('What went wrong?', reason), field('Details', desc),
      h('div', { class: 'row' }, h('label', { class: 'btn sm ghost', for: 'cust-ev' }, icon('camera', 18), 'Add a photo (optional)'), lbl), file, err, send);
  });
}

function reviewForm(b, done) {
  let rating = 0; const comment = h('textarea', { class: 'input', placeholder: 'How was your haircut? (optional)', maxlength: 500 });
  const starRow = h('div', { class: 'cust-starpick', role: 'radiogroup', 'aria-label': 'Rating' });
  const draw = () => mount(starRow, [1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', role: 'radio', 'aria-checked': rating === n, 'aria-label': `${n} star${n > 1 ? 's' : ''}`, class: n <= rating ? 'on' : '', onclick: () => { rating = n; draw(); } }, '★')));
  draw();
  const err = h('div');
  return h('div', { class: 'card stack' }, h('h2', null, 'How did it go?'), starRow, comment, err,
    asyncButton('Submit review', async () => {
      mount(err); if (!rating) { mount(err, formError('Tap a star rating first.')); return; }
      try { await api(`/bookings/${b.id}/review`, { method: 'POST', body: { rating, comment: comment.value.trim() } }); } catch (e) { mount(err, formError(e.message)); return; }
      toast('Thanks for your review!', 'success'); done();
    }, { cls: 'btn red block' }));
}

export function bookingDetail(ctx) {
  const id = ctx.params.id;
  const root = h('div', { class: 'stack' }, skeleton(4), skeleton(4));
  let alive = true, timer = null, map = null, last = '';
  const stop = () => { if (map) { try { map.remove(); } catch {} map = null; } };
  ctx.onLeave(() => { alive = false; clearInterval(timer); stop(); });

  async function load(silent) {
    try {
      const r = await api('/bookings/' + id);
      if (!alive) return;
      const sig = JSON.stringify(r);
      if (sig !== last) { last = sig; render(r); }
    } catch (e) { if (alive && !silent) mount(root, errorBox(e.message, () => load())); }
  }

  function render({ booking: b, events }) {
    stop(); ctx.setTitle(b.code);
    const reload = () => { last = ''; load(); };
    const loc = b.location || {};
    const box = loc.latitude != null ? mapBox() : null;
    if (box) requestAnimationFrame(() => setTimeout(() => { if (!box.isConnected) return; map = createMap(box, { center: [loc.latitude, loc.longitude], zoom: 15 }); addMarker(map, loc.latitude, loc.longitude, { label: 'Your location' }); }, 30));
    const live = LIVE_STATUSES.includes(b.status);
    const actions = [];
    if (b.status === 'PENDING_PAYMENT' && (!b.holdExpiresAt || b.holdExpiresAt > Date.now())) actions.push(h('a', { class: 'btn red block', href: '#/pay/' + b.id }, icon('lock', 20), `Pay ${naira(b.amountKobo)} now`));
    if (b.status === 'PENDING_PAYMENT' && b.holdExpiresAt && b.holdExpiresAt <= Date.now()) actions.push(banner('The hold on this time has ended. Book again to get a new time.', 'amber', 'clock'), h('a', { class: 'btn block', href: '#/book/' + b.barber.id }, 'Book again'));
    if (['BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'VERIFIED', 'IN_PROGRESS'].includes(b.status)) actions.push(h('a', { class: 'btn red block', href: '#/qr/' + b.id }, icon('qr', 22), 'Show QR code'));
    const second = [];
    if (['PENDING_PAYMENT', 'BARBER_PENDING', 'ACCEPTED'].includes(b.status)) second.push(asyncButton('Cancel booking', cancelFlow(b, reload), { cls: 'btn sm danger' }));
    if (['BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'COMPLETED'].includes(b.status)) second.push(h('button', { class: 'btn sm ghost', type: 'button', onclick: () => disputeSheet(b, reload) }, icon('alert', 18), 'Report a problem'));
    mount(root,
      h('div', { class: 'card stack' },
        h('div', { class: 'row' }, avatar(b.barber || {}), h('div', { class: 'grow' }, h('a', { class: 'bold', href: '#/barber/' + (b.barber ? b.barber.id : '') }, b.barber ? b.barber.name : 'Barber'), h('div', { class: 'muted small' }, 'Booking ' + b.code)), statusChip(b.status)),
        live && b.status !== 'PENDING_PAYMENT' ? tracker(b.status) : null,
        b.status === 'COMPLETED' ? banner('Service completed. Thanks for using CallNBarb.', 'green', 'check') : null,
        ['CANCELLED', 'REFUNDED'].includes(b.status) ? banner('Cancelled' + (b.cancelReason ? ': ' + b.cancelReason : '.'), 'red', 'x') : null,
        b.status === 'DISPUTED' ? banner('A problem was reported. Our team is reviewing it.', 'red', 'alert') : null,
        b.barber && b.barber.phone ? h('a', { class: 'btn ghost block', href: 'tel:' + b.barber.phone }, icon('phone', 20), 'Call your barber') : null),
      ...actions,
      h('div', { class: 'card' }, h('h2', { style: { marginBottom: '8px' } }, 'Appointment'), kv('Service', b.serviceName), kv('Date', fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' })), kv('Time', `${fmtTime(b.startTime)} to ${fmtTime(b.endTime)}`),
        kv('Address', [loc.address, loc.city].filter(Boolean).join(', ')), loc.landmark ? kv('Landmark', loc.landmark) : null, loc.instructions ? kv('Notes', loc.instructions) : null,
        h('hr', { class: 'divider' }), kv('Service price', naira(b.servicePriceKobo)), b.customerFeeKobo ? kv('CallNBarb fee', naira(b.customerFeeKobo)) : null, kv('Total', naira(b.amountKobo), 'total'),
        b.payment ? kv('Payment', b.payment.status.charAt(0) + b.payment.status.slice(1).toLowerCase()) : null),
      box,
      b.status === 'COMPLETED' && !b.reviewed ? reviewForm(b, reload) : null,
      second.length ? h('div', { class: 'btn-row' }, second) : null,
      h('section', { class: 'card' }, h('h2', { style: { marginBottom: '12px' } }, 'Booking history'),
        h('ol', { class: 'timeline' }, [...events].reverse().map((e) => h('li', null, h('div', { class: 'bold' }, EVENT_LABEL[e.toStatus] || e.toStatus), h('div', { class: 'muted small' }, fmtDateTime(e.createdAt)), e.note && !['COMPLETED', 'BARBER_PENDING', 'CONFIRMED'].includes(e.toStatus) ? h('div', { class: 'small' }, e.note) : null)))));
  }
  load();
  timer = setInterval(() => { if (!document.hidden && !document.querySelector('.overlay')) load(true); }, 10000);
  return root;
}

export function qrPage(ctx) {
  const id = ctx.params.id;
  const root = h('div', { class: 'stack' }, skeleton(6));
  let alive = true, timer = null, last = '';
  ctx.onLeave(() => { alive = false; clearInterval(timer); });
  async function load(silent) {
    try {
      const r = await api(`/bookings/${id}/qr`);
      if (!alive) return;
      const sig = r.payload + r.status + r.booking.status;
      if (sig === last) return; last = sig;
      draw(r);
    } catch (e) {
      if (!alive) return;
      if (e.code === 'NO_QR') mount(root, empty('QR code not ready yet', 'Your QR code appears as soon as your payment is confirmed.', h('a', { class: 'btn red', href: '#/booking/' + id }, 'View booking'), 'qr'));
      else if (!silent) mount(root, errorBox(e.message, () => load()));
    }
  }
  function draw({ payload, status, booking: b }) {
    ctx.setTitle('Appointment QR');
    const done = b.status === 'COMPLETED';
    const dead = ['CANCELLED', 'REFUNDED'].includes(b.status) || status === 'REVOKED';
    const used = status === 'USED' && !done;
    mount(root,
      h('div', { class: 'ticket' },
        h('div', { class: 'qr-wrap' },
          done ? h('div', { class: 'cust-center stack' }, h('div', { class: 'success-mark' }, icon('check', 44)), h('h2', null, 'Service complete'), h('p', { class: 'muted' }, 'Your barber scanned the code. Thanks for booking with CallNBarb.'))
          : dead ? h('div', { class: 'cust-center stack' }, h('div', { class: 'empty-ill' }, icon('x', 34)), h('h2', null, 'This QR code is no longer valid'), h('p', { class: 'muted' }, 'The booking was cancelled.'))
          : used ? h('div', { class: 'cust-center stack' }, h('div', { class: 'empty-ill' }, icon('check', 34)), h('h2', null, 'QR code already used'), h('p', { class: 'muted' }, 'This code has been scanned.'))
          : h('div', { class: 'cust-center stack' }, qrImage(payload), h('p', { class: 'bold' }, 'Show this QR code to your barber when they arrive.'), h('p', { class: 'muted small' }, 'Only let your barber scan it after your haircut is finished. Scanning confirms the job and pays the barber.'))),
        h('div', { class: 'perf' }),
        h('div', { class: 'info' }, kv('Booking ID', b.code), kv('Barber', b.barber ? b.barber.name : ''), kv('Service', b.serviceName), kv('Date', fmtDate(b.date)), kv('Time', fmtTime(b.startTime)), h('div', { class: 'kv' }, h('span', null, 'Status'), statusChip(b.status)))),
      done && !b.reviewed ? h('a', { class: 'btn red block', href: '#/booking/' + b.id }, 'Rate your barber') : h('a', { class: 'btn ghost block', href: '#/booking/' + b.id }, 'View booking'));
  }
  load();
  timer = setInterval(() => { if (!document.hidden) load(true); }, 5000);
  return root;
}
