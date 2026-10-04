import { api, session } from '../api.js';
import { h, icon, naira, empty, statusChip, skeleton } from '../ui.js';
import { livePage, apptCard, whenText } from './common.js';

const greeting = () => { const hr = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' })); return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; };

function verificationBanner(status, profile) {
  const go = (label, cls = 'btn sm') => h('a', { class: cls, href: '#/b/profile', style: { marginTop: '8px' } }, label);
  if (status === 'VERIFIED') return null;
  if (status === 'SUSPENDED') return h('div', { class: 'banner red barb-verify', role: 'alert' }, icon('alert', 20), h('div', null, h('div', { class: 'bold' }, 'Your account is suspended'), h('div', { class: 'small' }, 'You cannot get new bookings right now. Contact support to find out why.'), h('a', { class: 'btn sm ghost', href: '#/b/support', style: { marginTop: '8px' } }, 'Contact support')));
  if (status === 'REJECTED') return h('div', { class: 'banner red barb-verify', role: 'alert' }, icon('alert', 20), h('div', null, h('div', { class: 'bold' }, 'Your application was not approved'), h('div', { class: 'small' }, profile?.rejectionReason || 'Please check your details and try again.'), go('Update and resubmit', 'btn sm red')));
  if (profile && profile.submittedAt) return h('div', { class: 'banner info barb-verify', role: 'status' }, icon('shield', 20), h('div', null, h('div', { class: 'bold' }, 'Your application is being reviewed'), h('div', { class: 'small' }, 'We will tell you as soon as you are approved. This usually takes a day.')));
  return h('div', { class: 'banner barb-verify', role: 'status' }, icon('info', 20), h('div', null, h('div', { class: 'bold' }, 'Finish your profile to start getting bookings'), h('div', { class: 'small' }, 'Add your ID, bank details, services and hours, then submit for review.'), go('Finish my profile', 'btn sm')));
}

function stat(label, value, { href, ico, tone } = {}) {
  const inner = [h('div', { class: 'barb-stat-ico' }, icon(ico || 'chart', 18)), h('div', { class: 'barb-stat-val money' }, value), h('div', { class: 'muted small' }, label)];
  return href ? h('a', { class: 'card tight barb-stat ' + (tone || ''), href }, inner) : h('div', { class: 'card tight barb-stat ' + (tone || '') }, inner);
}

const section = (title, count, ...body) => h('section', { class: 'stack', 'aria-label': title },
  h('div', { class: 'row between' }, h('h2', { class: 'barb-h2' }, title), count != null ? h('span', { class: 'chip' + (count ? ' amber' : ' grey') }, count) : null), ...body);

export default function dashboard(ctx) {
  const skel = h('div', { class: 'stack' }, h('div', { class: 'skeleton', style: { height: '56px' } }), h('div', { class: 'grid2' }, Array.from({ length: 4 }, () => skeleton(2, 22))), skeleton(4));
  const page = livePage(ctx, {
    pollMs: 20000, skeleton: skel,
    load: async () => { const [d, p] = await Promise.all([api('/barber/dashboard'), api('/barber/profile')]); return { d, p: p.profile }; },
    render: ({ d, p }, refresh) => {
      const onChange = () => refresh({ silent: 'toast', force: true });
      const todayIds = new Set(d.todays.map((b) => b.id));
      const todays = d.todays.filter((b) => b.status !== 'BARBER_PENDING');
      const upcoming = d.upcoming.filter((b) => !todayIds.has(b.id));
      const first = (session.user?.name || p.name || '').split(' ')[0];
      return [
        h('div', { class: 'row between' },
          h('div', null, h('p', { class: 'muted small' }, greeting()), h('h1', { class: 'barb-h1' }, first ? first : 'Welcome')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Refresh dashboard', onclick: async (e) => { const b = e.currentTarget; b.classList.add('barb-spin'); await refresh({ silent: 'toast', force: true }); b.classList.remove('barb-spin'); } }, icon('refresh', 22))),
        verificationBanner(d.verificationStatus, p),
        h('div', { class: 'grid2 barb-stats' },
          stat("Today's appointments", d.todaysAppointments, { ico: 'calendar', href: '#/b/bookings' }),
          stat('Pending requests', d.pendingRequests, { ico: 'bell', tone: d.pendingRequests ? 'alert' : '' }),
          stat("Today's earnings", naira(d.todaysEarningsKobo), { ico: 'money', tone: 'money-tone' }),
          stat('Total earnings', naira(d.totalEarningsKobo), { ico: 'chart' }),
          stat('Wallet balance', naira(d.walletBalanceKobo), { ico: 'wallet', href: '#/b/wallet', tone: 'money-tone' }),
          stat('Completed jobs', d.completedJobs, { ico: 'check' }),
          stat('Rating', d.reviews ? `${(d.rating || 0).toFixed(1)} ★` : 'New', { ico: 'star' }),
          d.reviews ? stat('Reviews', d.reviews, { ico: 'chat' }) : null),
        section('Pending requests', d.pending.length,
          d.pending.length ? d.pending.map((b) => apptCard(b, { onChange })) : empty('No new booking requests.', 'New requests appear here as soon as a customer books and pays. Keep your hours up to date.', h('a', { class: 'btn soft', href: '#/b/profile' }, 'Check my working hours'), 'bell')),
        section("Today's appointments", todays.length,
          todays.length ? todays.map((b) => apptCard(b, { onChange })) : empty('Nothing scheduled for today', 'Accepted jobs for today will show here.', null, 'calendar')),
        section('Upcoming', upcoming.length,
          upcoming.length ? upcoming.map((b) => apptCard(b, { onChange })) : empty('No upcoming appointments', 'Accepted bookings on later days will show here.', null, 'clock')),
      ];
    },
  });
  return page.root;
}
