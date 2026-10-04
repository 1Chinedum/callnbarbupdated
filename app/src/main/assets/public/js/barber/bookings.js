import { api } from '../api.js';
import { h, mount, empty, errorBox, skeletonList } from '../ui.js';
import { apptCard, pageHead } from './common.js';

const GROUPS = [
  ['upcoming', 'Upcoming', 'No upcoming bookings', 'Paid bookings waiting for you or already accepted will show here.'],
  ['active', 'Active', 'No active jobs', 'When you are on the way or have arrived, the job shows here.'],
  ['completed', 'Completed', 'No completed jobs yet', 'Finished jobs and what you earned will show here.'],
  ['cancelled', 'Cancelled', 'No cancelled bookings', 'Cancelled and refunded bookings show here.'],
];

export default function bookings(ctx) {
  let group = ctx.query.group && GROUPS.some((g) => g[0] === ctx.query.group) ? ctx.query.group : 'upcoming';
  let alive = true;
  ctx.onLeave(() => { alive = false; });
  const seg = h('div', { class: 'seg barb-seg', role: 'group', 'aria-label': 'Booking groups' });
  const list = h('div', { class: 'stack', 'aria-live': 'polite' });
  const drawSeg = () => mount(seg, GROUPS.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': group === k, onclick: () => { group = k; drawSeg(); load(); } }, t)));
  async function load() {
    const g = group;
    mount(list, skeletonList(3));
    try {
      const r = await api('/barber/bookings', { query: { group: g } });
      if (!alive || g !== group) return;
      const meta = GROUPS.find((x) => x[0] === g);
      mount(list, r.bookings.length ? r.bookings.map((b) => apptCard(b, { onChange: load })) : empty(meta[2], meta[3], g === 'upcoming' ? h('a', { class: 'btn soft', href: '#/b/profile' }, 'Check my services and hours') : null, 'calendar'));
    } catch (e) { if (alive && g === group) mount(list, errorBox(e.message, load)); }
  }
  drawSeg(); load();
  return h('div', { class: 'stack' }, pageHead('Bookings'), seg, list);
}
