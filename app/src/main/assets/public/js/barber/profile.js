// Barber profile: onboarding checklist, public profile, ID, bank, services, hours, portfolio, account.
import { api, session, uploadFile } from '../api.js';
import { h, icon, naira, toKobo, avatar, stars, statusChip, field, input, select, switchRow, mount, toast, asyncButton, formError, sheet, confirmDialog, banner, skeleton, empty, fmtDate, todayLagos } from '../ui.js';
import { state } from '../state.js';
import { pickLocation, currentPosition, inDelta, townCenter } from '../maps.js';
import { avatarEditor, detailsForm, passwordForm, prefsForm, legalLinks, section, logoutNow } from '../account.js';
import { livePage, pageHead } from './common.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// ---------- checklist
function checklist(p, services, avail) {
  const items = [
    ['Profile photo', !!p.image], ['About you', !!p.bio], ['Base location', !!p.address && p.latitude != null], ['ID document', p.hasIdDocument],
    ['Bank details', !!p.bank?.accountNumber], ['At least one service', services.some((s) => s.active)], ['Working hours', avail.days.some((d) => d.active)],
  ];
  const done = items.filter((i) => i[1]).length;
  return { items, done, total: items.length };
}

function statusCard(p, cl, refresh) {
  const st = p.verificationStatus;
  const submit = asyncButton('Submit for review', async () => {
    try { await api('/barber/verification/submit', { method: 'POST' }); toast('Submitted. We will review your profile soon.', 'success'); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  }, { cls: 'btn red block' });
  return h('div', { class: 'card stack' },
    h('div', { class: 'row between' }, h('div', { class: 'bold' }, 'Account status'), statusChip(st)),
    st === 'VERIFIED' ? h('p', { class: 'muted small' }, 'You are verified and can receive bookings.') : [
      h('div', { class: 'steps', 'aria-hidden': 'true' }, cl.items.map((i) => h('i', { class: i[1] ? 'done' : '' }))),
      h('ul', { class: 'barb-check' }, cl.items.map(([t, ok]) => h('li', { class: ok ? 'ok' : '' }, icon(ok ? 'check' : 'clock', 16), t))),
      st === 'REJECTED' && p.rejectionReason ? banner(p.rejectionReason, 'red', 'alert') : null,
      st === 'PENDING' ? h('p', { class: 'muted small' }, 'Your application is being reviewed.') : st === 'SUSPENDED' ? null : (cl.done === cl.total ? submit : h('p', { class: 'muted small' }, 'Complete every item to submit for review.'))]);
}

// ---------- public profile + location
function profileForm(p, refresh) {
  const towns = (state.meta?.towns || []).map((t) => [t.name, t.name]);
  const f = {
    bio: h('textarea', { class: 'input', rows: '4', maxlength: '600', placeholder: 'Tell customers about your style and experience' }, p.bio || ''),
    exp: input({ type: 'number', min: '0', max: '60', value: p.experienceYears ?? 0 }),
    area: select(towns, {}, p.serviceArea || towns[0]?.[0]),
    addr: input({ value: p.address || '', placeholder: 'Shop or home address' }),
  };
  let pos = p.latitude != null ? { lat: p.latitude, lng: p.longitude } : null;
  const note = h('p', { class: 'muted xs' }, pos ? 'Tap the map to move your pin.' : 'Tap the map to place your base location.');
  const mapEl = h('div', { class: 'map', style: { height: '220px' } });
  const err = h('div');
  let picker;
  setTimeout(() => {
    picker = pickLocation(mapEl, { lat: pos?.lat, lng: pos?.lng, onChange: (la, ln, ok) => { pos = { lat: la, lng: ln }; mount(note, ok ? 'Pin placed.' : 'That is outside Delta State.'); } });
    if (!pos) picker.map.setView(townCenter(f.area.value), 12);
  }, 0);
  f.area.addEventListener('change', () => { if (picker && !pos) picker.map.setView(townCenter(f.area.value), 12); });
  const home = { v: p.homeService };
  const gps = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { try { const c = await currentPosition(); pos = { lat: c.lat, lng: c.lng }; picker.setPosition(c.lat, c.lng); picker.map.setView([c.lat, c.lng], 15); } catch (e) { toast(e.message, 'error'); } } }, icon('target', 18), 'Use my location');
  const save = asyncButton('Save profile', async () => {
    mount(err);
    if (pos && !inDelta(pos.lat, pos.lng)) return mount(err, formError('Your pin must be inside Delta State.'));
    try {
      await api('/barber/profile', { method: 'PUT', body: { bio: f.bio.value.trim(), experienceYears: Number(f.exp.value) || 0, serviceArea: f.area.value, address: f.addr.value.trim(), latitude: pos?.lat ?? null, longitude: pos?.lng ?? null, homeService: home.v } });
      toast('Profile saved.', 'success'); refresh();
    } catch (e) { mount(err, formError(e.message)); }
  }, { cls: 'btn block' });
  return h('div', { class: 'stack' }, field('About you', f.bio), field('Years of experience', f.exp), field('Service area (town)', f.area), field('Base address', f.addr), mapEl, note, gps,
    switchRow('I travel to customers', home.v, (v) => { home.v = v; }), err, save);
}

// ---------- ID + bank
function idForm(p, refresh) {
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'barb-id', class: 'sr-only', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const up = await uploadFile(f, 'document'); await api('/barber/profile', { method: 'PUT', body: { idDocument: up.url } }); toast('ID uploaded.', 'success'); refresh(); }
    catch (er) { toast(er.message, 'error'); }
  } });
  return h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Upload a clear photo of a government ID. Only our review team can see it.'),
    h('div', { class: 'row' }, statusChip(p.hasIdDocument ? 'VERIFIED' : 'PENDING', p.hasIdDocument ? 'Uploaded' : 'Not uploaded'), h('label', { class: 'btn sm ghost', for: 'barb-id' }, icon('upload', 18), p.hasIdDocument ? 'Replace' : 'Upload'), file));
}

function bankForm(p, refresh) {
  const banks = state.meta?.banks || [];
  const f = { bank: select([['', 'Choose your bank'], ...banks.map((b) => [b.code, b.name])], {}, p.bank?.bankCode || ''), num: input({ inputmode: 'numeric', maxlength: '10', value: p.bank?.accountNumber || '', placeholder: '10-digit account number' }), name: input({ value: p.bank?.accountName || '', placeholder: 'Name on the account' }) };
  const err = h('div');
  const save = asyncButton('Save bank details', async () => {
    mount(err);
    try { await api('/barber/profile', { method: 'PUT', body: { bank: { bankCode: f.bank.value, accountNumber: f.num.value.trim(), accountName: f.name.value.trim() } } }); toast('Bank details saved.', 'success'); refresh(); }
    catch (e) { mount(err, formError(e.message)); }
  }, { cls: 'btn block' });
  return h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Withdrawals are paid to this account.'), field('Bank', f.bank), field('Account number', f.num), field('Account name', f.name), err, save);
}

// ---------- services
async function serviceSheet(existing, catalog, taken, refresh) {
  const f = {
    svc: existing ? null : select(catalog.filter((c) => !taken.has(c.id)).map((c) => [c.id, c.name])),
    price: input({ type: 'number', min: '500', step: '50', value: existing ? existing.priceKobo / 100 : '' }),
    dur: input({ type: 'number', min: '10', max: '480', step: '5', value: existing?.durationMin ?? 30 }),
    desc: input({ maxlength: '200', value: existing?.description || '', placeholder: 'Optional short description' }),
  };
  const err = h('div'); let on = existing ? existing.active : true;
  const body = h('div', { class: 'stack' }, existing ? h('div', { class: 'bold' }, existing.name) : field('Service', f.svc), field('Price (₦)', f.price), field('Duration (minutes)', f.dur), field('Description', f.desc), switchRow('Offered to customers', on, (v) => { on = v; }), err,
    asyncButton('Save service', async () => {
      mount(err);
      const priceKobo = toKobo(f.price.value);
      try {
        if (existing) await api('/barber/services/' + existing.id, { method: 'PUT', body: { priceKobo, durationMin: Number(f.dur.value), description: f.desc.value.trim(), active: on } });
        else await api('/barber/services', { method: 'POST', body: { serviceId: Number(f.svc.value), priceKobo, durationMin: Number(f.dur.value), description: f.desc.value.trim(), active: on } });
        s.close(); toast('Service saved.', 'success'); refresh();
      } catch (e) { mount(err, formError(e.message)); }
    }, { cls: 'btn red block' }));
  const s = sheet(existing ? 'Edit service' : 'Add a service', body);
}

function servicesBlock(services, refresh) {
  const catalogP = api('/services', { auth: false }).then((r) => r.services).catch(() => []);
  const active = services.filter((s) => s.active || true);
  return h('div', { class: 'stack' },
    active.length ? active.map((s) => h('div', { class: 'card tight row' },
      h('div', { class: 'grow' }, h('div', { class: 'bold' }, s.name), h('div', { class: 'muted small' }, `${s.durationMin} min · ${naira(s.priceKobo)}${s.active ? '' : ' · hidden'}`)),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => serviceSheet(s, await catalogP, new Set(), refresh) }, 'Edit'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove ' + s.name, onclick: async () => { if (await confirmDialog('Remove this service?', 'Customers will no longer be able to book it.', { confirmLabel: 'Remove', danger: true })) { try { await api('/barber/services/' + s.id, { method: 'DELETE' }); refresh(); } catch (e) { toast(e.message, 'error'); } } } }, icon('trash', 20))))
      : empty('No services yet', 'Add what you offer and your prices.', null, 'scissors'),
    h('button', { class: 'btn soft block', type: 'button', onclick: async () => serviceSheet(null, await catalogP, new Set(services.map((x) => x.serviceId)), refresh) }, icon('plus', 20), 'Add a service'));
}

// ---------- availability
function availabilityBlock(av, refresh) {
  const byDay = new Map(av.days.map((d) => [d.dayOfWeek, d]));
  const rows = DAY_ORDER.map((i) => {
    const d = byDay.get(i) || { dayOfWeek: i, startTime: '09:00', endTime: '18:00', breakStart: null, breakEnd: null, active: false };
    const r = { d, on: d.active, st: input({ type: 'time', value: d.startTime }), en: input({ type: 'time', value: d.endTime }), bs: input({ type: 'time', value: d.breakStart || '' }), be: input({ type: 'time', value: d.breakEnd || '' }) };
    return r;
  });
  const err = h('div');
  const save = asyncButton('Save working hours', async () => {
    mount(err);
    try {
      await api('/barber/availability', { method: 'PUT', body: { days: rows.map((r) => ({ dayOfWeek: r.d.dayOfWeek, startTime: r.st.value, endTime: r.en.value, breakStart: r.bs.value && r.be.value ? r.bs.value : null, breakEnd: r.bs.value && r.be.value ? r.be.value : null, active: r.on })) } });
      toast('Working hours saved.', 'success'); refresh();
    } catch (e) { mount(err, formError(e.message)); }
  }, { cls: 'btn block' });
  const date = input({ type: 'date', min: todayLagos() }); const reason = input({ placeholder: 'Reason (optional)', maxlength: '100' });
  return h('div', { class: 'stack' },
    rows.map((r) => h('div', { class: 'card tight stack' }, switchRow(DAYS[r.d.dayOfWeek], r.on, (v) => { r.on = v; }),
      h('div', { class: 'grid2' }, field('Start', r.st), field('End', r.en)), h('div', { class: 'grid2' }, field('Break from', r.bs), field('Break to', r.be)))),
    err, save,
    h('h3', { class: 'barb-h2' }, 'Days off'),
    av.unavailableDates.map((u) => h('div', { class: 'card tight row' }, h('div', { class: 'grow' }, h('div', { class: 'bold' }, fmtDate(u.date)), u.reason ? h('div', { class: 'muted xs' }, u.reason) : null), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove day off', onclick: async () => { try { await api('/barber/unavailable-dates/' + u.id, { method: 'DELETE' }); refresh(); } catch (e) { toast(e.message, 'error'); } } }, icon('x', 20)))),
    field('Date', date), field('Reason', reason),
    asyncButton('Add day off', async () => { if (!date.value) return toast('Choose a date.', 'error'); try { await api('/barber/unavailable-dates', { method: 'POST', body: { date: date.value, reason: reason.value.trim() } }); refresh(); } catch (e) { toast(e.message, 'error'); } }, { cls: 'btn ghost block' }));
}

// ---------- portfolio
function portfolioBlock(urls, refresh) {
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'barb-port', class: 'sr-only', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await uploadFile(f, 'portfolio'); toast('Photo added.', 'success'); refresh(); } catch (er) { toast(er.message, 'error'); }
  } });
  return h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Show customers your best work.'),
    urls.length ? h('div', { class: 'barb-portfolio' }, urls.map((u) => h('img', { src: u, alt: 'Haircut by you', loading: 'lazy' }))) : null,
    h('label', { class: 'btn soft block', for: 'barb-port' }, icon('image', 20), 'Add a photo'), file);
}

export default function profile(ctx) {
  const page = livePage(ctx, {
    skeleton: h('div', { class: 'stack' }, skeleton(4), skeleton(3)),
    load: async () => {
      const prof = (await api('/barber/profile')).profile;
      const [svc, av, pub] = await Promise.all([api('/barber/services'), api('/barber/availability'), api('/barbers/' + session.user.id, { auth: false }).catch(() => null)]);
      return { p: prof, services: svc.services, av, portfolio: pub?.barber?.portfolio || [] };
    },
    render: ({ p, services, av, portfolio }, refresh) => {
      const again = () => refresh({ force: true });
      const cl = checklist(p, services, av);
      return [
        pageHead('Profile'),
        h('div', { class: 'card stack' }, avatarEditor({ ...session.user, name: p.name, email: p.email, image: p.image }, () => again()), p.rating ? h('div', null, stars(p.rating, p.reviews)) : null),
        statusCard(p, cl, again),
        section('Public profile and location', 'user', profileForm(p, again)),
        section('Services and prices', 'scissors', servicesBlock(services, again)),
        section('Working hours', 'clock', availabilityBlock(av, again)),
        section('Portfolio', 'image', portfolioBlock(portfolio, again)),
        section('ID document', 'shield', idForm(p, again)),
        section('Bank details', 'bank', bankForm(p, again)),
        section('Personal details', 'gear', detailsForm({ name: p.name, email: p.email, phone: p.phone }, () => again())),
        section('Password', 'lock', passwordForm()),
        section('Notification settings', 'bell', prefsForm(session.user || {})),
        h('div', { class: 'list' },
          h('a', { class: 'list-item', href: '#/b/notifications' }, icon('bell', 20), h('span', { class: 'grow bold' }, 'Notifications'), icon('chevR', 18)),
          h('a', { class: 'list-item', href: '#/b/support' }, icon('chat', 20), h('span', { class: 'grow bold' }, 'Help and support'), icon('chevR', 18))),
        legalLinks(),
        h('button', { class: 'btn ghost block', type: 'button', onclick: logoutNow }, icon('logout', 20), 'Log out'),
      ];
    },
  });
  return page.root;
}
