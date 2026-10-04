import { api } from '../api.js';
import { h, icon, avatar, stars, naira, fmtTime, fmtDate, sheet, kv, empty } from '../ui.js';
import { assetUrl } from '../config.js';
import { router } from '../router.js';
import { mapBox, createMap } from '../maps.js';
import { verifiedBadge, availabilityText, sectionHead } from './common.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function barberProfile(ctx) {
  const { barber: b } = await api('/barbers/' + ctx.params.id, { auth: false });
  ctx.setTitle('Barber');
  const id = b.id;
  const stat = (v, l) => h('div', { class: 'cust-stat' }, h('div', { class: 'money' }, v), h('div', { class: 'muted xs' }, l));

  const services = b.services.length
    ? h('div', { class: 'card' }, b.services.map((s) => h('div', { class: 'list-item cust-svc' },
        h('div', { class: 'grow' }, h('div', { class: 'bold' }, s.name), h('div', { class: 'muted small' }, `${s.durationMin} min`)),
        h('div', { class: 'bold' }, naira(s.priceKobo)),
        h('a', { class: 'btn sm red', href: `#/book/${id}?serviceId=${s.serviceId}`, 'aria-label': `Book ${s.name}` }, 'Book'))))
    : empty('No services listed', 'This barber has not added services yet.', null, 'scissors');

  const hours = b.availability.length
    ? h('div', { class: 'card' }, b.availability.map((a) => kv(DAYS[a.dayOfWeek], `${fmtTime(a.startTime)} to ${fmtTime(a.endTime)}`)))
    : h('p', { class: 'muted' }, 'Working hours have not been set yet.');

  const reviews = b.reviewsList.length
    ? h('div', { class: 'card' }, b.reviewsList.map((r) => h('div', { class: 'list-item cust-review', style: { alignItems: 'flex-start' } },
        h('div', { class: 'grow' },
          h('div', { class: 'row between' }, h('span', { class: 'bold' }, r.customerName), h('span', { class: 'muted xs' }, fmtDate(r.createdAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }))),
          stars(r.rating), r.comment ? h('p', { class: 'small', style: { marginTop: '4px' } }, r.comment) : null))))
    : empty('No reviews yet', 'Be the first to book and review this barber.', null, 'star');

  const gallery = b.portfolio.length
    ? h('div', { class: 'cust-gallery' }, b.portfolio.map((u, i) => h('button', { class: 'cust-shot', type: 'button', 'aria-label': `Open photo ${i + 1}`, onclick: () => sheet('', h('img', { class: 'cust-bigshot', src: assetUrl(u), alt: `Work by ${b.name}, photo ${i + 1}` })) },
        h('img', { src: assetUrl(u), alt: '', loading: 'lazy' }))))
    : h('p', { class: 'muted' }, 'No portfolio photos yet.');

  const box = mapBox('cust-areamap');
  if (b.latitude != null) {
    setTimeout(() => {
      const map = createMap(box, { center: [b.latitude, b.longitude], zoom: 13 });
      window.L.circle([b.latitude, b.longitude], { radius: 2500, color: '#12285a', fillColor: '#12285a', fillOpacity: 0.12, weight: 2 }).addTo(map);
      ctx.onLeave(() => map.remove());
    }, 0);
  }

  return h('div', { class: 'stack' },
    h('div', { class: 'card cust-prof' },
      h('div', { class: 'row', style: { alignItems: 'flex-start' } }, avatar(b, 'lg'),
        h('div', { class: 'grow' },
          h('div', { class: 'row', style: { gap: '6px' } }, h('h1', { style: { fontSize: '1.5rem' } }, b.name), b.verified ? verifiedBadge(22) : null),
          b.verified ? h('div', { class: 'chip green', style: { marginTop: '4px' } }, 'Verified barber') : null,
          h('div', { style: { marginTop: '6px' } }, stars(b.rating, b.reviews)),
          h('div', { class: 'small', style: { marginTop: '4px' } }, h('span', { class: b.availableToday ? 'cust-ok' : 'muted' }, availabilityText(b))))),
      h('div', { class: 'cust-stats' }, stat(b.experienceYears + (b.experienceYears === 1 ? ' yr' : ' yrs'), 'Experience'), stat(String(b.completedJobs), 'Jobs done'), stat(b.serviceArea, 'Service area')),
      b.bio ? h('p', null, b.bio) : null,
      b.homeService ? h('div', { class: 'chip', style: { marginTop: '8px' } }, icon('home', 14), 'Comes to your home') : null),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn red', href: '#/book/' + id }, 'Book now'),
      h('a', { class: 'btn ghost', href: '#/support?new=1&barber=' + encodeURIComponent(b.name) }, 'Contact support')),
    h('section', { class: 'stack' }, sectionHead('Services and prices'), services),
    h('section', { class: 'stack' }, sectionHead('Working days and hours'), hours),
    h('section', { class: 'stack' }, sectionHead('Portfolio'), gallery),
    h('section', { class: 'stack' }, sectionHead('Reviews'), reviews),
    h('section', { class: 'stack' }, sectionHead('Service area'), b.latitude != null ? box : null, h('p', { class: 'muted small' }, `Works around ${b.serviceArea}. The barber travels to you, so exact details stay private.`)));
}
