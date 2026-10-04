import { api, session, setUnauthorizedHandler } from './api.js';
import { router, homeFor } from './router.js';
import { state, loadMeta, getTown, setTown, setUnread, onStateChange } from './state.js';
import { h, icon, mount, sheet, toast, errorBox, pole } from './ui.js';
import { register as registerAuth } from './auth.js';

const root = document.getElementById('root');

const CUSTOMER_TABS = [
  ['/', 'Home', 'home'], ['/explore', 'Explore', 'search'], ['/bookings', 'Bookings', 'calendar'], ['/support', 'Support', 'chat'], ['/profile', 'Profile', 'user'],
];
const BARBER_TABS = [
  ['/b', 'Dashboard', 'home'], ['/b/bookings', 'Bookings', 'calendar'], ['/b/scan', 'Scan', 'scan'], ['/b/wallet', 'Wallet', 'wallet'], ['/b/profile', 'Profile', 'user'],
];

function tabActive(href, path, tabOverride) {
  const p = tabOverride || path;
  if (href === '/' || href === '/b') return p === href;
  return p === href || p.startsWith(href + '/');
}

function layoutHost(route, ctx) {
  const user = session.user;
  const opts = route.opts;
  const layout = opts.layout || (opts.public ? 'plain' : user && user.role === 'barber' ? 'barber' : 'customer');
  const page = h('main', { class: 'page' + (opts.tabs === false || layout === 'plain' ? ' no-tabs' : ''), id: 'main' });
  const shell = h('div', { class: 'shell' });
  let titleEl = null;

  if (layout === 'plain') {
    shell.append(pole(), page);
  } else {
    const isBarber = layout === 'barber';
    const bellHref = isBarber ? '/b/notifications' : '/notifications';
    const badge = h('span', { class: 'badge hidden', id: 'bell-badge' }, '0');
    const left = opts.back
      ? [h('button', { class: 'back', 'aria-label': 'Go back', onclick: () => (typeof opts.back === 'string' ? router.navigate(opts.back) : router.back(isBarber ? '/b' : '/')) }, icon('chevL', 26)),
         (titleEl = h('h1', { style: { fontSize: '1.2rem' } }, opts.title || ''))]
      : [h('a', { class: 'brand', href: isBarber ? '#/b' : '#/', 'aria-label': 'CallNBarb home' }, h('span', { class: 'brand-mark' }), h('span', null, 'Call', h('b', null, 'N'), 'Barb'))];
    const townBtn = !isBarber && !opts.back
      ? h('button', { class: 'town-pick', 'aria-label': 'Change town', onclick: () => pickTown() }, icon('pin', 16), h('span', { id: 'town-label' }, getTown()))
      : null;
    const bell = h('button', { class: 'icon-btn', 'aria-label': 'Notifications', onclick: () => router.navigate(bellHref) }, icon('bell', 24), badge);
    shell.append(
      h('header', { class: 'topbar' },
        h('div', { class: 'topbar-row' }, ...left, h('div', { class: 'spacer' }), townBtn, bell),
        state.meta && state.meta.paymentMode === 'demo' ? h('div', { class: 'banner info', style: { borderRadius: 0, justifyContent: 'center', padding: '4px 8px', fontSize: '.78rem' } }, 'Demo mode: payments are simulated, no real money moves') : null,
        pole()),
      page);
    const tabs = isBarber ? BARBER_TABS : CUSTOMER_TABS;
    if (opts.tabs !== false) {
      shell.append(h('nav', { class: 'tabbar', 'aria-label': 'Main' }, h('div', { class: 'tabbar-inner' },
        tabs.map(([href, label, ico]) => {
          const active = tabActive(href, ctx.path, opts.tab);
          const scan = isBarber && href === '/b/scan';
          return h('a', { class: 'tab' + (scan ? ' scan' : ''), href: '#' + href, 'aria-current': active ? 'page' : null },
            scan ? h('span', { class: 'scan-disc' }, icon('scan', 26)) : icon(ico, 24), h('span', { class: scan ? 'lbl' : '' }, label));
        }))));
    }
    refreshUnread();
  }
  root.replaceChildren(shell);
  return { page, setTitle: (t) => titleEl && (titleEl.textContent = t) };
}

async function refreshUnread() {
  if (!session.token) return;
  try {
    const r = await api('/me/notifications', { query: { limit: 1 } });
    setUnread(r.unread);
    const b = document.getElementById('bell-badge');
    if (b) { b.textContent = r.unread > 9 ? '9+' : r.unread; b.classList.toggle('hidden', !r.unread); }
  } catch {}
}

function pickTown() {
  const towns = state.meta.towns.map((t) => t.name);
  sheet('Choose your town in Delta State', (close) => h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'CallNBarb currently serves Delta State only.'),
    h('div', { class: 'col' }, towns.map((t) => h('button', { class: 'option', 'aria-pressed': t === getTown(), onclick: () => { setTown(t); close(); router.render(); } }, icon('pin', 20), h('span', { class: 'bold' }, t))))));
}

setUnauthorizedHandler(() => { toast('Your session ended. Please log in again.', 'error'); router.navigate('/login', { replace: true }); });

export async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  session.clear();
  router.navigate('/login', { replace: true });
}

async function boot() {
  try {
    await loadMeta();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'shell' }, pole(), h('div', { class: 'page no-tabs' }, errorBox(e.message, () => location.reload()), h('a', { class: 'btn ghost block', href: '#/server', style: { marginTop: '12px' } }, 'Change server address'))));
    router.add('/server', async () => (await import('./auth.js')).serverPage(), { public: true });
    router.setLayoutHost(layoutHost);
    router.start();
    return;
  }
  router.setLayoutHost(layoutHost);
  registerAuth(router);
  // Page modules are loaded lazily so a problem in one area never blocks the others.
  const mods = ['./customer/index.js', './barber/index.js'];
  for (const m of mods) {
    try { (await import(m)).register(router); } catch (e) { console.error('Failed to load', m, e); }
  }
  if (session.token) { try { const r = await api('/auth/me'); session.setUser(r.user); } catch {} }
  router.start();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.Capacitor?.isNativePlatform?.()) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
export { homeFor };
