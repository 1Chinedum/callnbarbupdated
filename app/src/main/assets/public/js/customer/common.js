// Shared customer helpers: barber card, service icons, async sections, address form with map picker.
import { api } from '../api.js';
import { h, icon, avatar, stars, km, naira, fmtDate, fmtTime, todayLagos, errorBox, skeleton, mount, field, input, select, toast, banner, formError } from '../ui.js';
import { router } from '../router.js';
import { state, townInfo } from '../state.js';
import { mapBox, pickLocation, currentPosition, inDelta, townCenter } from '../maps.js';

export const SERVICE_ICON = {
  'Haircut': 'scissors', 'Low Cut': 'scissors', 'Fade': 'razor', 'Skin Fade': 'razor', 'Afro': 'sparkle', 'Beard Trim': 'beard',
  'Hair + Beard': 'users', 'Kids Haircut': 'child', 'Home Service': 'home', 'Styling': 'sparkle', 'Other': 'sparkle',
};
export const serviceIcon = (name) => SERVICE_ICON[name] || 'scissors';

export function verifiedBadge(size = 18) {
  return h('span', { class: 'verified', title: 'Verified barber', role: 'img', 'aria-label': 'Verified barber' }, icon('shield', size));
}

export function availabilityText(b) {
  if (b.availableToday) return 'Available today';
  if (b.nextAvailableDate) return 'Next: ' + fmtDate(b.nextAvailableDate);
  return 'No open times soon';
}

/** Reusable barber card. Whole card opens the profile (via the stretched name link); Book now sits above it. */
export function barberCard(b) {
  const tags = (b.services || []).slice(0, 3).map((s) => h('span', { class: 'chip' }, s.name));
  const more = (b.services || []).length - 3;
  return h('article', { class: 'card cust-bcard' },
    h('div', { class: 'top' },
      avatar(b, 'lg'),
      h('div', { class: 'grow' },
        h('div', { class: 'row', style: { gap: '6px' } }, h('a', { class: 'cust-name-link bold', href: '#/barber/' + b.id }, b.name), b.verified ? verifiedBadge() : null),
        h('div', { class: 'cust-meta' }, stars(b.rating, b.reviews)),
        h('div', { class: 'cust-meta muted small' }, icon('pin', 14), [b.serviceArea, b.distanceKm != null ? km(b.distanceKm) + ' away' : null].filter(Boolean).join(' · ')),
        h('div', { class: 'cust-meta small' }, icon('clock', 14), h('span', { class: b.availableToday ? 'cust-ok' : 'muted' }, availabilityText(b))))),
    h('div', { class: 'tags' }, tags, more > 0 ? h('span', { class: 'chip grey' }, `+${more}`) : null),
    h('div', { class: 'row between' },
      h('div', null, h('div', { class: 'muted xs' }, 'From'), h('div', { class: 'price' }, b.startingPriceKobo != null ? naira(b.startingPriceKobo) : 'Ask barber')),
      h('a', { class: 'btn red sm cust-book', href: '#/book/' + b.id }, 'Book now')));
}

export function barberSkeletons(n = 3) {
  return h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': 'Loading barbers' }, Array.from({ length: n }, () => skeleton(4, 16)));
}

/** Loads data into `host`: skeleton, then render(data) or errorBox with retry. */
export async function loadInto(host, fetcher, render, skel = () => barberSkeletons(2)) {
  const my = (host._load = (host._load || 0) + 1);
  mount(host, skel());
  try {
    const data = await fetcher();
    if (host._load !== my) return;
    mount(host, render(data));
  } catch (e) {
    if (host._load !== my) return;
    mount(host, errorBox(e.message || 'Something went wrong.', () => loadInto(host, fetcher, render, skel)));
  }
}

export const sectionHead = (title, action) => h('div', { class: 'row between cust-sec' }, h('h2', null, title), action || null);

export const bookingWhen = (b) => `${fmtDate(b.date)} · ${fmtTime(b.startTime)}`;

export const IS_ACTIVE = ['ON_THE_WAY', 'ARRIVED', 'VERIFIED', 'IN_PROGRESS'];
export const LIVE_STATUSES = ['PENDING_PAYMENT', 'BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'VERIFIED', 'IN_PROGRESS', 'CONFIRMED'];

/**
 * Address form with map picker. Returns { node, get(): {address, city, ...}|null (validates), setFrom(addr) }.
 * opts: { showSave, showLabel, ctx }
 */
export function addressForm({ ctx, showSave = false, showLabel = false, initial = {}, defaultTown } = {}) {
  const towns = (state.meta?.towns || []).map((t) => [t.name, t.name]);
  const f = {
    label: input({ placeholder: 'Home, Work…', maxlength: 30, value: initial.label || '' }),
    city: select(towns, {}, initial.city || defaultTown || towns[0]?.[0]),
    address: input({ placeholder: 'House number and street', autocomplete: 'street-address', value: initial.address || '' }),
    landmark: input({ placeholder: 'Near a church, school, junction…', value: initial.landmark || '' }),
    instructions: h('textarea', { class: 'input', placeholder: 'Gate colour, floor, how to call you…', maxlength: 300 }, initial.instructions || ''),
  };
  const save = h('input', { type: 'checkbox', id: 'cust-save-addr' });
  let pos = initial.latitude != null ? { lat: initial.latitude, lng: initial.longitude } : null;
  let picker = null;
  const note = h('div', { 'aria-live': 'polite' });
  const err = h('div', { 'aria-live': 'polite' });
  const box = mapBox('cust-pickmap');
  const setNote = (inside) => mount(note, pos ? (inside ? h('p', { class: 'small cust-ok' }, 'Pin placed. Drag it or tap the map to adjust.') : banner('That spot is outside Delta State. CallNBarb only serves Delta State, so please place the pin inside Delta.', 'red', 'alert')) : h('p', { class: 'muted small' }, 'Tap the map to drop a pin where the barber should come.'));
  const outside = () => pos && !inDelta(pos.lat, pos.lng);
  const onPick = (la, ln, inside) => { pos = { lat: la, lng: ln }; setNote(inside); };
  setNote(pos ? inDelta(pos.lat, pos.lng) : true);

  const startMap = () => {
    const c = pos ? [pos.lat, pos.lng] : townCenter(f.city.value);
    picker = pickLocation(box, { lat: pos ? pos.lat : undefined, lng: pos ? pos.lng : undefined, onChange: onPick });
    if (!pos) picker.map.setView(c, 13);
    if (ctx) ctx.onLeave(() => picker && picker.map.remove());
  };
  setTimeout(startMap, 0);
  f.city.addEventListener('change', () => { if (!pos && picker) picker.map.setView(townCenter(f.city.value), 13); });

  const locate = h('button', { type: 'button', class: 'btn soft block', onclick: async (e) => {
    const b = e.currentTarget; b.classList.add('loading');
    try {
      const p = await currentPosition();
      if (!inDelta(p.lat, p.lng)) {
        mount(note, banner('Your current location is outside Delta State. CallNBarb only serves Delta State, so tap the map to place the pin where you want the barber to come.', 'red', 'alert'));
        pos = null;
        return;
      }
      picker.setPosition(p.lat, p.lng);
    } catch (er) { mount(note, banner(er.message, '', 'alert')); } finally { b.classList.remove('loading'); }
  } }, icon('target', 20), 'Use my current location');

  const node = h('div', { class: 'stack' },
    showLabel ? field('Name this place', f.label) : null,
    field('Town', f.city),
    field('Street address', f.address),
    field('Landmark (optional)', f.landmark),
    field('Instructions for the barber (optional)', f.instructions),
    h('div', { class: 'stack' }, h('div', { class: 'label' }, 'Pin your location'), box, note, locate),
    showSave ? h('label', { class: 'row cust-check', for: 'cust-save-addr' }, save, h('span', null, 'Save this address for next time')) : null,
    err);

  return {
    node,
    get() {
      mount(err);
      if (f.address.value.trim().length < 5) { mount(err, formError('Enter your street address (at least 5 characters).')); f.address.focus(); return null; }
      if (outside()) { mount(err, formError('The pin is outside Delta State. CallNBarb only serves Delta State.')); return null; }
      return {
        label: f.label.value.trim() || undefined,
        address: f.address.value.trim(), city: f.city.value, state: 'Delta',
        landmark: f.landmark.value.trim(), instructions: f.instructions.value.trim(),
        latitude: pos ? pos.lat : null, longitude: pos ? pos.lng : null,
        save: showSave ? save.checked : undefined,
      };
    },
  };
}

export const goBook = (id, serviceId) => router.navigate('/book/' + id + (serviceId ? '?serviceId=' + serviceId : ''));
export { api, toast, townInfo, todayLagos };
