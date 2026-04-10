// sw.js — RunClubTürkiye Service Worker
// Cache stratejisi + FCM messaging-sw aktivasyonu

const CACHE = 'rct-v3';
const STATIC = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Sadece GET isteklerini cache'le
  if (e.request.method !== 'GET') return;
  // Firebase ve dış API isteklerini atla
  const url = e.request.url;
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('gstatic.com') ||
      url.includes('googleapis.com')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
