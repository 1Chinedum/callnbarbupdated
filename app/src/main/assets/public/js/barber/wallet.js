// Barber wallet: balances, ledger and withdrawals. All numbers come from the server ledger.
import { api } from '../api.js';
import { h, icon, naira, toKobo, fmtDateTime, statusChip, empty, field, input, sheet, formError, mount, toast, asyncButton, banner, skeleton } from '../ui.js';
import { state } from '../state.js';
import { livePage, pageHead } from './common.js';

const TYPE_LABEL = { EARNING: 'Job earning', WITHDRAWAL: 'Withdrawal', REVERSAL: 'Withdrawal returned', ADJUSTMENT: 'Adjustment', REFUND: 'Refund', COMMISSION: 'Commission' };

function balanceCard(w) {
  return h('div', { class: 'card barb-earn stack' },
    h('div', { class: 'muted small' }, 'Available to withdraw'),
    h('div', { class: 'money big barb-green' }, naira(w.availableKobo)),
    h('div', { class: 'grid2' },
      h('div', null, h('div', { class: 'muted xs' }, 'Pending jobs'), h('div', { class: 'bold money' }, naira(w.pendingKobo))),
      h('div', null, h('div', { class: 'muted xs' }, 'Total earned'), h('div', { class: 'bold money' }, naira(w.totalEarningsKobo))),
      h('div', null, h('div', { class: 'muted xs' }, 'Withdrawn'), h('div', { class: 'bold money' }, naira(w.totalWithdrawnKobo))),
      h('div', null, h('div', { class: 'muted xs' }, 'In progress'), h('div', { class: 'bold money' }, naira(w.withdrawalsInProgressKobo)))),
    h('p', { class: 'muted xs' }, 'Pending jobs are paid into your wallet when the customer\'s QR code is scanned.'));
}

function withdrawSheet(w, onDone) {
  const min = state.meta?.rules?.minWithdrawalKobo || 0;
  const amt = input({ type: 'number', inputmode: 'decimal', min: String(min / 100), step: '1', placeholder: 'Amount in naira' });
  const err = h('div');
  const body = h('div', { class: 'stack' },
    h('p', { class: 'muted' }, `Available: ${naira(w.availableKobo)}. Minimum withdrawal: ${naira(min)}. Money goes to the bank account in your profile.`),
    field('Amount (₦)', amt), err,
    h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { amt.value = String(w.availableKobo / 100); } }, 'Withdraw everything'),
    asyncButton('Request withdrawal', async () => {
      mount(err);
      const kobo = toKobo(amt.value);
      if (!kobo || kobo < min) return mount(err, formError(`Enter at least ${naira(min)}.`));
      if (kobo > w.availableKobo) return mount(err, formError('That is more than your available balance.'));
      try { await api('/barber/withdrawals', { method: 'POST', body: { amountKobo: kobo } }); s.close(); toast('Withdrawal requested. We will review it shortly.', 'success'); onDone(); }
      catch (e) { mount(err, formError(e.message)); if (e.code === 'NO_BANK_DETAILS') mount(err, formError(e.message), h('a', { class: 'btn sm', href: '#/b/profile' }, 'Add bank details')); }
    }, { cls: 'btn red block' }));
  const s = sheet('Withdraw money', body);
}

export default function wallet(ctx) {
  const page = livePage(ctx, {
    pollMs: 30000,
    skeleton: h('div', { class: 'stack' }, skeleton(5, 24), skeleton(4)),
    load: async () => {
      const [w, t, wd] = await Promise.all([api('/barber/wallet'), api('/barber/wallet/transactions'), api('/barber/withdrawals')]);
      return { w: w.wallet, tx: t.transactions, wd: wd.withdrawals };
    },
    render: ({ w, tx, wd }, refresh) => {
      const again = () => refresh({ silent: 'toast', force: true });
      return [
        pageHead('Wallet'),
        balanceCard(w),
        h('button', { class: 'btn red block', type: 'button', disabled: w.availableKobo <= 0, onclick: () => withdrawSheet(w, again) }, icon('bank', 20), 'Withdraw'),
        wd.length ? h('section', { class: 'stack' }, h('h2', { class: 'barb-h2' }, 'Withdrawals'),
          wd.map((x) => h('div', { class: 'card tight row' }, h('div', { class: 'grow' }, h('div', { class: 'bold money' }, naira(x.amountKobo)), h('div', { class: 'muted xs' }, `${x.bankName} · ${fmtDateTime(x.createdAt)}`), x.note ? h('div', { class: 'muted xs' }, x.note) : null), statusChip(x.status)))) : null,
        h('section', { class: 'stack' }, h('h2', { class: 'barb-h2' }, 'Transactions'),
          tx.length ? tx.map((x) => h('div', { class: 'card tight row' },
            h('div', { class: 'grow' }, h('div', { class: 'bold' }, TYPE_LABEL[x.type] || x.type), h('div', { class: 'muted xs' }, [x.bookingCode, fmtDateTime(x.createdAt)].filter(Boolean).join(' · ')),
              h('div', { class: 'muted xs' }, 'Balance ' + naira(x.balanceAfterKobo))),
            h('div', { class: 'bold money ' + (x.amountKobo >= 0 ? 'barb-green' : '') }, (x.amountKobo >= 0 ? '+' : '') + naira(x.amountKobo))))
            : empty('No transactions yet', 'Complete a job by scanning the customer\'s QR code and your earnings appear here.', h('a', { class: 'btn', href: '#/b/scan' }, 'Scan a QR code'), 'wallet')),
      ];
    },
  });
  return page.root;
}
