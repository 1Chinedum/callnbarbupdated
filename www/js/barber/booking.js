import { api, uploadFile } from '../api.js';
import { h, icon, naira, fmtDateTime, fmtTime, avatar, statusChip, kv, banner, field, input, select, sheet, toast, asyncButton, skeleton } from '../ui.js';
import { mapBox, createMap, addMarker, directionsButton } from '../maps.js';
import { livePage, acceptBooking, rejectBooking, cancelBookingFlow, dayLabel } from './common.js';

const EVENT_LABEL = {
  PENDING_PAYMENT: 'Booking created', CONFIRMED: 'Payment confirmed', BARBER_PENDING: 'Paid and waiting for you', ACCEPTED: 'You accepted',
  ON_THE_WAY: 'You are on the way', ARRIVED: 'You arrived', VERIFIED: 'Customer QR verified', IN_PROGRESS: 'Service in progress', COMPLETED: 'Job completed',
  CANCELLED: 'Cancelled', DISPUTED: 'Problem reported', REFUNDED: 'Refunded',
};
const ACTIVE = ['BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED'];
const STAGES = [['ACCEPTED', 'Accepted'], ['ON_THE_WAY', 'On the way'], ['ARRIVED', 'Arrived'], ['COMPLETED', 'Done']];
const DISPUTABLE = ['BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'COMPLETED'];

function stageBar(status) {
  const idx = status === 'BARBER_PENDING' ? -1 : STAGES.findIndex((s) => s[0] === status);
  const at = ['VERIFIED', 'IN_PROGRESS'].includes(status) ? 3 : idx;
  return h('div', { 'aria-label': 'Progress' },
    h('div', { class: 'steps' }, STAGES.map((_, i) => h('i', { class: i < at || (status === 'COMPLETED') ? 'done' : i === at ? 'now' : '' }))),
    h('div', { class: 'steps-labels' }, STAGES.map((s) => h('span', null, s[1]))));
}

function reportSheet(b, onDone) {
  sheet('Report a problem', (close) => {
    const reason = select([['Customer is not at the location', 'Customer is not at the location'], ['Wrong or unsafe address', 'Wrong or unsafe address'], ['Customer behaviour', 'Customer behaviour'], ['Payment or price problem', 'Payment or price problem'], ['Other', 'Other']], {});
    const desc = h('textarea', { class: 'input', placeholder: 'Tell us what happened (at least 10 characters)' });
    let evidence = null;
    const evLabel = h('span', { class: 'muted small' }, 'No photo added');
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'barb-ev', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { evLabel.textContent = 'Uploading…'; evidence = (await uploadFile(f, 'evidence')).url; evLabel.textContent = 'Photo added: ' + f.name; } catch (er) { evidence = null; evLabel.textContent = er.message; } } });
    const err = h('div', { class: 'form-error hidden', role: 'alert' });
    const send = asyncButton('Send report', async () => {
      err.classList.add('hidden');
      if (desc.value.trim().length < 10) { err.textContent = 'Please describe the problem in at least 10 characters.'; err.classList.remove('hidden'); return; }
      try {
        await api(`/bookings/${b.id}/dispute`, { method: 'POST', body: { reason: reason.value, description: desc.value.trim(), evidence: evidence || undefined } });
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); return; }
      close(); toast('Report sent. Our team will review it.', 'success'); onDone();
    }, { cls: 'btn red block' });
    return h('div', { class: 'stack' }, banner('Reporting a problem pauses this booking while our team reviews it.', '', 'info'),
      field('What went wrong?', reason), field('Details', desc),
      h('div', { class: 'row' }, h('label', { class: 'btn sm ghost', for: 'barb-ev' }, icon('camera', 18), 'Add a photo (optional)'), evLabel), file, err, send);
  });
}

export default function booking(ctx) {
  const id = ctx.params.id;
  let map = null;
  const killMap = () => { if (map) { try { map.remove(); } catch {} map = null; } };
  ctx.onLeave(killMap);
  const page = livePage(ctx, {
    pollMs: 10000, skeleton: h('div', { class: 'stack' }, skeleton(3), skeleton(4), skeleton(3)),
    load: async () => { const r = await api('/bookings/' + id); if (!ACTIVE.includes(r.booking.status)) page.stopPoll?.(); return r; },
    render: ({ booking: b, events }, refresh) => {
      killMap();
      ctx.setTitle(b.code);
      const reload = () => refresh({ silent: 'toast', force: true });
      const loc = b.location || {};
      const unlocked = !!loc.address;
      const hasPin = unlocked && loc.latitude != null && loc.longitude != null;
      const box = hasPin ? mapBox() : null;
      if (box) requestAnimationFrame(() => setTimeout(() => {
        if (!box.isConnected) return;
        map = createMap(box, { center: [loc.latitude, loc.longitude], zoom: 15 });
        addMarker(map, loc.latitude, loc.longitude, { label: b.customer?.name || 'Customer' });
      }, 30));

      const primary = [];
      if (b.status === 'BARBER_PENDING') primary.push(h('div', { class: 'btn-row' },
        asyncButton('Accept', async () => { await acceptBooking(b); await reload(); }, { cls: 'btn', icon: 'check' }),
        asyncButton('Reject', async () => { if (await rejectBooking(b)) await reload(); }, { cls: 'btn danger' })));
      if (b.status === 'ACCEPTED') primary.push(asyncButton("I'm on the way", async () => { await api(`/bookings/${b.id}/on-the-way`, { method: 'POST' }); toast('The customer knows you are coming.', 'success'); await reload(); }, { cls: 'btn block', icon: 'car' }));
      if (b.status === 'ON_THE_WAY') primary.push(asyncButton("I've arrived", async () => { await api(`/bookings/${b.id}/arrived`, { method: 'POST' }); toast('Marked as arrived.', 'success'); await reload(); }, { cls: 'btn block', icon: 'pin' }));
      if (b.status === 'ARRIVED') primary.push(h('div', { class: 'card navy stack barb-scan-cta' },
        h('h3', null, 'Finished the haircut?'),
        h('p', { class: 'muted' }, "Ask the customer to show their QR code, then scan it. Scanning confirms the job is done and pays you straight into your wallet. Only scan when the service is finished."),
        h('a', { class: 'btn red block barb-bigbtn', href: "#/b/scan" }, icon('scan', 24), "Scan customer's QR")));
      if (b.status === 'COMPLETED') primary.push(h('div', { class: 'banner green barb-paid', role: 'status' }, icon('check', 22), h('div', null, h('div', { class: 'bold barb-paid-amt' }, `${naira(b.barberEarningKobo)} added to your wallet`), h('a', { href: '#/b/wallet', class: 'small bold' }, 'View wallet'))));
      if (b.status === 'DISPUTED') primary.push(banner('A problem was reported on this booking. Our team is reviewing it and will contact you.', 'red', 'alert'));
      if (b.status === 'CANCELLED' || b.status === 'REFUNDED') primary.push(banner(`This booking was cancelled${b.cancelReason ? ': ' + b.cancelReason : '.'}`, 'red', 'x'));

      const secondary = [];
      if (['ACCEPTED', 'ON_THE_WAY'].includes(b.status)) secondary.push(asyncButton('Cancel booking', async () => { if (await cancelBookingFlow(b)) await reload(); }, { cls: 'btn sm danger' }));
      if (DISPUTABLE.includes(b.status)) secondary.push(h('button', { class: 'btn sm ghost', type: 'button', onclick: () => reportSheet(b, reload) }, icon('alert', 18), 'Report a problem'));

      return [
        h('div', { class: 'card stack' },
          h('div', { class: 'row' }, avatar(b.customer || {}), h('div', { class: 'grow' }, h('div', { class: 'bold', style: { fontSize: '1.1rem' } }, b.customer?.name || 'Customer'), h('div', { class: 'muted small' }, 'Booking ' + b.code)), statusChip(b.status)),
          h('div', null, kv('Service', b.serviceName), kv('When', `${dayLabel(b.date)}, ${fmtTime(b.startTime)} to ${fmtTime(b.endTime)}`), kv('Duration', `${b.durationMin} min`), kv('Service price', naira(b.servicePriceKobo)),
            h('div', { class: 'kv total barb-earn-row' }, h('span', null, 'You earn'), h('span', { class: 'money barb-green' }, naira(b.barberEarningKobo)))),
          b.status === 'BARBER_PENDING' ? h('p', { class: 'muted small' }, 'You earn is what you are paid after the platform fee. It is confirmed by the server.') : null),
        ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'COMPLETED'].includes(b.status) ? h('div', { class: 'card' }, stageBar(b.status)) : null,
        ...primary,
        unlocked
          ? h('section', { class: 'card stack', 'aria-label': 'Customer location' },
              h('h2', { class: 'barb-h2' }, 'Customer location'),
              h('div', { class: 'row', style: { alignItems: 'flex-start' } }, icon('pin', 22), h('div', { class: 'grow' }, h('div', { class: 'bold' }, loc.address), h('div', { class: 'muted' }, loc.city + ', Delta State'))),
              loc.landmark ? kv('Landmark', loc.landmark) : null,
              loc.instructions ? kv('Instructions', loc.instructions) : null,
              box,
              h('div', { class: 'btn-row' }, directionsButton(loc, 'btn red'),
                b.customer?.phone ? h('a', { class: 'btn ghost', href: 'tel:' + b.customer.phone }, icon('phone', 20), 'Call customer') : null))
          : h('div', { class: 'card stack' }, h('h2', { class: 'barb-h2' }, 'Customer location'),
              banner(b.status === 'BARBER_PENDING' ? `The exact address is shown after you accept. Area: ${loc.city || 'Delta State'}.` : `Area: ${loc.city || 'Delta State'}.`, 'info', 'pin')),
        secondary.length ? h('div', { class: 'btn-row' }, secondary) : null,
        h('section', { class: 'card', 'aria-label': 'Booking history' }, h('h2', { class: 'barb-h2', style: { marginBottom: '12px' } }, 'Booking history'),
          events.length ? h('ol', { class: 'timeline' }, [...events].reverse().map((e) => h('li', null, h('div', { class: 'bold' }, EVENT_LABEL[e.toStatus] || e.toStatus), h('div', { class: 'muted small' }, fmtDateTime(e.createdAt)), e.note && e.toStatus !== 'COMPLETED' ? h('div', { class: 'small' }, e.note) : null))) : h('p', { class: 'muted' }, 'No history yet.')),
      ];
    },
  });
  return page.root;
}
