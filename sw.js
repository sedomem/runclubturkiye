// RunClubTürkiye Service Worker
const CACHE_NAME = 'rct-v1';
const STATIC_CACHE = 'rct-static-v1';
const DYNAMIC_CACHE = 'rct-dynamic-v1';

// Önbellekte saklanacak statik dosyalar
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Service Worker kurulumu
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch(err => console.log('[SW] Cache error:', err))
  );
  self.skipWaiting();
});

// Service Worker aktifleştirme
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => caches.delete(key))
      );
    })
  );
  return self.clients.claim();
});

// Fetch stratejisi: Network First, Cache Fallback
self.addEventListener('fetch', event => {
  // Firebase ve API istekleri için cache kullanma
  if (
    event.request.url.includes('firebasestorage.googleapis.com') ||
    event.request.url.includes('firestore.googleapis.com') ||
    event.request.url.includes('googleapis.com')
  ) {
    return; // Firebase isteklerini bypass et
  }

  event.respondWith(
    fetch(event.request)
      .then(res => {
        // Dinamik cache'e ekle
        return caches.open(DYNAMIC_CACHE).then(cache => {
          // Sadece GET isteklerini cache'le
          if (event.request.method === 'GET') {
            cache.put(event.request.url, res.clone());
          }
          return res;
        });
      })
      .catch(() => {
        // Network başarısız, cache'den dön
        return caches.match(event.request).then(cachedRes => {
          if (cachedRes) {
            return cachedRes;
          }
          // Offline fallback
          if (event.request.destination === 'document') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// Push bildirimleri için (gelecekte)
self.addEventListener('push', event => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'Yeni etkinlik!',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: data.url || '/'
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'RunClubTürkiye', options)
  );
});

// Bildirim tıklama
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || '/')
  );
});
