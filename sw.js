// sw.js — RunClubTürkiye Service Worker
// NOT: Push bildirimler firebase-messaging-sw.js tarafından işleniyor
// Bu dosya sadece cache + fetch yönetimi yapar
const CACHE = 'rct-v4';
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

// ⚠️ sw.js'te push handler OLMAMALI
// firebase-messaging-sw.js zaten push olaylarını yönetiyor
// İki SW aynı push olayını yakalırsa çakışma ve "URL kopyala" hatası olur

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('gstatic.com') ||
      url.includes('googleapis.com')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
