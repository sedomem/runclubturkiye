// sw.js — RunClubTürkiye Service Worker (GÜNCELLENDİ)
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

// 🔔 BİLDİRİM YAKALAMA (PUSH EVENT) - SORUNU ÇÖZEN KISIM
self.addEventListener('push', function(event) {
  let data = { title: 'RunClubTürkiye', body: 'Yeni bir bildiriminiz var!', url: '/' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || data.message || '',
    icon: '/icon-192.png', // Logonuzun yolu
    badge: '/icon-192.png',
    data: { url: data.url || '/' }, // Bildirime tıklandığında gidilecek URL
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Görüntüle' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'RunClub', options)
  );
});

// 🖱 BİLDİRİME TIKLANDIĞINDA
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const urlToOpen = event.notification.data.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if (client.url === urlToOpen && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

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
