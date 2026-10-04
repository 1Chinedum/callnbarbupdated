// Tiny hash router. Pages register with router.add(pattern, handler, opts).
//   pattern: '/barber/:id'   handler(ctx) -> Node | Promise<Node>
//   ctx: { params, query, user, onLeave(fn), setTitle(text), reload() }
//   opts: { roles:['customer'], public:true, layout:'customer'|'barber'|'plain', title:'Text', back:true|'/path', tabs:false }
import { session } from './api.js';
import { errorBox, mount, spinnerBlock } from './ui.js';

const routes = [];
let layoutHost = null; // set by app.js: (route, ctx) => { page: HTMLElement, setTitle(fn) }
let leaveFns = [];
let renderToken = 0;

export const router = {
  add(pattern, handler, opts = {}) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:[\w]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
    routes.push({ pattern, rx, keys, handler, opts });
  },
  setLayoutHost(fn) { layoutHost = fn; },
  navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState(null, '', '#' + path); else if (location.hash !== '#' + path) location.hash = path;
    if (replace) router.render();
  },
  back(fallback = '/') { if (history.length > 1) history.back(); else router.navigate(fallback); },
  start() { addEventListener('hashchange', () => router.render()); router.render(); },
  currentPath() { return (location.hash.slice(1) || '/').split('?')[0]; },
  render,
};

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function homeFor(user) { return !user ? '/login' : user.role === 'barber' ? '/b' : user.role === 'admin' ? '/admin-note' : '/'; }

async function render() {
  const token = ++renderToken;
  leaveFns.forEach((fn) => { try { fn(); } catch {} });
  leaveFns = [];
  const { path, query } = parseHash();
  const user = session.user;
  let match = null;
  for (const r of routes) {
    const m = r.rx.exec(path);
    if (m) { match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; }
  }
  if (!match) return router.navigate(homeFor(user), { replace: true });
  const { r, params } = match;
  if (!r.opts.public && !session.token) return router.navigate('/login', { replace: true });
  if (r.opts.roles && user && !r.opts.roles.includes(user.role)) return router.navigate(homeFor(user), { replace: true });
  if (r.opts.guestOnly && session.token && user) return router.navigate(homeFor(user), { replace: true });

  const ctx = {
    params, query, user, path,
    onLeave: (fn) => leaveFns.push(fn),
    setTitle: (t) => host.setTitle && host.setTitle(t),
    reload: () => token === renderToken && render(),
  };
  const host = layoutHost(r, ctx);
  mount(host.page, spinnerBlock());
  window.scrollTo(0, 0);
  try {
    const node = await r.handler(ctx);
    if (token !== renderToken) return; // user navigated away while loading
    mount(host.page, node);
  } catch (e) {
    if (token !== renderToken) return;
    mount(host.page, errorBox(e.message || 'Something went wrong.', () => render()));
  }
}
