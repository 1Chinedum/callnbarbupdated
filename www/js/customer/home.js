import { api } from '../api.js';
import { h, icon, input, mount, statusChip, naira, empty, skeleton } from '../ui.js';
import { router } from '../router.js';
import { getTown, townInfo, onStateChange } from '../state.js';
import { barberCard, barberSkeletons, loadInto, sectionHead, serviceIcon, bookingWhen } from './common.js';

function upcomingCard(b) {
  const live = ['ON_THE_WAY', 'ARRIVED', 'VERIFIED', 'IN_PROGRESS'].includes(b.status);
  return h('a', { class: 'card cust-upnext', href: '#/booking/' + b.id },
    h('div', { class: 'row between' }, h('span', { class: 'cust-kicker' }, live ? 'Happening now' : 'Your next appointment'), statusChip(b.status)),
    h('div', { class: 'bold cust-up-title' }, `${b.serviceName} with ${b.barber ? b.barber.name : 'your barber'}`),
    h('div', { class: 'row between' }, h('span', { class: 'muted' }, bookingWhen(b)), h('span', { class: 'row bold', style: { gap: '2px', color: 'var(--navy)' } }, 'View', icon('chevR', 18))));
}

export default async function home(ctx) {
  const town = () => getTown();
  const q = input({ type: 'search', placeholder: 'Barber, service or town', 'aria-label': 'Search barbers, services or location', enterkeyhint: 'search' });
  const go = (e) => { e && e.preventDefault(); router.navigate('/explore' + (q.value.trim() ? '?q=' + encodeURIComponent(q.value.trim()) : '')); };

  const upHost = h('div');
  const catHost = h('div');
  const nearHost = h('div');
  const nearTitle = h('h2', null);

  api('/bookings', { query: { group: 'active' } }).then(async (a) => {
    const u = await api('/bookings', { query: { group: 'upcoming' } });
    const all = [...a.bookings, ...u.bookings].sort((x, y) => (x.date + x.startTime).localeCompare(y.date + y.startTime));
    const pick = all.find((b) => b.status !== 'PENDING_PAYMENT') || all[0];
    if (pick) mount(upHost, upcomingCard(pick));
  }).catch(() => {});

  loadInto(catHost, () => api('/services', { auth: false }), (r) => h('div', { class: 'cat-grid' },
    r.services.map((s) => h('button', { class: 'cat', type: 'button', onclick: () => router.navigate('/explore?serviceId=' + s.id) },
      h('span', { class: 'ico' }, icon(serviceIcon(s.name), 24)), s.name))),
    () => h('div', { class: 'cat-grid' }, Array.from({ length: 5 }, () => h('div', { class: 'skeleton', style: { height: '78px' } }))));

  let shownTown = null;
  const loadNear = () => {
    shownTown = town();
    const t = townInfo(shownTown);
    mount(nearTitle, 'Barbers near ' + shownTown);
    loadInto(nearHost, () => api('/barbers', { auth: false, query: { town: shownTown, lat: t && t.lat, lng: t && t.lng, sort: 'recommended' } }),
      (r) => r.barbers.length
        ? h('div', { class: 'stack' }, r.barbers.slice(0, 6).map(barberCard), r.total > 6 ? h('a', { class: 'btn ghost block', href: '#/explore' }, 'See all barbers') : null)
        : empty('No barbers in ' + shownTown + ' yet', 'Try another town or browse all of Delta State.', h('a', { class: 'btn', href: '#/explore' }, 'Browse all barbers'), 'scissors'));
  };
  loadNear();
  const off = onStateChange(() => { if (town() !== shownTown) loadNear(); });
  ctx.onLeave(off);

  return h('div', { class: 'stack' },
    h('section', { class: 'hero' },
      h('h1', null, 'Fresh cut. Right at your doorstep.'),
      h('p', null, 'Book a professional barber and get your haircut wherever you are.'),
      h('form', { class: 'hero-search', role: 'search', onsubmit: go }, q, h('button', { class: 'btn red', type: 'submit', 'aria-label': 'Search' }, icon('search', 22))),
      h('a', { class: 'btn red cust-hero-cta', href: '#/explore' }, 'Find a barber'),
      h('div', { class: 'pole', 'aria-hidden': 'true' })),
    upHost,
    h('section', { class: 'stack' }, sectionHead('What do you need?'), catHost),
    h('section', { class: 'stack' }, h('div', { class: 'row between cust-sec' }, nearTitle, h('a', { href: '#/explore', class: 'bold small' }, 'See all')), nearHost));
}
