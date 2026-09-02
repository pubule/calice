const CACHE = 'calice-shell-v1';
const SHELL_FILES = [
  '/', '/index.html', '/css/app.css',
  '/js/main.js', '/js/api-client.js', '/js/router.js', '/js/auth.js', '/js/util.js',
  '/js/screens/home.js', '/js/screens/cellar.js', '/js/screens/add.js',
  '/js/screens/stats.js', '/js/screens/profile.js', '/js/screens/detail.js', '/js/screens/invite.js',
  '/manifest.webmanifest', '/icon-192.png', '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache API calls
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
