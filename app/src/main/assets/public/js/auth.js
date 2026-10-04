import { api, session } from './api.js';
import { apiBase, setApiBase, isNative } from './config.js';
import { router, homeFor } from './router.js';
import { h, icon, field, input, asyncButton, formError, mount, pole, toast, banner } from './ui.js';

function authFrame(title, subtitle, ...body) {
  return h('div', { class: 'stack' },
    h('div', { class: 'hero', style: { padding: '26px 22px' } },
      h('div', { class: 'brand', style: { color: '#fff', marginBottom: '14px' } }, h('span', { class: 'brand-mark', style: { borderColor: '#fff' } }), h('span', null, 'Call', h('b', { style: { color: '#ff7b74' } }, 'N'), 'Barb')),
      h('h1', { style: { fontSize: '1.9rem' } }, title), subtitle ? h('p', null, subtitle) : null, h('div', { class: 'pole' })),
    ...body);
}

function loginPage() {
  const err = h('div');
  const email = input({ type: 'email', autocomplete: 'email', placeholder: 'you@example.com', inputmode: 'email' });
  const pass = input({ type: 'password', autocomplete: 'current-password', placeholder: 'Your password' });
  const go = asyncButton('Log in', async () => {
    mount(err);
    if (!email.value || !pass.value) { mount(err, formError('Enter your email and password.')); return; }
    try {
      const r = await api('/auth/login', { method: 'POST', auth: false, body: { email: email.value, password: pass.value } });
      session.set(r.token, r.user);
      if (r.user.role === 'admin') { location.href = 'admin.html'; return; }
      router.navigate(homeFor(r.user));
    } catch (e) { mount(err, formError(e.message)); }
  }, { cls: 'btn red block' });
  const form = h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); go.click(); } },
    field('Email', email), field('Password', pass), err, go,
    h('a', { href: '#/forgot', class: 'small bold' }, 'Forgot password?'));
  return authFrame('Call a Barber. Get Fresh.', 'Professional barbers who come to you, anywhere in Delta State.',
    h('div', { class: 'card stack' }, form),
    h('p', { class: 'center', style: { textAlign: 'center' } }, 'New here? ', h('a', { href: '#/register', class: 'bold' }, 'Create an account')),
    isNative() ? h('p', { style: { textAlign: 'center' } }, h('a', { href: '#/server', class: 'small muted' }, 'Server: ' + apiBase())) : null);
}

function registerPage() {
  let role = 'customer';
  const err = h('div');
  const f = {
    name: input({ autocomplete: 'name', placeholder: 'Your full name' }),
    email: input({ type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'you@example.com' }),
    phone: input({ type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '0803 123 4567' }),
    pass: input({ type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' }),
    pass2: input({ type: 'password', autocomplete: 'new-password', placeholder: 'Repeat password' }),
    ref: input({ placeholder: 'Optional', style: { textTransform: 'uppercase' } }),
  };
  const roleSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'I am a', style: { width: '100%' } });
  const noteBox = h('div');
  const draw = () => {
    mount(roleSeg, [['customer', 'I need a barber'], ['barber', 'I am a barber']].map(([v, t]) => h('button', { type: 'button', style: { flex: 1 }, 'aria-pressed': role === v, onclick: () => { role = v; draw(); } }, t)));
    mount(noteBox, role === 'barber' ? banner('Barbers are checked before going live. After signing up you will add your ID, bank details and services for admin approval.', 'info', 'shield') : null);
  };
  draw();
  const go = asyncButton('Create account', async () => {
    mount(err);
    try {
      const r = await api('/auth/register', { method: 'POST', auth: false, body: { name: f.name.value, email: f.email.value, phone: f.phone.value, password: f.pass.value, confirmPassword: f.pass2.value, role, referralCode: f.ref.value || undefined } });
      session.set(r.token, r.user);
      toast('Welcome to CallNBarb!', 'success');
      router.navigate(r.user.role === 'barber' ? '/b/profile' : '/');
    } catch (e) { mount(err, formError(e.message)); }
  }, { cls: 'btn red block' });
  return authFrame('Create your account', 'Takes a minute. Delta State only for now.',
    h('form', { class: 'card stack', onsubmit: (e) => { e.preventDefault(); go.click(); } },
      roleSeg, noteBox,
      field('Full name', f.name), field('Email', f.email), field('Phone number', f.phone, { hint: 'Nigerian number, e.g. 0803 123 4567' }),
      field('Password', f.pass), field('Confirm password', f.pass2), field('Referral code', f.ref), err, go,
      h('p', { class: 'xs muted' }, 'By creating an account you agree to our ', h('a', { href: '#/legal/terms' }, 'Terms'), ' and ', h('a', { href: '#/legal/privacy' }, 'Privacy Policy'), '.')),
    h('p', { style: { textAlign: 'center' } }, 'Already registered? ', h('a', { href: '#/login', class: 'bold' }, 'Log in')));
}

function forgotPage() {
  const email = input({ type: 'email', placeholder: 'you@example.com', inputmode: 'email' });
  const out = h('div');
  const go = asyncButton('Send reset link', async () => {
    mount(out);
    try {
      const r = await api('/auth/forgot-password', { method: 'POST', auth: false, body: { email: email.value } });
      mount(out, banner(r.message, 'green', 'check'));
      if (r.devResetToken) mount(out, banner(r.message, 'green', 'check'), h('a', { class: 'btn soft block', style: { marginTop: '10px' }, href: '#/reset?token=' + r.devResetToken }, 'Development only: open reset screen'));
    } catch (e) { mount(out, formError(e.message)); }
  }, { cls: 'btn block' });
  return authFrame('Reset your password', 'We will email you a link if the address is registered.',
    h('form', { class: 'card stack', onsubmit: (e) => { e.preventDefault(); go.click(); } }, field('Email', email), out, go),
    h('p', { style: { textAlign: 'center' } }, h('a', { href: '#/login', class: 'bold' }, 'Back to log in')));
}

function resetPage(ctx) {
  const pass = input({ type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
  const out = h('div');
  const go = asyncButton('Set new password', async () => {
    mount(out);
    try {
      await api('/auth/reset-password', { method: 'POST', auth: false, body: { token: ctx.query.token || '', newPassword: pass.value } });
      toast('Password updated. Log in with your new password.', 'success');
      router.navigate('/login');
    } catch (e) { mount(out, formError(e.message)); }
  }, { cls: 'btn red block' });
  return authFrame('Choose a new password', null, h('form', { class: 'card stack', onsubmit: (e) => { e.preventDefault(); go.click(); } }, field('New password', pass), out, go));
}

async function legalPage(ctx) {
  const doc = await api('/legal/' + ctx.params.slug, { auth: false });
  const pages = (await api('/legal', { auth: false })).pages;
  return h('div', { class: 'stack' },
    h('div', { class: 'page-title' }, h('button', { class: 'back', 'aria-label': 'Go back', onclick: () => router.back('/login') }, icon('chevL', 26)), h('h1', null, doc.title)),
    h('div', { class: 'card stack' }, doc.body.map((p, i) => h('p', { class: i === 0 && /DRAFT/.test(p) ? 'banner' : '' }, p))),
    h('div', { class: 'card flat' }, pages.map((p) => h('a', { class: 'list-item', href: '#/legal/' + p.slug }, h('span', { class: 'grow bold' }, p.title), icon('chevR', 18)))));
}

export function serverPage() {
  const url = input({ type: 'url', value: apiBase(), placeholder: 'http://10.0.2.2:4000', inputmode: 'url' });
  return authFrame('Server address', 'Where the CallNBarb server runs. Use http://10.0.2.2:4000 in the Android emulator, or your deployed https address.',
    h('div', { class: 'card stack' }, field('API address', url),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onclick: () => { setApiBase(''); location.hash = '#/login'; location.reload(); } }, 'Reset'),
        h('button', { class: 'btn', onclick: () => { setApiBase(url.value); location.hash = '#/login'; location.reload(); } }, 'Save'))));
}

function adminNote() {
  return authFrame('Admin dashboard', 'The admin dashboard is a desktop web page.', h('div', { class: 'card stack' }, h('a', { class: 'btn block', href: 'admin.html' }, 'Open admin dashboard'), h('button', { class: 'btn ghost block', onclick: () => { session.clear(); router.navigate('/login'); } }, 'Log out')));
}

export function register(r) {
  r.add('/login', loginPage, { public: true, guestOnly: true });
  r.add('/register', registerPage, { public: true, guestOnly: true });
  r.add('/forgot', forgotPage, { public: true });
  r.add('/reset', resetPage, { public: true });
  r.add('/legal/:slug', legalPage, { public: true });
  r.add('/server', serverPage, { public: true });
  r.add('/admin-note', adminNote, {});
}
