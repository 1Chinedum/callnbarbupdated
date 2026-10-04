// Admin pages. Every number comes from the server; actions call the admin API and then reload.
import { api, privateFileUrl } from '../api.js';
import { h, icon, naira, toKobo, fmtDate, fmtDateTime, fmtTime, statusChip, mount, toast, sheet, field, input, select, formError, confirmDialog, promptDialog, empty, kv } from '../ui.js';

const A = (p, o) => api('/admin' + p, o);
const money = (k) => naira(k);
const btn = (label, fn, cls = 'btn sm ghost') => h('button', { class: cls, type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (er) { toast(er.message, 'error'); } finally { b.disabled = false; } } }, label);
const head = (title, ...tools) => h('div', { class: 'adm-top' }, h('h1', null, title), h('div', { class: 'adm-tools' }, tools));

function table(cols, rows, emptyText = 'Nothing here yet') {
  if (!rows.length) return h('div', { class: 'adm-card' }, empty(emptyText, '', null, 'list'));
  return h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-t' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', null, cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.cell ? c.cell(r) : r[c.key] ?? '')))))));
}
const person = (r) => r.name || '';
function pager(page, count, size, go) {
  return h('div', { class: 'adm-pager' }, h('span', { class: 'muted small' }, `Page ${page}`),
    h('button', { class: 'btn sm ghost', disabled: page <= 1, onclick: () => go(page - 1) }, 'Previous'), h('button', { class: 'btn sm ghost', disabled: count < size, onclick: () => go(page + 1) }, 'Next'));
}
function listPage(title, load, cols, { filters = [], pageSize = 25, tools = [], key } = {}) {
  const host = h('div'); const state = { page: 1 }; filters.forEach((f) => { state[f.name] = f.value || ''; });
  const bar = h('div', { class: 'adm-tools' }, filters.map((f) => {
    const el = f.options ? select(f.options, {}, state[f.name]) : input({ placeholder: f.label, value: state[f.name], type: f.type || 'text' });
    el.addEventListener(f.options ? 'change' : 'change', () => { state[f.name] = el.value; state.page = 1; draw(); }); el.setAttribute('aria-label', f.label); return el;
  }), tools);
  const draw = async () => {
    mount(host, h('div', { class: 'muted' }, 'Loading…'));
    try { const { rows, total } = await load({ ...state, limit: pageSize }); mount(host, table(cols(draw), rows), pager(state.page, rows.length, pageSize, (p) => { state.page = p; draw(); })); }
    catch (e) { mount(host, formError(e.message)); }
  };
  draw();
  return h('div', null, h('div', { class: 'adm-top' }, h('h1', null, title), bar), host);
}
const q = (s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '' && v != null));
const statusOpts = (list) => [['', 'All statuses'], ...list.map((s) => [s, s.replace(/_/g, ' ').toLowerCase()])];
const reason = (title, label, cta) => promptDialog(title, label, { confirmLabel: cta });

// ---------- charts (accessible inline SVG bars)
function bars(data, valueKey, { fmt = (v) => v, cls = 'bar', label }) {
  const W = 560, H = 190, pad = 24;
  if (!data.length) return h('p', { class: 'muted' }, 'No data in this period.');
  const max = Math.max(...data.map((d) => d[valueKey]), 1);
  const bw = (W - pad) / data.length;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'adm-chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label + ': ' + data.map((d) => `${d.day} ${fmt(d[valueKey])}`).join(', '));
  data.forEach((d, i) => {
    const bh = Math.max(2, (d[valueKey] / max) * (H - 40));
    const r = document.createElementNS(svg.namespaceURI, 'rect');
    r.setAttribute('x', pad + i * bw + bw * 0.15); r.setAttribute('y', H - 20 - bh); r.setAttribute('width', bw * 0.7); r.setAttribute('height', bh); r.setAttribute('rx', 3); r.setAttribute('class', cls);
    const t = document.createElementNS(svg.namespaceURI, 'title'); t.textContent = `${d.day}: ${fmt(d[valueKey])}`; r.append(t); svg.append(r);
    if (data.length <= 12 || i % Math.ceil(data.length / 8) === 0) { const x = document.createElementNS(svg.namespaceURI, 'text'); x.setAttribute('x', pad + i * bw + bw / 2); x.setAttribute('y', H - 6); x.setAttribute('text-anchor', 'middle'); x.textContent = d.day.slice(5); svg.append(x); }
  });
  const top = document.createElementNS(svg.namespaceURI, 'text'); top.setAttribute('x', 0); top.setAttribute('y', 12); top.textContent = fmt(max); svg.append(top);
  return svg;
}

// ---------- dashboard
async function dashboard({ go }) {
  let range = sessionStorage.getItem('adm_range') || '30d';
  const host = h('div');
  const draw = async () => {
    const d = await A('/dashboard', { query: { range } });
    const t = d.totals;
    const kpi = (l, v, href, warn) => h('a', { class: 'adm-kpi' + (warn && Number(String(v).replace(/\D/g, '')) > 0 ? ' warn' : ''), href: href || '#/dashboard' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
    mount(host,
      h('div', { class: 'adm-kpis' },
        kpi('Customers', t.customers, '#/customers'), kpi('Barbers (verified)', `${t.barbers} (${t.verifiedBarbers})`, '#/barbers'),
        kpi('Awaiting verification', t.pendingVerification, '#/verification', true), kpi('Total bookings', t.bookings, '#/bookings'),
        kpi('Completed jobs', t.completedBookings, '#/bookings'), kpi('Customer spend (completed)', money(t.revenueKobo), '#/payments'),
        kpi('Platform commission', money(t.platformCommissionKobo), '#/reports'), kpi('Paid to barbers', money(t.barberEarningsKobo), '#/withdrawals'),
        kpi('Pending withdrawals', `${t.pendingWithdrawals} · ${money(t.pendingWithdrawalsKobo)}`, '#/withdrawals', true), kpi('Open disputes', t.openDisputes, '#/disputes', true), kpi('Open support tickets', t.openTickets, '#/support', true)),
      h('div', { class: 'adm-kpis' }, kpi('Bookings in period', d.period.bookings), kpi('Completed in period', d.period.completed), kpi('Cancellation rate', d.period.cancellationRate + '%'), kpi('Commission in period', money(d.period.commissionKobo))),
      h('div', { class: 'adm-grid2' },
        h('div', { class: 'adm-card' }, h('h3', null, 'Bookings per day'), bars(d.series.bookingsPerDay, 'count', { label: 'Bookings per day' })),
        h('div', { class: 'adm-card' }, h('h3', null, 'Customer spend per day'), bars(d.series.revenuePerDay, 'revenueKobo', { fmt: money, label: 'Spend per day', cls: 'bar2' }))),
      h('div', { class: 'adm-grid2' },
        h('div', { class: 'adm-card' }, h('h3', null, 'New customers per day'), bars(d.series.newCustomers, 'count', { label: 'New customers' })),
        h('div', { class: 'adm-card' }, h('h3', null, 'New barbers per day'), bars(d.series.newBarbers, 'count', { label: 'New barbers' }))));
  };
  const sel = select([['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['3m', 'Last 3 months']], { 'aria-label': 'Date range' }, range);
  sel.addEventListener('change', () => { range = sel.value; sessionStorage.setItem('adm_range', range); draw(); });
  await draw();
  return h('div', null, head('Dashboard', sel), host);
}

// ---------- shared detail pieces
const bookingRow = (b) => [b.code, b.status];
async function bookingDetail(id, after) {
  const d = await A('/bookings/' + id); const b = d.booking;
  sheet('Booking ' + b.code, (close) => h('div', { class: 'adm-detail' },
    h('div', { class: 'row between' }, statusChip(b.status), h('span', { class: 'muted' }, fmtDate(b.date) + ' ' + fmtTime(b.startTime))),
    kv('Customer', b.customer?.name || ''), kv('Barber', b.barber?.name || ''), kv('Service', b.serviceName), kv('Location', [b.location?.address, b.location?.city].filter(Boolean).join(', ')),
    kv('Amount', money(b.amountKobo)), kv('Platform commission', money(b.platformFeeKobo)), kv('Barber earning', money(b.barberEarningKobo)),
    h('h3', null, 'Timeline'), ...d.events.map((e) => h('div', { class: 'muted small' }, `${fmtDateTime(e.createdAt)} · ${e.toStatus} · ${e.actorRole}${e.note ? ' · ' + e.note : ''}`)),
    d.payments.length ? h('h3', null, 'Payments') : null, ...d.payments.map((p) => h('div', { class: 'small' }, `${p.reference} · ${money(p.amountKobo)} · ${p.status}`)),
    d.refunds.length ? h('h3', null, 'Refunds') : null, ...d.refunds.map((p) => h('div', { class: 'small' }, `${p.reference} · ${money(p.amountKobo)} · ${p.status}`)),
    d.scans.length ? h('h3', null, 'QR scans') : null, ...d.scans.map((s) => h('div', { class: 'small' }, `${fmtDateTime(s.createdAt)} · ${s.result}`)),
    ['PENDING_PAYMENT', 'BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED'].includes(b.status) ? btn('Cancel booking and refund', async () => { const r = await reason('Cancel this booking?', 'Reason', 'Cancel booking'); if (!r) return; await A(`/bookings/${id}/cancel`, { method: 'POST', body: { reason: r } }); toast('Booking cancelled.', 'success'); close(); after && after(); }, 'btn sm danger') : null));
}

async function userDetail(id, after) {
  const d = await A('/users/' + id); const u = d.user;
  sheet(u.name, (close) => h('div', { class: 'adm-detail' },
    h('div', { class: 'row between' }, h('span', null, u.role), statusChip(u.status === 'active' ? 'ACTIVE' : 'SUSPENDED', u.status)),
    kv('Email', u.email), kv('Phone', u.phone), kv('Joined', fmtDateTime(u.createdAt)),
    u.status === 'active' ? btn('Suspend account', async () => { const r = await reason('Suspend ' + u.name + '?', 'Reason', 'Suspend'); if (!r) return; await A(`/users/${id}/suspend`, { method: 'POST', body: { reason: r } }); toast('Suspended.'); close(); after(); }, 'btn sm danger')
      : btn('Reactivate account', async () => { await A(`/users/${id}/reactivate`, { method: 'POST' }); toast('Reactivated.', 'success'); close(); after(); }, 'btn sm'),
    h('h3', null, 'Recent bookings'), ...(d.bookings.length ? d.bookings.slice(0, 10).map((b) => h('div', { class: 'small' }, `${b.code} · ${b.serviceName} · ${fmtDate(b.date)} · ${b.status}`)) : [h('p', { class: 'muted small' }, 'None')])));
}

async function barberDetail(id, after) {
  const d = await A('/barbers/' + id); const p = d.profile; const u = d.barber;
  const docHost = h('div');
  const showDoc = async () => { try { const url = await privateFileUrl(p.idDocumentUrl); mount(docHost, h('img', { class: 'adm-img', src: url, alt: 'Barber ID document' })); } catch (e) { toast(e.message, 'error'); } };
  sheet(u.name, (close) => h('div', { class: 'adm-detail' },
    h('div', { class: 'row between' }, statusChip(p.verificationStatus), h('span', { class: 'muted' }, p.serviceArea || '')),
    kv('Email', u.email), kv('Phone', u.phone), kv('Address', p.address || ''), kv('Experience', (p.experienceYears ?? 0) + ' years'), p.bio ? h('p', { class: 'small' }, p.bio) : null,
    kv('Bank', p.bank?.accountNumber ? `${p.bank.bankName} · ${p.bank.accountNumber} · ${p.bank.accountName}` : 'Not added'),
    kv('Wallet available', money(d.wallet.availableKobo)), kv('Total earned', money(d.wallet.totalEarningsKobo)), kv('Withdrawn', money(d.wallet.totalWithdrawnKobo)),
    p.rejectionReason ? h('p', { class: 'form-error' }, 'Last rejection: ' + p.rejectionReason) : null,
    p.idDocumentUrl ? btn('View ID document', showDoc) : h('p', { class: 'muted small' }, 'No ID document uploaded.'), docHost,
    h('div', { class: 'adm-actions' },
      p.verificationStatus !== 'VERIFIED' && p.submittedAt ? btn('Approve', async () => { await A(`/barbers/${id}/approve`, { method: 'POST' }); toast('Barber approved.', 'success'); close(); after(); }, 'btn sm') : null,
      p.verificationStatus !== 'REJECTED' && p.verificationStatus !== 'VERIFIED' ? btn('Reject', async () => { const r = await reason('Reject this barber?', 'Reason shown to the barber', 'Reject'); if (!r) return; await A(`/barbers/${id}/reject`, { method: 'POST', body: { reason: r } }); toast('Rejected.'); close(); after(); }, 'btn sm danger') : null,
      u.status === 'active' ? btn('Suspend', async () => { const r = await reason('Suspend ' + u.name + '?', 'Reason', 'Suspend'); if (!r) return; await A(`/users/${id}/suspend`, { method: 'POST', body: { reason: r } }); toast('Suspended.'); close(); after(); }, 'btn sm danger')
        : btn('Reactivate', async () => { await A(`/users/${id}/reactivate`, { method: 'POST' }); toast('Reactivated.', 'success'); close(); after(); }, 'btn sm')),
    h('h3', null, 'Recent wallet activity'), ...d.transactions.slice(0, 8).map((t) => h('div', { class: 'small' }, `${fmtDateTime(t.createdAt)} · ${t.type} · ${money(t.amountKobo)}`))));
}

// ---------- lists
const customers = () => listPage('Customers', async (s) => { const r = await A('/users', { query: q({ role: 'customer', q: s.q, status: s.status, page: s.page, limit: s.limit }) }); return { rows: r.users }; },
  (re) => [{ label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }, { label: 'Status', cell: (r) => statusChip(r.status === 'active' ? 'ACTIVE' : 'SUSPENDED', r.status) }, { label: 'Joined', cell: (r) => fmtDate(r.createdAt.slice(0, 10)) }, { label: '', cell: (r) => btn('Open', () => userDetail(r.id, re)) }],
  { filters: [{ name: 'q', label: 'Search name, email, phone' }, { name: 'status', label: 'Status', options: [['', 'All'], ['active', 'Active'], ['suspended', 'Suspended']] }] });

const barberCols = (re) => [{ label: 'Name', key: 'name' }, { label: 'Town', key: 'serviceArea' }, { label: 'Verification', cell: (r) => statusChip(r.verificationStatus) }, { label: 'Rating', cell: (r) => r.rating ? `${Number(r.rating).toFixed(1)} (${r.reviews})` : '' },
  { label: 'ID', cell: (r) => (r.hasDocument ? 'Uploaded' : 'Missing') }, { label: 'Account', cell: (r) => statusChip(r.status === 'active' ? 'ACTIVE' : 'SUSPENDED', r.status) }, { label: '', cell: (r) => btn('Open', () => barberDetail(r.id, re)) }];
const barbers = () => listPage('Barbers', async (s) => ({ rows: (await A('/barbers', { query: q({ q: s.q, status: s.status, page: s.page, limit: s.limit }) })).barbers }), barberCols,
  { filters: [{ name: 'q', label: 'Search name, email, phone' }, { name: 'status', label: 'Verification', options: statusOpts(['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED']) }] });
const verification = () => listPage('Verification queue', async (s) => ({ rows: (await A('/barbers', { query: q({ queue: 1, page: s.page, limit: s.limit }) })).barbers }), barberCols);

const bookings = () => listPage('Bookings', async (s) => ({ rows: (await A('/bookings', { query: q({ status: s.status, date: s.date, q: s.q, page: s.page, limit: s.limit }) })).bookings }),
  (re) => [{ label: 'Code', key: 'code' }, { label: 'Customer', key: 'customer' }, { label: 'Barber', key: 'barber' }, { label: 'Service', key: 'serviceName' }, { label: 'When', cell: (r) => `${fmtDate(r.date)} ${fmtTime(r.startTime)}` },
    { label: 'Amount', num: true, cell: (r) => money(r.amountKobo) }, { label: 'Payment', cell: (r) => (r.paymentStatus ? statusChip(r.paymentStatus) : '') }, { label: 'Status', cell: (r) => statusChip(r.status) }, { label: '', cell: (r) => btn('Open', () => bookingDetail(r.id, re)) }],
  { filters: [{ name: 'q', label: 'Booking code' }, { name: 'date', label: 'Date', type: 'date' }, { name: 'status', label: 'Status', options: statusOpts(['PENDING_PAYMENT', 'BARBER_PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED', 'EXPIRED']) }] });

const payments = () => listPage('Payments', async (s) => ({ rows: (await A('/payments', { query: q({ status: s.status, q: s.q, page: s.page, limit: s.limit }) })).payments }),
  (re) => [{ label: 'Reference', key: 'reference' }, { label: 'Booking', key: 'bookingCode' }, { label: 'Customer', key: 'customer' }, { label: 'Barber', key: 'barber' }, { label: 'Amount', num: true, cell: (r) => money(r.amountKobo) },
    { label: 'Provider', key: 'provider' }, { label: 'Status', cell: (r) => statusChip(r.status) }, { label: 'Date', cell: (r) => fmtDateTime(r.createdAt) },
    { label: '', cell: (r) => (r.status === 'PENDING' || r.status === 'INITIALIZED' ? btn('Reconcile', async () => { const o = await A(`/payments/${r.reference}/reconcile`, { method: 'POST' }); toast('Status: ' + (o.status || 'checked')); re(); }) : '') }],
  { filters: [{ name: 'q', label: 'Reference or booking' }, { name: 'status', label: 'Status', options: statusOpts(['PENDING', 'SUCCESSFUL', 'FAILED', 'REFUNDED']) }] });

const withdrawals = () => listPage('Withdrawals', async (s) => ({ rows: (await A('/withdrawals', { query: q({ status: s.status, page: s.page, limit: s.limit }) })).withdrawals }),
  (re) => [{ label: 'Reference', key: 'reference' }, { label: 'Barber', cell: (r) => r.barber || r.barberName || r.name || '' }, { label: 'Amount', num: true, cell: (r) => money(r.amountKobo) }, { label: 'Bank', cell: (r) => `${r.bankName} · ${r.accountNumber}` }, { label: 'Account name', key: 'accountName' },
    { label: 'Status', cell: (r) => statusChip(r.status) }, { label: 'Date', cell: (r) => fmtDateTime(r.createdAt) },
    { label: '', cell: (r) => h('div', { class: 'adm-actions' },
      r.status === 'PENDING' ? btn('Approve', async () => { await A(`/withdrawals/${r.id}/approve`, { method: 'POST' }); toast('Approved.', 'success'); re(); }, 'btn sm') : null,
      r.status === 'PROCESSING' ? btn('Mark paid out', async () => { await A(`/withdrawals/${r.id}/process`, { method: 'POST' }); toast('Payout processed.', 'success'); re(); }, 'btn sm') : null,
      r.status === 'PENDING' || r.status === 'PROCESSING' ? btn('Reject', async () => { const n = await reason('Reject withdrawal?', 'Note to the barber (funds are returned)', 'Reject'); if (!n) return; await A(`/withdrawals/${r.id}/reject`, { method: 'POST', body: { note: n } }); toast('Rejected. Funds returned.'); re(); }, 'btn sm danger') : null) }],
  { filters: [{ name: 'status', label: 'Status', options: statusOpts(['PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REJECTED']) }] });

async function services({ refresh }) {
  const { services: list } = await A('/services');
  const name = input({ placeholder: 'New service name' }), desc = input({ placeholder: 'Short description' });
  return h('div', null, head('Services'),
    h('div', { class: 'adm-card', style: { marginBottom: '14px' } }, h('div', { class: 'adm-tools' }, name, desc, btn('Add service', async () => { await A('/services', { method: 'POST', body: { name: name.value, description: desc.value } }); toast('Added.', 'success'); refresh(); }, 'btn sm'))),
    table([{ label: 'Name', key: 'name' }, { label: 'Description', key: 'description' }, { label: 'Active', cell: (r) => (r.active ? 'Yes' : 'No') },
      { label: '', cell: (r) => btn(r.active ? 'Disable' : 'Enable', async () => { await A('/services/' + r.id, { method: 'PUT', body: { active: !r.active } }); refresh(); }) }], list));
}

async function reviews({ refresh }) {
  const { reviews: list } = await A('/reviews');
  return h('div', null, head('Reviews'), table([{ label: 'Barber', key: 'barber' }, { label: 'Customer', key: 'customer' }, { label: 'Rating', key: 'rating' }, { label: 'Comment', key: 'comment' }, { label: 'Booking', key: 'bookingCode' }, { label: 'Visible', cell: (r) => (r.hidden ? 'Hidden' : 'Visible') },
    { label: '', cell: (r) => btn(r.hidden ? 'Restore' : 'Hide', async () => { await A(`/reviews/${r.id}/visibility`, { method: 'POST', body: { hidden: !r.hidden } }); refresh(); }) }], list));
}

async function disputes({ refresh }) {
  const { disputes: list } = await A('/disputes');
  const resolve = (r) => sheet('Resolve dispute ' + r.bookingCode, (close) => {
    const out = select([['dismiss', 'Dismiss dispute (no money moves)'], ['refund_customer', 'Refund the customer'], ['release_to_barber', 'Pay the barber']], {}); const note = h('textarea', { class: 'input', rows: 3, placeholder: 'Resolution note (shown to both people)' });
    return h('div', { class: 'stack' }, h('p', { class: 'muted' }, `${r.reason}: ${r.description || ''}`), field('Outcome', out), field('Note', note), btn('Resolve', async () => { await A(`/disputes/${r.id}/resolve`, { method: 'POST', body: { outcome: out.value, resolution: note.value } }); toast('Dispute resolved.', 'success'); close(); refresh(); }, 'btn red block'));
  });
  return h('div', null, head('Disputes'), table([{ label: 'Booking', key: 'bookingCode' }, { label: 'Opened by', cell: (r) => `${r.openedBy} (${r.openedByRole})` }, { label: 'Customer', key: 'customer' }, { label: 'Barber', key: 'barber' }, { label: 'Reason', key: 'reason' }, { label: 'Amount', num: true, cell: (r) => money(r.amountKobo) },
    { label: 'Status', cell: (r) => statusChip(r.status) }, { label: '', cell: (r) => (['OPEN', 'INVESTIGATING'].includes(r.status) ? h('div', { class: 'adm-actions' }, r.status === 'OPEN' ? btn('Investigate', async () => { await A(`/disputes/${r.id}/investigate`, { method: 'POST', body: {} }); refresh(); }) : null, btn('Resolve', () => resolve(r), 'btn sm')) : r.resolution || '') }], list, 'No disputes'));
}

async function support({ refresh }) {
  const { tickets } = await A('/tickets');
  const open = (t) => sheet(t.subject, (close) => { const st = select(['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'].map((s) => [s, s]), {}, t.status); const rep = h('textarea', { class: 'input', rows: 4, placeholder: 'Reply to the user' }, t.adminReply || '');
    return h('div', { class: 'stack' }, h('p', { class: 'muted small' }, `${t.user} (${t.userRole}) · ${t.category}`), h('p', null, t.description), field('Status', st), field('Reply', rep), btn('Save', async () => { await A('/tickets/' + t.id, { method: 'PUT', body: { status: st.value, reply: rep.value.trim() || undefined } }); toast('Saved.', 'success'); close(); refresh(); }, 'btn red block')); });
  return h('div', null, head('Support tickets'), table([{ label: 'Subject', key: 'subject' }, { label: 'From', cell: (r) => `${r.user} (${r.userRole})` }, { label: 'Category', key: 'category' }, { label: 'Status', cell: (r) => statusChip(r.status) }, { label: 'Date', cell: (r) => fmtDateTime(r.createdAt) }, { label: '', cell: (r) => btn('Open', () => open(r)) }], tickets, 'No tickets'));
}

async function notifications() {
  const aud = select([['all', 'Everyone'], ['customers', 'Customers'], ['barbers', 'Barbers']], {}), title = input({ placeholder: 'Title', maxlength: 80 }), msg = h('textarea', { class: 'input', rows: 3, maxlength: 300, placeholder: 'Message' }), err = h('div');
  return h('div', null, head('Notifications'), h('div', { class: 'adm-card stack', style: { maxWidth: '560px' } }, h('h3', null, 'Send an announcement'), field('Send to', aud), field('Title', title), field('Message', msg), err,
    btn('Send announcement', async () => { mount(err); try { const r = await A('/notifications/broadcast', { method: 'POST', body: { audience: aud.value, title: title.value, message: msg.value } }); toast(`Sent to ${r.sent} people.`, 'success'); title.value = msg.value = ''; } catch (e) { mount(err, formError(e.message)); } }, 'btn red')));
}

// ---------- reports (CSV built from live API data)
const csvCell = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function download(name, rows) {
  if (!rows.length) return toast('Nothing to export.');
  const cols = Object.keys(rows[0]); const text = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name }); document.body.append(a); a.click(); a.remove();
}
async function allPages(path, key, extra = {}) { let out = []; for (let p = 1; p <= 20; p++) { const r = await A(path, { query: { ...extra, page: p, limit: 100 } }); out = out.concat(r[key]); if (r[key].length < 100) break; } return out; }
async function reports() {
  const card = (title, text, fn) => h('div', { class: 'adm-card stack' }, h('h3', null, title), h('p', { class: 'muted small' }, text), btn('Download CSV', fn, 'btn sm'));
  return h('div', null, head('Reports'), h('div', { class: 'adm-grid2' },
    card('Bookings', 'Every booking with amounts and commission.', async () => download('bookings.csv', (await allPages('/bookings', 'bookings')).map((b) => ({ code: b.code, date: b.date, time: b.startTime, customer: b.customer, barber: b.barber, service: b.serviceName, status: b.status, payment: b.paymentStatus, amount_naira: b.amountKobo / 100, commission_naira: (b.platformFeeKobo || 0) / 100 })))),
    card('Payments', 'Payment references and statuses.', async () => download('payments.csv', (await allPages('/payments', 'payments')).map((p) => ({ reference: p.reference, booking: p.bookingCode, customer: p.customer, amount_naira: p.amountKobo / 100, status: p.status, provider: p.provider, created: p.createdAt })))),
    card('Withdrawals', 'Barber payout requests.', async () => download('withdrawals.csv', (await allPages('/withdrawals', 'withdrawals')).map((w) => ({ reference: w.reference, bank: w.bankName, account: w.accountNumber, account_name: w.accountName, amount_naira: w.amountKobo / 100, status: w.status, created: w.createdAt })))),
    card('Barbers', 'Barber list with verification status.', async () => download('barbers.csv', (await allPages('/barbers', 'barbers')).map((b) => ({ name: b.name, email: b.email, phone: b.phone, town: b.serviceArea, verification: b.verificationStatus, rating: b.rating, reviews: b.reviews })))),
    card('Customers', 'Customer list.', async () => download('customers.csv', (await allPages('/users', 'users', { role: 'customer' })).map((u) => ({ name: u.name, email: u.email, phone: u.phone, status: u.status, joined: u.createdAt })))),
    card('Audit log', 'Admin actions.', async () => download('audit.csv', (await allPages('/audit-logs', 'logs')).map((l) => ({ when: l.createdAt, admin: l.admin, action: l.action, entity: l.entityType, id: l.entityId, details: JSON.stringify(l.metadata) }))))));
}

async function settings() {
  const { settings: s } = await A('/settings');
  const defs = [['commission_bps', 'Platform commission (basis points, 1000 = 10%)'], ['customer_fee_kobo', 'Customer fee (kobo)'], ['min_withdrawal_kobo', 'Minimum withdrawal (kobo)'], ['cancel_free_hours', 'Free cancellation (hours before)'], ['late_cancel_refund_percent', 'Refund for late cancellation (%)'],
    ['booking_hold_minutes', 'Slot hold while paying (minutes)'], ['lead_time_minutes', 'Minimum booking notice (minutes)'], ['max_advance_days', 'Book up to (days ahead)'], ['qr_window_before_min', 'QR scan allowed before start (minutes)'], ['qr_window_after_min', 'QR scan allowed after start (minutes)']];
  const f = Object.fromEntries(defs.map(([k]) => [k, input({ type: 'number', value: s[k] })])); const err = h('div');
  return h('div', null, head('Settings'), h('div', { class: 'adm-settings' }, defs.map(([k, l]) => field(l, f[k]))), err,
    h('div', { style: { marginTop: '14px' } }, btn('Save settings', async () => { mount(err); try { await A('/settings', { method: 'PUT', body: Object.fromEntries(defs.map(([k]) => [k, Number(f[k].value)])) }); toast('Settings saved.', 'success'); } catch (e) { mount(err, formError(e.message)); } }, 'btn red')));
}

async function audit() {
  return listPage('Audit logs', async (s) => ({ rows: (await A('/audit-logs', { query: { page: s.page, limit: s.limit } })).logs }),
    () => [{ label: 'When', cell: (r) => fmtDateTime(r.createdAt) }, { label: 'Admin', key: 'admin' }, { label: 'Action', key: 'action' }, { label: 'Entity', cell: (r) => `${r.entityType || ''} ${r.entityId ?? ''}` }, { label: 'Details', cell: (r) => JSON.stringify(r.metadata) }], { pageSize: 50 });
}

export const PAGES = { dashboard, verification: async () => verification(), customers: async () => customers(), barbers: async () => barbers(), bookings: async () => bookings(), payments: async () => payments(), withdrawals: async () => withdrawals(), services, reviews, disputes, support, notifications, reports, settings, audit: async () => audit() };
