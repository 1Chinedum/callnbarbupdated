// Shared UI helpers. No framework: pages build DOM with h() and never use innerHTML with data,
// so user-provided text can never become markup (XSS-safe by construction).
import { assetUrl } from './config.js';

// ---------- DOM builder ----------
/** h('div', { class:'card', onclick: fn, 'aria-label':'x' }, 'text', childNode, [more children]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'required') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...children) => append(clear(el), children);

// ---------- icons (24px stroke set) ----------
const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  chat: 'M4 5h16v11H9l-5 4z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M17 5a3 3 0 010 6M19 15c2 .8 3 2.4 3 5',
  bell: 'M6 16v-5a6 6 0 0112 0v5l2 2H4zM10 21h4',
  pin: 'M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18h2v2h-2z',
  scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16',
  wallet: 'M3 7h16a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l2-3h12v3M16 14h3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  chevR: 'M9 5l7 7-7 7',
  chevL: 'M15 5l-7 7 7 7',
  chevD: 'M5 9l7 7 7-7',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  nav: 'M3 11l18-8-8 18-2-8z',
  scissors: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM8.1 7.9L20 20M8.1 16.1L20 4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  logout: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  alert: 'M12 4l9 16H3zM12 10v5M12 17.5v.01',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.01',
  chart: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 2v4M12 18v4M2 12h4M18 12h4',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 .5-1.5-1L15 4H9l-.5 2.5-1.5 1L5 7l-2 4 2 1v1l-2 1 2 4 2-.5 1.5 1L9 20h6l.5-2.5 1.5-1 2 .5 2-4-2-1z',
  money: 'M3 6h18v12H3zM12 15a3 3 0 100-6 3 3 0 000 6zM6 9v.01M18 15v.01',
  car: 'M5 16l1.5-6h11L19 16M3 16h18v3H3zM7 19v2M17 19v2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  refresh: 'M20 11a8 8 0 00-14.5-3.5M4 4v4h4M4 13a8 8 0 0014.5 3.5M20 20v-4h-4',
  camera: 'M4 8h3l2-3h6l2 3h3v12H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  beard: 'M5 8c0 8 2 12 7 12s7-4 7-12M9 14c1 1.2 5 1.2 6 0M12 4a3 3 0 100 .01',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 3v4M17 5h4',
  razor: 'M4 15l10-10 6 6-10 10zM14 5l6 6M7 12l5 5',
  child: 'M12 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM6 21v-3a6 6 0 0112 0v3',
};
export function icon(name, size = 22, extraClass = '') {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', name === 'starfill' ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (extraClass) svg.setAttribute('class', extraClass);
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[name === 'starfill' ? 'star' : name] || ICONS.info);
  svg.append(p);
  return svg;
}

// ---------- formatting ----------
/** Money is stored as integer kobo. Always format with these helpers. */
export const naira = (kobo) => {
  const n = Math.round(Number(kobo || 0)) / 100;
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
export const toKobo = (nairaValue) => Math.round(Number(nairaValue) * 100);
export const fmtTime = (hhmm) => {
  if (!hhmm) return '';
  const [H, M] = hhmm.split(':').map(Number);
  return `${((H + 11) % 12) + 1}:${String(M).padStart(2, '0')} ${H < 12 ? 'AM' : 'PM'}`;
};
const D = (iso) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
export const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => (iso ? D(iso).toLocaleDateString('en-NG', opts) : '');
export const fmtDateTime = (sqlTs) => {
  if (!sqlTs) return '';
  const d = new Date(String(sqlTs).replace(' ', 'T') + (String(sqlTs).includes('Z') || String(sqlTs).includes('+') ? '' : 'Z'));
  return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });
};
export const todayLagos = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export const km = (d) => (d == null ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);

// ---------- small components ----------
export function avatar(user, cls = '') {
  const img = user && (user.image || user.profile_image);
  return h('div', { class: 'avatar ' + cls }, img ? h('img', { src: assetUrl(img), alt: '', loading: 'lazy' }) : initials(user && user.name));
}
export function stars(rating, reviews) {
  const full = Math.round(rating || 0);
  return h('span', { class: 'stars', 'aria-label': `${(rating || 0).toFixed(1)} out of 5` }, '★'.repeat(full), h('span', { class: 'off' }, '★'.repeat(5 - full)),
    reviews !== undefined ? h('span', { class: 'muted small', style: { marginLeft: '6px', letterSpacing: 0 } }, `${(rating || 0).toFixed(1)} (${reviews})`) : null);
}
export const pole = (extra = '') => h('div', { class: 'pole ' + extra, role: 'presentation' });
export function spinnerBlock(label = 'Loading') {
  return h('div', { class: 'empty', role: 'status', 'aria-label': label }, h('div', { class: 'pole thick animated', style: { width: '120px' } }), h('p', { class: 'muted small' }, label + '…'));
}
export function skeleton(lines = 3, height = 18) {
  return h('div', { class: 'card stack', 'aria-busy': 'true' }, Array.from({ length: lines }, (_, i) => h('div', { class: 'skeleton', style: { height: height + 'px', width: i === 0 ? '60%' : '100%' } })));
}
export function skeletonList(n = 3) { return h('div', { class: 'stack' }, Array.from({ length: n }, () => skeleton(3))); }
export function empty(title, text, action, ico = 'calendar') {
  return h('div', { class: 'empty card flat' }, h('div', { class: 'ill' }, icon(ico, 34)), h('h3', null, title), text ? h('p', { class: 'muted' }, text) : null, action || null);
}
export function errorBox(message, retry) {
  return h('div', { class: 'empty card flat' }, h('div', { class: 'ill', style: { background: 'var(--red-bg)', color: 'var(--red)' } }, icon('alert', 34)), h('h3', null, 'Could not load this'), h('p', { class: 'muted' }, message), retry ? h('button', { class: 'btn soft', onclick: retry }, icon('refresh', 18), 'Try again') : null);
}

const CHIP = {
  PENDING_PAYMENT: ['Awaiting payment', 'amber'], CONFIRMED: ['Confirmed', 'blue'], BARBER_PENDING: ['Waiting for barber', 'amber'],
  ACCEPTED: ['Accepted', 'green'], ON_THE_WAY: ['Barber on the way', 'blue'], ARRIVED: ['Barber arrived', 'blue'], VERIFIED: ['Verified', 'green'],
  IN_PROGRESS: ['In progress', 'blue'], COMPLETED: ['Completed', 'green'], CANCELLED: ['Cancelled', 'grey'], DISPUTED: ['Disputed', 'red'], REFUNDED: ['Refunded', 'grey'],
  PENDING: ['Pending', 'amber'], SUCCESSFUL: ['Successful', 'green'], FAILED: ['Failed', 'red'], REJECTED: ['Rejected', 'red'], PROCESSING: ['Processing', 'blue'],
  VERIFIED_BARBER: ['Verified', 'green'], SUSPENDED: ['Suspended', 'red'], OPEN: ['Open', 'amber'], INVESTIGATING: ['Investigating', 'blue'], RESOLVED: ['Resolved', 'green'],
  IN_PROGRESS_TICKET: ['In progress', 'blue'], WAITING: ['Waiting', 'amber'], CLOSED: ['Closed', 'grey'], ACTIVE: ['Active', 'green'],
};
export function statusChip(status, label) {
  const [text, color] = CHIP[status] || [String(status || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()), 'grey'];
  return h('span', { class: 'chip ' + (color === 'blue' ? '' : color) }, label || text);
}
export function banner(text, kind = '', ico = 'info') { return h('div', { class: 'banner ' + kind, role: 'note' }, icon(ico, 20), h('div', null, text)); }
export const kv = (k, v, cls = '') => h('div', { class: 'kv ' + cls }, h('span', null, k), h('span', { class: 'bold', style: { textAlign: 'right' } }, v));

/** Primary button that shows a spinner and blocks double-taps while an async action runs. */
export function asyncButton(label, action, { cls = 'btn', icon: ico } = {}) {
  const b = h('button', { class: cls, type: 'button' });
  const draw = (busy) => mount(b, busy ? h('span', { class: 'spin' }) : ico ? icon(ico, 20) : null, label);
  draw(false);
  b.addEventListener('click', async () => {
    if (b.classList.contains('loading')) return;
    b.classList.add('loading'); draw(true);
    try { await action(b); } catch (e) { toast(e.message || 'Something went wrong.', 'error'); } finally { b.classList.remove('loading'); draw(false); }
  });
  return b;
}

// ---------- form field ----------
export function field(label, input, { hint, error } = {}) {
  const id = input.id || (input.id = 'f' + Math.random().toString(36).slice(2, 8));
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null, error ? h('div', { class: 'err', role: 'alert' }, error) : null);
}
export const input = (attrs) => h('input', { class: 'input', ...attrs });
export const select = (options, attrs = {}, current) => h('select', { class: 'input', ...attrs }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(current) }, t)));
export function switchRow(label, checked, onchange, hint) {
  const id = 's' + Math.random().toString(36).slice(2, 7);
  return h('div', { class: 'switch' }, h('label', { for: id }, h('div', { class: 'bold' }, label), hint ? h('div', { class: 'muted small' }, hint) : null), h('input', { id, type: 'checkbox', role: 'switch', checked, onchange: (e) => onchange(e.target.checked) }));
}
/** Show field-level errors from a thrown ApiError (details = zod issues) onto a form. */
export function formError(msg) { return h('div', { class: 'form-error', role: 'alert' }, msg); }

// ---------- toast / sheet / confirm ----------
let toastHost;
export function toast(message, kind = '') {
  if (!toastHost) { toastHost = h('div', { class: 'toast-host', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, message);
  toastHost.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 5000 : 3000);
}
/** Bottom sheet. content: Node | (close)=>Node. Returns { close }. */
export function sheet(title, content, { onClose } = {}) {
  const prevFocus = document.activeElement;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); prevFocus && prevFocus.focus && prevFocus.focus(); onClose && onClose(); };
  const esc = (e) => e.key === 'Escape' && close();
  const body = typeof content === 'function' ? content(close) : content;
  const overlay = h('div', { class: 'overlay', onclick: (e) => e.target === overlay && close() },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'grabber' }), title ? h('h2', null, title) : null, body));
  document.body.append(overlay);
  document.addEventListener('keydown', esc);
  const first = overlay.querySelector('input,select,textarea,button.btn');
  first && first.focus();
  return { close };
}
export function confirmDialog(title, text, { confirmLabel = 'Confirm', danger = false, cancelLabel = 'Go back' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    sheet(title, (close) => h('div', { class: 'stack' }, text ? h('p', { class: 'muted' }, text) : null,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => { finish(false); close(); } }, cancelLabel), h('button', { class: 'btn ' + (danger ? 'red' : ''), onclick: () => { finish(true); close(); } }, confirmLabel))), { onClose: () => finish(false) });
  });
}
/** Asks for a short text (e.g. cancellation reason). Resolves string or null. */
export function promptDialog(title, label, { confirmLabel = 'Submit', minLength = 3, placeholder = '', multiline = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    sheet(title, (close) => {
      const inp = multiline ? h('textarea', { class: 'input', placeholder }) : h('input', { class: 'input', placeholder });
      const err = h('div', { class: 'err small', role: 'alert' });
      return h('div', { class: 'stack' }, field(label, inp), err,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => { finish(null); close(); } }, 'Cancel'),
          h('button', { class: 'btn', onclick: () => { const v = inp.value.trim(); if (v.length < minLength) { err.textContent = `Please write at least ${minLength} characters.`; return; } finish(v); close(); } }, confirmLabel)));
    }, { onClose: () => finish(null) });
  });
}

// ---------- misc ----------
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export function openExternal(url) { window.open(url, '_blank', 'noopener'); }
export function callPhone(phone) { location.href = 'tel:' + phone; }
