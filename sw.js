// sw.js — minimal service worker. Enables PWA install and keeps the app
// reachable offline. Note: it does NOT enable push notifications when the
// browser is fully closed — that requires a push server, which a static
// GitHub Pages site does not have. Notifications fire while this app is
// open (foreground or backgrounded tab / installed window).
//
// Strategy: network-first for app files, falling back to cache only when
// offline. This means updates you push to GitHub reach the browser on the
// next load instead of being masked by a stale cache. Bump CACHE below any
// time you want to force every installed client to drop old cached files.

const CACHE = 'blueprint-cache-v2';
const ASSETS = [
  './', './index.html', './style.css',
  './js/model.js', './js/scheduler.js', './js/store.js', './js/history.js',
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
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
