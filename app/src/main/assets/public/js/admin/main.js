// Admin dashboard shell: auth guard, sidebar, hash routing. Pages live in pages.js.
import { api, session, setUnauthorizedHandler } from '../api.js';
import { h, icon, mount, errorBox, spinnerBlock, toast } from '../ui.js';
import { loadMeta } from '../state.js';
import { PAGES } from './pages.js';

const root = document.getElementById('root');
const NAV = [
  ['dashboard', 'Dashboard', 'chart'], ['verification', 'Verification', 'shield'], ['bookings', 'Bookings', 'calendar'], ['payments', 'Payments', 'money'],
  ['withdrawals', 'Withdrawals', 'bank'], ['customers', 'Customers', 'users'], ['barbers', 'Barbers', 'scissors'], ['services', 'Services', 'list'],
  ['reviews', 'Reviews', 'star'], ['disputes', 'Disputes', 'alert'], ['support', 'Support', 'chat'], ['notifications', 'Notifications', 'bell'],
  ['reports', 'Reports', 'file'], ['settings', 'Settings', 'gear'], ['audit', 'Audit logs', 'eye'],
];

function loginView(msg) {
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', placeholder: 'Admin email' });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  const err = h('div', { class: 'form-error', role: 'alert', style: { display: msg ? '' : 'none' } }, msg || '');
  const go = async () => {
    try {
      const r = await api('/auth/login', { method: 'POST', auth: false, body: { email: email.value.trim(), password: pw.value } });
      if (r.user.role !== 'admin') throw new Error('This account is not an administrator.');
      session.set(r.token, r.user); start();
    } catch (e) { err.style.display = ''; err.textContent = e.message; }
  };
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  mount(root, h('div', { class: 'card stack adm-login' }, h('div', { class: 'adm-brand', style: { color: 'var(--navy)' } }, 'Call', h('span', null, 'N'), 'Barb Admin'),
    h('p', { class: 'muted' }, 'Sign in with an administrator account.'), email, pw, err, h('button', { class: 'btn red block', type: 'button', onclick: go }, 'Sign in')));
}

async function render() {
  const name = (location.hash.slice(2).split('/')[0]) || 'dashboard';
  const arg = location.hash.slice(2).split('/')[1];
  const page = PAGES[name] || PAGES.dashboard;
  const main = document.getElementById('adm-main'); if (!main) return;
  document.querySelectorAll('.adm-side a').forEach((a) => a.classList.toggle('on', a.dataset.k === name));
  mount(main, spinnerBlock('Loading'));
  try { mount(main, await page({ arg, go: (p) => { location.hash = '#/' + p; }, refresh: render })); }
  catch (e) { mount(main, errorBox(e.message, render)); }
  window.scrollTo(0, 0);
}

function start() {
  const u = session.user;
  if (!session.token || !u || u.role !== 'admin') return loginView();
  mount(root, h('div', { class: 'adm-shell' },
    h('nav', { class: 'adm-side', 'aria-label': 'Admin' }, h('div', { class: 'adm-brand' }, 'Call', h('span', null, 'N'), 'Barb'),
      NAV.map(([k, t, ic]) => h('a', { href: '#/' + k, 'data-k': k }, icon(ic, 18), t)), h('div', { class: 'sp' }),
      h('a', { href: '#', onclick: async (e) => { e.preventDefault(); try { await api('/auth/logout', { method: 'POST' }); } catch {} session.clear(); start(); } }, icon('logout', 18), 'Log out')),
    h('main', { class: 'adm-main', id: 'adm-main' })));
  loadMeta().catch(() => {}); render();
}

setUnauthorizedHandler(() => { session.clear(); loginView('Your session ended. Please sign in again.'); });
addEventListener('hashchange', render);
start();
