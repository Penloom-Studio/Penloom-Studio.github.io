// Forge Log service worker — precaches the whole shell so the app opens
// and logs with no signal. Cache-first for the shell, network passthrough
// (with cache fallback) for the Open Food Facts lookups.
const CACHE = 'forge-log-v1';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './logic.mjs',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isShell = url.origin === self.location.origin;

  if (isShell) {
    // Cache-first for our own shell: works with zero signal.
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // Barcode lookups (Open Food Facts): network-first, cache fallback so a
  // previously-scanned item still resolves offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
