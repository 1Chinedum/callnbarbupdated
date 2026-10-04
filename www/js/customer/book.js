// Booking wizard: Service -> Time -> Location -> Payment -> Confirmed.
// Prices, fees and availability always come from the server; the booking is created at the review step.
import { api } from '../api.js';
import { h, icon, naira, fmtDate, fmtTime, mount, avatar, banner, formError, asyncButton, skeleton, empty, toast, errorBox } from '../ui.js';
import { router } from '../router.js';
import { addressForm, goBook } from './common.js';
import { checkoutView, confirmedView, holdTimer, summaryRows } from './pay.js';

const STEPS = ['Service', 'Time', 'Location', 'Payment', 'Confirmed'];

function progress(step) {
  return h('div', { class: 'cust-progress', role: 'group', 'aria-label': `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}` },
    h('div', { class: 'steps' }, STEPS.map((_, i) => h('i', { class: i < step ? 'done' : i === step ? 'now' : '' }))),
    h('div', { class: 'steps-labels' }, STEPS.map((s, i) => h('span', { style: i === step ? { color: 'var(--navy)' } : null }, s))));
}

export default async function bookWizard(ctx) {
  const barberId = Number(ctx.params.barberId);
  const { barber } = await api('/barbers/' + barberId, { auth: false });
  const saved = (await api('/me/addresses')).addresses;
  const S = { service: null, date: null, slot: null, addr: null, booking: null, step: 0, notice: null };
  if (ctx.query.serviceId) S.service = barber.services.find((s) => String(s.serviceId) === ctx.query.serviceId) || null;
  if (S.service) S.step = 1;
  const host = h('div', { class: 'stack' });
  ctx.setTitle('Book ' + barber.name.split(' ')[0]);

  const barberStrip = () => h('div', { class: 'card tight row' }, avatar(barber, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'bold' }, barber.name), h('div', { class: 'muted small' }, barber.serviceArea + ', Delta State')));
  const nav = (back, next) => h('div', { class: 'btn-row cust-wnav' }, back ? h('button', { class: 'btn ghost', type: 'button', onclick: back }, 'Back') : null, next);
  const go = (n) => { S.step = n; draw(); window.scrollTo(0, 0); };

  // Releases a held (unpaid) booking when the customer goes back to change something.
  async function releaseHold() {
    if (!S.booking) return;
    const id = S.booking.id; S.booking = null;
    try { await api(`/bookings/${id}/cancel`, { method: 'POST', body: { reason: 'Changed booking details' } }); } catch {}
  }

  function draw() {
    const frame = [progress(Math.min(S.step, 4)), S.notice ? banner(S.notice, 'red', 'alert') : null];
    S.notice = null;
    const body = [stepService, stepTime, stepLocation, stepReview, stepDone][S.step]();
    mount(host, frame, body);
  }

  // ---- 1. service
  function stepService() {
    if (!barber.services.length) return empty('No services yet', 'This barber has not listed any services.', h('a', { class: 'btn', href: '#/explore' }, 'Find another barber'), 'scissors');
    const list = h('div', { class: 'stack' }, barber.services.map((s) => h('button', { class: 'option', type: 'button', 'aria-pressed': S.service?.serviceId === s.serviceId, onclick: () => { S.service = s; S.date = S.slot = null; draw(); } },
      h('div', { class: 'grow' }, h('div', { class: 'bold' }, s.name), h('div', { class: 'muted small' }, `${s.durationMin} min`)), h('div', { class: 'bold' }, naira(s.priceKobo)))));
    return h('div', { class: 'stack' }, h('h2', null, 'Choose a service'), barberStrip(), list,
      nav(null, h('button', { class: 'btn red', type: 'button', disabled: !S.service, onclick: () => go(1) }, 'Choose a time')));
  }

  // ---- 2. time
  function stepTime() {
    const box = h('div', { class: 'stack' });
    const dates = h('div'); const slots = h('div', { 'aria-live': 'polite' });
    const next = h('button', { class: 'btn red', type: 'button', disabled: !S.slot, onclick: () => go(2) }, 'Confirm location');
    box.append(h('h2', null, 'Pick a date and time'), h('p', { class: 'muted small' }, `${S.service.name}, ${S.service.durationMin} min, ${naira(S.service.priceKobo)}`), dates, slots, nav(() => go(0), next));

    const loadSlots = async (date) => {
      mount(slots, skeleton(3));
      try {
        const r = await api(`/barbers/${barberId}/slots`, { auth: false, query: { date, serviceId: S.service.serviceId } });
        if (S.date !== date) return;
        const open = r.slots.filter((x) => x.available !== false);
        mount(slots, open.length
          ? h('div', { class: 'slot-grid', role: 'group', 'aria-label': 'Available times' }, r.slots.map((sl) => h('button', { class: 'slot', type: 'button', disabled: sl.available === false, 'aria-pressed': S.slot === sl.start, onclick: () => { S.slot = sl.start; next.disabled = false; loadSlots(date); } }, fmtTime(sl.start))))
          : empty('No times left on this day', 'Try another date.', null, 'clock'));
      } catch (e) { mount(slots, errorBox(e.message, () => loadSlots(date))); }
    };
    const pickDate = (d) => { S.date = d; S.slot = null; next.disabled = true; drawDates(); loadSlots(d); };
    let list = [];
    const drawDates = () => mount(dates, list.length
      ? h('div', { class: 'date-strip', role: 'group', 'aria-label': 'Available dates' }, list.map((d) => { const dt = new Date(d + 'T12:00:00'); return h('button', { class: 'date-chip', type: 'button', 'aria-pressed': S.date === d, 'aria-label': fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }), onclick: () => pickDate(d) }, h('small', null, dt.toLocaleDateString('en-NG', { weekday: 'short' })), h('span', { class: 'd' }, dt.getDate()), h('small', null, dt.toLocaleDateString('en-NG', { month: 'short' }))); }))
      : empty('No open dates', 'This barber has no free times in the next few weeks. Try another barber.', h('a', { class: 'btn', href: '#/explore' }, 'Find another barber'), 'calendar'));
    mount(dates, skeleton(1, 70));
    api(`/barbers/${barberId}/dates`, { auth: false, query: { serviceId: S.service.serviceId } }).then((r) => {
      list = r.dates; drawDates();
      if (S.date && list.includes(S.date)) loadSlots(S.date); else if (list.length && !S.date) pickDate(list[0]);
    }).catch((e) => mount(dates, errorBox(e.message, () => draw())));
    return box;
  }

  // ---- 3. location
  function stepLocation() {
    let mode = S.addr?.addressId ? 'saved' : saved.length && !S.addr ? 'saved' : S.addr ? 'new' : 'new';
    let chosen = S.addr?.addressId || (saved[0] && saved[0].id);
    const holder = h('div', { class: 'stack' });
    let form = null;
    const err = h('div');
    const drawMode = () => {
      mount(holder);
      if (mode === 'saved' && saved.length) {
        holder.append(h('div', { class: 'stack' }, saved.map((a) => h('button', { class: 'option', type: 'button', 'aria-pressed': chosen === a.id, onclick: () => { chosen = a.id; drawMode(); } },
          icon('pin', 22), h('div', { class: 'grow' }, h('div', { class: 'bold' }, a.label || 'Saved address'), h('div', { class: 'muted small' }, `${a.address}, ${a.city}`), a.landmark ? h('div', { class: 'muted xs' }, 'Near ' + a.landmark) : null))),
          h('button', { class: 'btn soft block', type: 'button', onclick: () => { mode = 'new'; drawMode(); } }, icon('plus', 20), 'Use a different address')));
      } else {
        form = addressForm({ ctx, showSave: true, showLabel: true, defaultTown: barber.serviceArea, initial: S.addr?.address || {} });
        holder.append(form.node, saved.length ? h('button', { class: 'btn ghost block', type: 'button', onclick: () => { mode = 'saved'; drawMode(); } }, 'Use a saved address') : null);
      }
    };
    drawMode();
    const cont = h('button', { class: 'btn red', type: 'button', onclick: async (e) => {
      mount(err);
      if (mode === 'saved' && saved.length) S.addr = { addressId: chosen };
      else { const a = form.get(); if (!a) return; S.addr = { address: a }; }
      const b = e.currentTarget; b.classList.add('loading');
      try { await createHold(); go(3); } catch (er) { mount(err, formError(er.message)); } finally { b.classList.remove('loading'); }
    } }, 'Review booking');
    return h('div', { class: 'stack' }, h('h2', null, 'Where should the barber come?'),
      h('p', { class: 'muted small' }, 'CallNBarb currently serves Delta State. Your exact address is shared with the barber only after they accept.'),
      holder, err, nav(() => go(1), cont));
  }

  async function createHold() {
    await releaseHold();
    try {
      const body = { barberId, serviceId: S.service.serviceId, date: S.date, startTime: S.slot };
      if (S.addr.addressId) body.addressId = S.addr.addressId; else body.address = S.addr.address;
      S.booking = (await api('/bookings', { method: 'POST', body })).booking;
    } catch (e) {
      if (e.code === 'SLOT_UNAVAILABLE') { S.slot = null; S.notice = 'This time slot is no longer available. Please choose another time.'; go(1); }
      throw e;
    }
  }

  // ---- 4. review + payment (booking is already created and held)
  function stepReview() {
    const b = S.booking;
    if (!b) { S.step = 2; return stepLocation(); }
    const payHost = h('div', { class: 'stack' });
    const startPay = () => mount(payHost, checkoutView(ctx, b, { onPaid: onPaid, onExpired: expired }));
    const expired = () => { S.booking = null; S.slot = null; S.notice = 'The hold on that time ended. Please pick a time again.'; go(1); };
    const onPaid = async () => { const r = await api('/bookings/' + b.id); S.booking = r.booking; S.paid = true; go(4); };
    mount(payHost, h('button', { class: 'btn red block cust-paybtn', type: 'button', onclick: startPay }, icon('lock', 20), `Proceed to payment, ${naira(b.amountKobo)}`),
      h('button', { class: 'btn ghost block', type: 'button', onclick: async () => { await releaseHold(); go(2); } }, 'Change location'),
      h('button', { class: 'btn ghost block', type: 'button', onclick: async () => { await releaseHold(); go(1); } }, 'Change date or time'));
    return h('div', { class: 'stack' }, h('h2', null, 'Review and pay'),
      holdTimer(ctx, b.holdExpiresAt, expired),
      h('div', { class: 'card' }, summaryRows(b)),
      b.location?.landmark ? h('p', { class: 'muted small' }, 'Landmark: ' + b.location.landmark) : null,
      payHost);
  }

  // ---- 5. confirmed
  function stepDone() { return S.booking ? confirmedView(S.booking) : empty('Nothing here', '', h('a', { class: 'btn', href: '#/bookings' }, 'My bookings')); }

  draw();
  return host;
}
