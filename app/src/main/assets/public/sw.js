// Minimal service worker: caches the app shell for fast repeat loads. API calls are never cached.
const CACHE = 'cnb-shell-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api') || u.hostname.endsWith('openstreetmap.org')) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); if (r.ok) caches.open(CACHE).then((cc) => cc.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
