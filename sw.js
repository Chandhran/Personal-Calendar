// sw.js — minimal service worker. Enables PWA install and keeps the app
// reachable offline. Note: it does NOT enable push notifications when the
// browser is fully closed — that requires a push server, which a static
// GitHub Pages site does not have. Notifications fire while this app is
// open (foreground or backgrounded tab / installed window).

const CACHE = 'blueprint-cache-v1';
const ASSETS = [
  './', './index.html', './style.css',
  './js/model.js', './js/scheduler.js', './js/store.js',
  './js/notifications.js', './js/calendar.js', './js/app.js',
  './manifest.json', './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});
