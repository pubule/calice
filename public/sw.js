const CACHE = 'calice-shell-v73';
const SHELL_FILES = [
  '/', '/index.html', '/css/app.css',
  '/js/main.js', '/js/api-client.js', '/js/router.js', '/js/auth.js', '/js/util.js', '/js/modal.js',
  '/js/screens/home.js', '/js/screens/cellar.js', '/js/screens/add.js',
  '/js/screens/stats.js', '/js/screens/profile.js', '/js/screens/detail.js', '/js/screens/invite.js',
  '/js/screens/explore.js', '/js/data/wine-atlas.js',
  '/manifest.webmanifest', '/icon-192.png', '/icon-512.png',
];

self.addEventListener('install', (event) => {
  // skipWaiting because a new worker otherwise stays parked until every client
  // closes — and an iOS PWA launched from the Home Screen is almost never
  // really closed, so an update could sit unactivated indefinitely.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      // Take over the already-open page too, rather than only pages opened later.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache API calls
  // Network-first with cache fallback: an online user always gets the latest
  // deployed shell files (a cache-first strategy would pin whoever already
  // installed the PWA to whatever was cached at install time, forever).
  // Falling back to the cache keeps the offline-shell guarantee when the
  // network fetch fails (e.g. offline).
  //
  // fetch(event.request) is deliberately called with NO init object. Passing
  // one (this used to pass { cache: 'no-store' }) makes fetch reconstruct the
  // Request, and reconstructing a request whose mode is "navigate" throws —
  // while WebKit's support for the `cache` option in a service worker is
  // patchy on top of that. Every throw landed in the .catch() below and
  // quietly served the cached copy, so the app kept rendering whatever was
  // cached at the last install and deploys appeared to do nothing at all
  // unless CACHE was bumped. Keep this a bare fetch.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'Calice';
  const body = data.body || '';
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/icon-192.png' }));
});
