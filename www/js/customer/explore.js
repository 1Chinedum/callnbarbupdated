import { api } from '../api.js';
import { h, icon, input, select, field, mount, sheet, switchRow, debounce, toKobo, toast, empty, naira, banner } from '../ui.js';
import { router } from '../router.js';
import { getTown, townInfo, state } from '../state.js';
import { mapBox, createMap, addMarker, fitMarkers, currentPosition, inDelta } from '../maps.js';
import { barberCard, barberSkeletons, loadInto, availabilityText } from './common.js';

const SORTS = [['recommended', 'Recommended'], ['nearest', 'Nearest'], ['rating', 'Highest rated'], ['price_low', 'Lowest price'], ['price_high', 'Highest price'], ['popularity', 'Most popular']];

export default async function explore(ctx) {
  const f = { q: ctx.query.q || '', serviceId: ctx.query.serviceId || '', maxPrice: '', minRating: '', maxDistance: '', availableToday: false, homeService: false };
  let sort = 'recommended';
  let view = 'list';
  let me = null; // { lat, lng, located }
  let services = [];
  let result = null;
  let map = null;

  try { services = (await api('/services', { auth: false })).services; } catch {}

  const origin = () => { if (me) return me; const t = townInfo(getTown()); return t ? { lat: t.lat, lng: t.lng } : {}; };
  const filterCount = () => ['serviceId', 'maxPrice', 'minRating', 'maxDistance'].filter((k) => f[k]).length + (f.availableToday ? 1 : 0) + (f.homeService ? 1 : 0);

  const q = input({ type: 'search', placeholder: 'Search barber or service', value: f.q, 'aria-label': 'Search barbers', enterkeyhint: 'search' });
  const filterBtn = h('button', { class: 'btn soft cust-filter-btn', type: 'button', onclick: openFilters });
  const sortSel = select(SORTS, { 'aria-label': 'Sort barbers' }, sort);
  const toggle = h('div', { class: 'seg', role: 'group', 'aria-label': 'View' });
  const body = h('div', { class: 'stack', 'aria-live': 'polite' });
  const info = h('div', { class: 'muted small' });
  const chipsHost = h('div', { class: 'cust-active-filters' });

  const drawBar = () => {
    mount(filterBtn, icon('filter', 18), 'Filters', filterCount() ? h('span', { class: 'cust-count' }, filterCount()) : null);
    mount(toggle, [['list', 'List', 'list'], ['map', 'Map', 'map']].map(([v, t, i]) => h('button', { type: 'button', 'aria-pressed': view === v, onclick: () => { view = v; drawBar(); draw(); } }, icon(i, 18), t)));
    const chips = [];
    const svc = services.find((s) => String(s.id) === String(f.serviceId));
    const add = (label, clear) => chips.push(h('button', { class: 'pill cust-fchip', type: 'button', onclick: () => { clear(); drawBar(); load(); }, 'aria-label': 'Remove filter ' + label }, label, icon('x', 14)));
    if (svc) add(svc.name, () => (f.serviceId = ''));
    if (f.maxPrice) add('Up to ' + naira(toKobo(f.maxPrice)), () => (f.maxPrice = ''));
    if (f.minRating) add(f.minRating + '+ stars', () => (f.minRating = ''));
    if (f.maxDistance) add('Within ' + f.maxDistance + ' km', () => (f.maxDistance = ''));
    if (f.availableToday) add('Available today', () => (f.availableToday = false));
    if (f.homeService) add('Home service', () => (f.homeService = false));
    mount(chipsHost, chips);
    chipsHost.classList.toggle('hidden', !chips.length);
  };

  function openFilters() {
    const draft = { ...f };
    const svc = select([['', 'Any service'], ...services.map((s) => [s.id, s.name])], {}, draft.serviceId);
    const price = input({ type: 'number', inputmode: 'numeric', min: 0, step: 500, placeholder: 'No limit', value: draft.maxPrice });
    const rating = select([['', 'Any rating'], ['3', '3 stars and up'], ['4', '4 stars and up'], ['4.5', '4.5 stars and up']], {}, draft.minRating);
    const dist = select([['', 'Any distance'], ['2', 'Within 2 km'], ['5', 'Within 5 km'], ['10', 'Within 10 km'], ['25', 'Within 25 km']], {}, draft.maxDistance);
    sheet('Filters', (close) => h('div', { class: 'stack' },
      field('Service', svc), field('Maximum starting price (₦)', price), field('Minimum rating', rating), field('Maximum distance', dist),
      switchRow('Available today', draft.availableToday, (v) => (draft.availableToday = v)),
      switchRow('Offers home service', draft.homeService, (v) => (draft.homeService = v)),
      h('p', { class: 'muted small' }, 'Only verified barbers are shown.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { Object.assign(f, { serviceId: '', maxPrice: '', minRating: '', maxDistance: '', availableToday: false, homeService: false }); close(); drawBar(); load(); } }, 'Clear all'),
        h('button', { class: 'btn', type: 'button', onclick: () => { Object.assign(f, { serviceId: svc.value, maxPrice: price.value, minRating: rating.value, maxDistance: dist.value, availableToday: draft.availableToday, homeService: draft.homeService }); close(); drawBar(); load(); } }, 'Show barbers'))));
  }

  async function load() {
    const o = origin();
    mount(body, barberSkeletons(3));
    try {
      result = await api('/barbers', { auth: false, query: {
        q: f.q.trim() || undefined, serviceId: f.serviceId, maxPriceKobo: f.maxPrice ? toKobo(f.maxPrice) : undefined, minRating: f.minRating,
        maxDistanceKm: f.maxDistance, availableToday: f.availableToday ? 1 : undefined, homeService: f.homeService ? 1 : undefined, sort, lat: o.lat, lng: o.lng } });
      result.err = null;
    } catch (e) { result = { err: e.message }; }
    draw();
  }

  function draw() {
    if (map) { map.remove(); map = null; }
    if (!result) return;
    if (result.err) { mount(info); mount(body, h('div', { class: 'empty card flat' }, h('div', { class: 'ill', style: { background: 'var(--red-bg)', color: 'var(--red)' } }, icon('alert', 34)), h('h3', null, 'Could not load barbers'), h('p', { class: 'muted' }, result.err), h('button', { class: 'btn soft', onclick: load }, icon('refresh', 18), 'Try again'))); return; }
    mount(info, `${result.total} barber${result.total === 1 ? '' : 's'} · distances from ${me && me.located ? 'your location' : getTown()}`);
    if (!result.barbers.length) {
      mount(body, empty('No barbers match', 'Try removing a filter or searching for something else.', h('button', { class: 'btn', onclick: () => { Object.assign(f, { q: '', serviceId: '', maxPrice: '', minRating: '', maxDistance: '', availableToday: false, homeService: false }); q.value = ''; drawBar(); load(); } }, 'Clear search and filters'), 'search'));
      return;
    }
    if (view === 'list') { mount(body, result.barbers.map(barberCard)); return; }
    drawMap();
  }

  function drawMap() {
    const box = mapBox('tall');
    const mini = h('div', { 'aria-live': 'polite' });
    const locBtn = h('button', { class: 'btn sm cust-locate', type: 'button', 'aria-label': 'Use my current location', onclick: async (e) => {
      const b = e.currentTarget; b.classList.add('loading');
      try {
        const p = await currentPosition();
        if (!inDelta(p.lat, p.lng)) { toast('You appear to be outside Delta State. CallNBarb only serves Delta State.', 'error'); return; }
        me = { lat: p.lat, lng: p.lng, located: true };
        await load();
      } catch (er) { toast(er.message, 'error'); } finally { b.classList.remove('loading'); }
    } }, icon('target', 18), 'Near me');
    mount(body, h('div', { class: 'cust-mapwrap' }, box, locBtn), mini, h('p', { class: 'muted small' }, 'Tap a pin to see the barber.'));
    setTimeout(() => {
      map = createMap(box);
      const pts = [];
      result.barbers.forEach((b) => {
        if (b.latitude == null) return;
        pts.push([b.latitude, b.longitude]);
        addMarker(map, b.latitude, b.longitude, { label: b.name, navy: true, onClick: () => mount(mini, miniCard(b)) });
      });
      if (me) { addMarker(map, me.lat, me.lng, { label: 'You are here' }); pts.push([me.lat, me.lng]); }
      fitMarkers(map, pts);
    }, 0);
  }
  ctx.onLeave(() => { if (map) map.remove(); });

  const miniCard = (b) => h('div', { class: 'card cust-mini' },
    h('div', { class: 'row between' }, h('a', { class: 'bold', href: '#/barber/' + b.id }, b.name), h('span', { class: 'price bold' }, b.startingPriceKobo != null ? 'From ' + naira(b.startingPriceKobo) : '')),
    h('div', { class: 'muted small' }, `★ ${b.rating.toFixed(1)} (${b.reviews}) · ${availabilityText(b)}`),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn ghost sm', href: '#/barber/' + b.id }, 'View profile'), h('a', { class: 'btn red sm', href: '#/book/' + b.id }, 'Book now')));

  const run = debounce(() => { f.q = q.value; load(); }, 350);
  q.addEventListener('input', run);
  sortSel.addEventListener('change', () => { sort = sortSel.value; load(); });

  drawBar();
  load();
  return h('div', { class: 'stack' },
    h('div', { class: 'page-title' }, h('h1', null, 'Find a barber')),
    h('form', { class: 'row', role: 'search', onsubmit: (e) => { e.preventDefault(); f.q = q.value; load(); } }, h('div', { class: 'grow' }, q), filterBtn),
    chipsHost,
    h('div', { class: 'row between wrap' }, toggle, h('div', { class: 'cust-sort' }, h('label', { class: 'sr-only', for: (sortSel.id = 'cust-sort') }, 'Sort by'), sortSel)),
    info, body);
}
