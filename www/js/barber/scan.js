// Barber scan screen: scan the customer's QR -> review the appointment -> "Verify and complete job".
// The server decides everything (single-use token, assigned barber, status). The client only shows results.
import { api, ApiError } from '../api.js';
import { h, icon, naira, fmtDate, fmtTime, kv, mount, avatar, asyncButton, field, input, toast, banner } from '../ui.js';
import { startScanner } from '../qr.js';
import { pageHead } from './common.js';

const QR_MESSAGES = {
  QR_INVALID: ['This code cannot be used', 'It is invalid, belongs to another barber, or was already used. Ask the customer to open their appointment QR code again.'],
  QR_WRONG_BARBER: ['This code cannot be used', 'It is invalid, belongs to another barber, or was already used.'],
  QR_ALREADY_USED: ['This code cannot be used', 'It is invalid, belongs to another barber, or was already used.'],
  QR_TOO_EARLY: ['Not due yet', 'You can complete the job closer to the appointment time.'],
  QR_EXPIRED: ['This code has expired', 'Ask the customer to contact support.'],
  QR_NOT_ACCEPTED: ['Accept the booking first', 'Open the booking in the app and accept it before scanning.'],
  QR_NOT_PAID: ['Not paid yet', 'This appointment has not been paid for.'],
  QR_CANCELLED: ['This appointment was cancelled', 'No payment is due for a cancelled booking.'],
};

export default function scan(ctx) {
  const root = h('div', { class: 'stack barb-scan' });
  let scanner = null;
  let alive = true;
  ctx.onLeave(async () => { alive = false; if (scanner) await scanner.stop(); });

  const stopCamera = async () => { if (scanner) { const s = scanner; scanner = null; await s.stop(); } };

  // ---------- states
  function ready(message) {
    mount(root, pageHead('Scan to complete'),
      message ? banner(message, 'red', 'alert') : null,
      h('p', { class: 'muted' }, 'After the haircut, ask the customer to show their appointment QR code, then scan it. Scanning confirms the job and adds your earnings to your wallet.'),
      h('button', { class: 'btn red block barb-bigbtn', type: 'button', onclick: openCamera }, icon('camera', 24), 'Open camera'),
      h('div', { class: 'btn-row' },
        photoButton(),
        h('button', { class: 'btn ghost', type: 'button', onclick: manual }, icon('qr', 20), 'Type code')));
  }

  function photoButton() {
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'barb-qr-file', onchange: async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try {
        const holder = h('div', { id: 'barb-photo-holder', style: { display: 'none' } }); document.body.append(holder);
        const q = new window.Html5Qrcode('barb-photo-holder', { verbose: false });
        const text = await q.scanFile(f, false);
        holder.remove();
        lookup(text);
      } catch { ready('We could not read a QR code from that photo. Try again with a clearer, closer photo.'); }
    } });
    return h('label', { class: 'btn ghost', for: 'barb-qr-file' }, icon('image', 20), 'From photo', file);
  }

  async function openCamera() {
    mount(root, pageHead('Scan to complete'), h('div', { class: 'scanner' }, h('div', { id: 'barb-reader' })), h('p', { class: 'muted small cust-center' }, 'Point the camera at the customer\'s QR code.'),
      h('button', { class: 'btn ghost block', type: 'button', onclick: async () => { await stopCamera(); ready(); } }, 'Cancel'));
    try {
      scanner = await startScanner('barb-reader', async (text) => { await stopCamera(); if (alive) lookup(text); });
    } catch (e) { scanner = null; if (alive) ready(e.message); }
  }

  function manual() {
    const box = input({ placeholder: 'CNB1.…', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'QR code text' });
    const err = h('div');
    mount(root, pageHead('Type code'),
      h('p', { class: 'muted' }, 'Paste the code text if the camera is not working.'),
      field('Code', box), err,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => ready() }, 'Back'),
        h('button', { class: 'btn red', type: 'button', onclick: () => { const v = box.value.trim(); if (v.length < 5) return mount(err, h('div', { class: 'form-error' }, 'Enter the code first.')); lookup(v); } }, 'Find appointment')));
  }

  async function lookup(payload) {
    payload = String(payload || '').trim();
    mount(root, pageHead('Scan to complete'), h('div', { class: 'cust-center muted' }, 'Checking the code…'));
    try {
      const { booking } = await api('/qr/lookup', { method: 'POST', body: { payload } });
      if (alive) found(booking, payload);
    } catch (e) { if (alive) rejected(e); }
  }

  function rejected(e) {
    const [title, text] = QR_MESSAGES[e.code] || ['Could not check this code', e.message || 'Please try again.'];
    mount(root, pageHead('Scan to complete'),
      h('div', { class: 'card stack cust-center' },
        h('div', { class: 'empty-ill', style: { background: 'var(--red-bg)', color: 'var(--red)' } }, icon('alert', 34)),
        h('h2', null, title), h('p', { class: 'muted' }, text)),
      h('button', { class: 'btn red block', type: 'button', onclick: () => ready() }, 'Scan again'));
  }

  function found(b, payload) {
    const loc = b.location || {};
    mount(root, pageHead('Appointment found'),
      h('div', { class: 'card stack' },
        h('div', { class: 'row' }, avatar(b.customer || { name: 'Customer' }, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'bold' }, b.customer?.name || 'Customer'), h('div', { class: 'muted small' }, b.code))),
        h('hr', { class: 'divider' }),
        kv('Service', b.serviceName),
        kv('Date', fmtDate(b.date)),
        kv('Time', `${fmtTime(b.startTime)} to ${fmtTime(b.endTime)}`),
        loc.address ? kv('Location', [loc.address, loc.city].filter(Boolean).join(', ')) : null,
        h('hr', { class: 'divider' }),
        kv('You will receive', naira(b.barberEarningKobo ?? b.servicePriceKobo), 'total')),
      banner('Only complete the job if the haircut is finished. This cannot be undone.', '', 'info'),
      asyncButton('Verify and complete job', async () => {
        try {
          const r = await api('/qr/verify', { method: 'POST', body: { payload } });
          const w = await api('/barber/wallet').catch(() => null);
          if (alive) done(r.booking, w && w.wallet);
        } catch (e) { if (e instanceof ApiError) rejected(e); else toast(e.message, 'error'); }
      }, { cls: 'btn red block barb-bigbtn', icon: 'check' }),
      h('button', { class: 'btn ghost block', type: 'button', onclick: () => ready() }, 'Cancel'));
  }

  function done(b, wallet) {
    mount(root,
      h('div', { class: 'cust-center stack barb-paid' },
        h('div', { class: 'success-mark' }, icon('check', 44)),
        h('h1', null, 'Job completed'),
        h('div', { class: 'money big barb-green' }, naira(b.barberEarningKobo ?? b.servicePriceKobo)),
        h('p', { class: 'muted' }, 'has been added to your wallet.'),
        wallet ? h('p', { class: 'bold' }, 'Available balance: ' + naira(wallet.availableKobo)) : null),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn red', href: '#/b/wallet' }, icon('wallet', 20), 'Open wallet'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => ready() }, 'Scan another')));
  }

  ready();
  return root;
}
