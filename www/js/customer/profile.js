import { api, session } from '../api.js';
import { h, icon, mount, toast, sheet, confirmDialog, kv, asyncButton, empty, errorBox, skeleton } from '../ui.js';
import { addressForm } from './common.js';
import { avatarEditor, detailsForm, passwordForm, prefsForm, legalLinks, section, logoutNow } from '../account.js';

export default async function profile(ctx) {
  const user = (await api('/me/profile')).user;
  session.setUser({ ...session.user, ...user });
  const addrHost = h('div', { class: 'stack' });

  async function loadAddresses() {
    mount(addrHost, skeleton(2));
    try {
      const { addresses } = await api('/me/addresses');
      mount(addrHost,
        addresses.length ? addresses.map((a) => h('div', { class: 'card flat row', style: { alignItems: 'flex-start' } }, icon('pin', 22),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, a.label || 'Address'), h('div', { class: 'muted small' }, `${a.address}, ${a.city}`), a.landmark ? h('div', { class: 'muted xs' }, 'Near ' + a.landmark) : null),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete address ' + (a.label || a.address), onclick: async () => {
            if (!(await confirmDialog('Delete this address?', `${a.address}, ${a.city}`, { confirmLabel: 'Delete', danger: true }))) return;
            try { await api('/me/addresses/' + a.id, { method: 'DELETE' }); toast('Address deleted.'); loadAddresses(); } catch (e) { toast(e.message, 'error'); }
          } }, icon('trash', 22))))
        : empty('No saved addresses', 'Save your home or office to book faster.', null, 'pin'),
        h('button', { class: 'btn soft block', type: 'button', onclick: addAddress }, icon('plus', 20), 'Add an address'));
    } catch (e) { mount(addrHost, errorBox(e.message, loadAddresses)); }
  }
  function addAddress() {
    sheet('Add an address', (close) => {
      const form = addressForm({ showLabel: true });
      const save = asyncButton('Save address', async () => {
        const a = form.get(); if (!a) return;
        const { save: _s, ...body } = a; body.label = a.label || 'Home';
        try { await api('/me/addresses', { method: 'POST', body }); } catch (e) { toast(e.message, 'error'); return; }
        close(); toast('Address saved.', 'success'); loadAddresses();
      }, { cls: 'btn red block' });
      return h('div', { class: 'stack' }, form.node, save);
    });
  }
  loadAddresses();

  const legal = h('div'); legalLinks().then((n) => mount(legal, n));
  const root = h('div', { class: 'stack' },
    h('div', { class: 'card' }, avatarEditor(user)),
    h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('div', null, h('div', { class: 'muted small' }, 'Your referral code'), h('div', { class: 'money', style: { fontSize: '1.4rem', letterSpacing: '.08em' } }, user.referralCode || '')),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(user.referralCode); toast('Code copied.', 'success'); } catch { toast('Your code is ' + user.referralCode); } } }, 'Copy'))),
    section('Personal details', 'user', detailsForm(user), { open: true }),
    section('Saved addresses', 'pin', addrHost),
    section('Password', 'lock', passwordForm()),
    section('Notifications', 'bell', prefsForm(user)),
    section('Legal and safety', 'file', legal),
    h('button', { class: 'btn danger block', type: 'button', onclick: logoutNow }, icon('logout', 20), 'Log out'));
  return h('div', { class: 'stack' }, h('div', { class: 'page-title' }, h('h1', null, 'Profile')), root);
}
