// Account pieces shared by the customer and barber apps: avatar, password, notification settings,
// legal links, log out, notification inbox and the support centre.
import { api, session, uploadFile } from './api.js';
import { router } from './router.js';
import { h, icon, avatar, field, input, select, switchRow, mount, toast, asyncButton, formError, empty, errorBox, skeletonList, statusChip, fmtDateTime, banner, statusChip as chip } from './ui.js';

export async function logoutNow() {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  session.clear();
  router.navigate('/login', { replace: true });
}

export function avatarEditor(user, onChange) {
  const holder = h('div');
  const draw = (u) => mount(holder, h('div', { class: 'row' }, avatar(u, 'lg'),
    h('div', { class: 'grow' }, h('div', { class: 'bold', style: { fontSize: '1.15rem' } }, u.name), h('div', { class: 'muted small' }, u.email),
      h('label', { class: 'btn sm ghost', for: 'acct-avatar', style: { marginTop: '8px' } }, icon('camera', 18), 'Change photo'))));
  draw(user);
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'acct-avatar', class: 'sr-only', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const up = await uploadFile(f, 'avatar');
      const r = await api('/me/profile', { method: 'PUT', body: { image: up.url } });
      session.setUser({ ...session.user, ...r.user }); draw(r.user); onChange && onChange(r.user); toast('Photo updated.', 'success');
    } catch (er) { toast(er.message, 'error'); }
  } });
  return h('div', null, holder, file);
}

export function detailsForm(user, onSaved) {
  const f = { name: input({ value: user.name, autocomplete: 'name' }), email: input({ type: 'email', value: user.email }), phone: input({ type: 'tel', value: user.phone }) };
  const err = h('div');
  const save = asyncButton('Save changes', async () => {
    mount(err);
    try {
      const r = await api('/me/profile', { method: 'PUT', body: { name: f.name.value, email: f.email.value, phone: f.phone.value } });
      session.setUser({ ...session.user, ...r.user }); toast('Saved.', 'success'); onSaved && onSaved(r.user);
    } catch (e) { mount(err, formError(e.message)); }
  }, { cls: 'btn block' });
  return h('div', { class: 'stack' }, field('Full name', f.name), field('Email', f.email), field('Phone number', f.phone), err, save);
}

export function passwordForm() {
  const f = { cur: input({ type: 'password', autocomplete: 'current-password' }), next: input({ type: 'password', autocomplete: 'new-password' }) };
  const err = h('div');
  const save = asyncButton('Change password', async () => {
    mount(err);
    try { await api('/auth/change-password', { method: 'POST', body: { currentPassword: f.cur.value, newPassword: f.next.value } }); f.cur.value = f.next.value = ''; toast('Password changed.', 'success'); }
    catch (e) { mount(err, formError(e.message)); }
  }, { cls: 'btn block' });
  return h('div', { class: 'stack' }, field('Current password', f.cur), field('New password', f.next, { hint: 'At least 8 characters' }), err, save);
}

export function prefsForm(user) {
  const p = { inapp: true, email: true, sms: false, push: true, ...(user.notifyPrefs || {}) };
  const save = async () => { try { await api('/me/notification-prefs', { method: 'PUT', body: { inapp: true, email: p.email, sms: p.sms, push: p.push } }); toast('Notification settings saved.', 'success'); } catch (e) { toast(e.message, 'error'); } };
  return h('div', null,
    h('div', { class: 'switch' }, h('div', null, h('div', { class: 'bold' }, 'In-app notifications'), h('div', { class: 'muted small' }, 'Always on so you never miss a booking update.')), h('span', { class: 'chip green' }, 'On')),
    switchRow('Email', p.email, (v) => { p.email = v; save(); }), switchRow('SMS', p.sms, (v) => { p.sms = v; save(); }), switchRow('Push notifications', p.push, (v) => { p.push = v; save(); }));
}

export async function legalLinks() {
  let pages = [];
  try { pages = (await api('/legal', { auth: false })).pages; } catch {}
  return h('div', { class: 'list' }, pages.map((p) => h('a', { class: 'list-item', href: '#/legal/' + p.slug }, icon('file', 20), h('span', { class: 'grow bold' }, p.title), icon('chevR', 18))));
}

/** Collapsible settings card. */
export function section(title, ico, body, { open = false } = {}) {
  const d = h('details', { class: 'card acct-sec' }, h('summary', null, icon(ico, 22), h('span', { class: 'grow bold' }, title), icon('chevD', 18)), h('div', { class: 'acct-body stack' }, body));
  if (open) d.open = true;
  return d;
}

// ---------------- notification inbox ----------------
export function inboxPage(ctx, { bookingPath }) {
  const root = h('div', { class: 'stack' });
  let alive = true; ctx.onLeave(() => { alive = false; });
  async function load() {
    mount(root, skeletonList(4));
    try {
      const r = await api('/me/notifications', { query: { limit: 50 } });
      if (!alive) return;
      const open = async (n) => {
        if (!n.readAt) { try { await api(`/me/notifications/${n.id}/read`, { method: 'POST' }); } catch {} }
        if (n.data && n.data.bookingId) router.navigate(bookingPath + n.data.bookingId); else load();
      };
      mount(root,
        h('div', { class: 'row between' }, h('h2', null, r.unread ? `${r.unread} unread` : 'All caught up'), r.unread ? h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { await api('/me/notifications/read-all', { method: 'POST' }); load(); } }, 'Mark all as read') : null),
        r.notifications.length
          ? h('div', { class: 'card' }, r.notifications.map((n) => h('button', { class: 'list-item acct-notif' + (n.readAt ? '' : ' unread'), type: 'button', onclick: () => open(n) },
              h('span', { class: 'acct-dot' }), h('div', { class: 'grow' }, h('div', { class: 'bold' }, n.title), h('div', { class: 'small' }, n.message), h('div', { class: 'muted xs' }, fmtDateTime(n.createdAt))), n.data && n.data.bookingId ? icon('chevR', 18) : null)))
          : empty('No notifications yet', 'Booking updates and payment confirmations show up here.', null, 'bell'));
    } catch (e) { if (alive) mount(root, errorBox(e.message, load)); }
  }
  load();
  return root;
}

// ---------------- support centre ----------------
const DEFAULT_CATEGORIES = ['Payment issue', 'Booking issue', 'Barber issue', 'Customer issue', 'Refund', 'Withdrawal', 'Technical problem', 'Other'];
export function supportPage(ctx, { bookingsEndpoint }) {
  const root = h('div', { class: 'stack' });
  let alive = true; ctx.onLeave(() => { alive = false; });
  let showForm = ctx.query.new === '1';
  async function load() {
    mount(root, skeletonList(3));
    try {
      const [t, d, c, bk] = await Promise.all([api('/me/support/tickets'), api('/me/disputes'), api('/me/support/categories'), api(bookingsEndpoint).catch(() => ({ bookings: [] }))]);
      if (!alive) return;
      draw(t.tickets, d.disputes, c.categories || DEFAULT_CATEGORIES, bk.bookings);
    } catch (e) { if (alive) mount(root, errorBox(e.message, load)); }
  }
  function form(categories, bookings) {
    const cat = select(categories.map((x) => [x, x]), {}, ctx.query.barber ? 'Barber issue' : 'Booking issue');
    const subject = input({ placeholder: 'Short summary', maxlength: 120, value: ctx.query.barber ? 'Question about ' + ctx.query.barber : '' });
    const desc = h('textarea', { class: 'input', placeholder: 'Tell us what happened (at least 10 characters)', maxlength: 2000 });
    const bk = select([['', 'Not about a specific booking'], ...bookings.map((b) => [b.id, `${b.code} · ${b.serviceName}`])], {});
    let attachment = null; const lbl = h('span', { class: 'muted small' }, 'No file added');
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,application/pdf', id: 'sup-file', class: 'sr-only', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { lbl.textContent = 'Uploading…'; attachment = (await uploadFile(f, 'evidence')).url; lbl.textContent = 'Added: ' + f.name; } catch (er) { attachment = null; lbl.textContent = er.message; } } });
    const err = h('div');
    const send = asyncButton('Send request', async () => {
      mount(err);
      try {
        await api('/me/support/tickets', { method: 'POST', body: { category: cat.value, subject: subject.value, description: desc.value, bookingId: bk.value ? Number(bk.value) : undefined, attachment: attachment || undefined } });
      } catch (e) { mount(err, formError(e.message)); return; }
      showForm = false; toast('Request sent. We will reply here.', 'success'); load();
    }, { cls: 'btn red block' });
    return h('div', { class: 'card stack' }, h('h2', null, 'New request'), field('Topic', cat), field('Subject', subject), field('Booking (optional)', bk), field('Details', desc),
      h('div', { class: 'row' }, h('label', { class: 'btn sm ghost', for: 'sup-file' }, icon('upload', 18), 'Attach a file'), lbl), file, err, h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => { showForm = false; load(); } }, 'Cancel'), send));
  }
  function draw(tickets, disputes, categories, bookings) {
    mount(root,
      h('div', { class: 'page-title' }, h('h1', null, 'Support')),
      showForm ? form(categories, bookings) : h('button', { class: 'btn red block', type: 'button', onclick: () => { showForm = true; load(); } }, icon('plus', 20), 'New request'),
      h('section', { class: 'stack' }, h('h2', null, 'My requests'),
        tickets.length ? tickets.map((t) => h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('div', { class: 'bold' }, t.subject), statusChip(t.status === 'IN_PROGRESS' ? 'IN_PROGRESS_TICKET' : t.status)), h('div', { class: 'muted small' }, `${t.category} · ${fmtDateTime(t.createdAt)}`), h('p', { class: 'small' }, t.description),
          t.adminReply ? h('div', { class: 'banner info' }, icon('chat', 20), h('div', null, h('div', { class: 'bold' }, 'Reply from CallNBarb'), h('div', null, t.adminReply))) : null))
          : empty('No requests yet', 'If something goes wrong with a booking or payment, tell us here.', null, 'chat')),
      disputes.length ? h('section', { class: 'stack' }, h('h2', null, 'Reported problems'), disputes.map((d) => h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('div', { class: 'bold' }, d.reason), statusChip(d.status)), h('p', { class: 'small' }, d.description), d.resolution ? banner('Resolution: ' + d.resolution, 'green', 'check') : null))) : null);
  }
  load();
  return root;
}
