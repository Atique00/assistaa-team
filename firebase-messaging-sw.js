/* Assistaa service worker: phone notifications + offline app shell */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
importScripts('js/config.js?v=7');

const CACHE = 'assistaa-v7';
const SHELL = ['./', 'index.html', 'css/app.css?v=7', 'js/app.js?v=7', 'js/config.js?v=7', 'assets/mark.svg', 'assets/wordmark.svg', 'icons/icon-192.png', 'icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
/* network first for our own files, fall back to cache when offline */
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

firebase.initializeApp(self.ASSISTAA.firebase);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  return self.registration.showNotification(d.title || 'Assistaa', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    vibrate: [80, 40, 80],
    tag: d.title || 'assistaa',
    renotify: true,
    data: { link: d.link || './' }
  });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.split('#')[0] === link.split('#')[0] && 'focus' in c) { c.navigate(link).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(link);
  }));
});
