importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ═══ DOĞRU Firebase Config (mod ile aynı) ═══════════════════
firebase.initializeApp({
  apiKey:"AIzaSyCpr0QnKgm4AugAIZB0WdvBBn45ZeNmChs",
  authDomain:"runclubturkiye.firebaseapp.com",
  projectId:"runclubturkiye",
  storageBucket:"runclubturkiye.firebasestorage.app",
  messagingSenderId:"112561439264",
  appId:"1:112561439264:web:e0b3bca89db6f335423245"
});

const messaging = firebase.messaging();

// ═══ CACHE STRATEJİSİ ═══════════════════════════════════════
const CACHE_VERSION = 'rct-v7';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';
const STATIC_CACHE  = CACHE_VERSION + '-static';
const IMAGE_CACHE   = CACHE_VERSION + '-images';

const NETWORK_FIRST = [
  /firestore\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /fcm\.googleapis\.com/,
];

const CACHE_FIRST = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdn\.jsdelivr\.net/,
  /cdnjs\.cloudflare\.com/,
  /cdn\.quilljs\.com/,
  /gstatic\.com\/firebasejs/,
];

const IMAGE_RE = [
  /firebasestorage\.googleapis\.com/,
  /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i,
];

// ── INSTALL — skipWaiting (precache yok, Cloudflare edge yeterli) ──
self.addEventListener('install', function(event) {
  console.log('[SW] Install:', CACHE_VERSION);
  event.waitUntil(self.skipWaiting());
});

// ── ACTIVATE — eski cache temizle ──
self.addEventListener('activate', function(event) {
  console.log('[SW] Activate:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) {
          return n.startsWith('rct-') && !n.startsWith(CACHE_VERSION);
        }).map(function(n) {
          console.log('[SW] Eski cache silindi:', n);
          return caches.delete(n);
        })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// ── FETCH ──
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  if (event.request.method !== 'GET') return;
  if (url.startsWith('chrome-extension:') || url.startsWith('data:')) return;

  if (NETWORK_FIRST.some(function(p) { return p.test(url); })) {
    event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
    return;
  }
  if (IMAGE_RE.some(function(p) { return p.test(url); })) {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
    return;
  }
  if (CACHE_FIRST.some(function(p) { return p.test(url); })) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }
  if (url.includes('runclubturkiye.com')) {
    event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
    return;
  }
  event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
});

function networkFirst(request, cacheName) {
  return fetch(request.clone()).then(function(response) {
    if (response && response.status === 200) {
      var cloned = response.clone();
      caches.open(cacheName).then(function(cache) {
        cache.put(request, cloned).catch(function(){});
      });
    }
    return response;
  }).catch(function() {
    return caches.match(request).then(function(cached) {
      if (cached) return cached;
      if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
        return offlinePage();
      }
      return new Response('', { status: 503, statusText: 'Offline' });
    });
  });
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;
    return fetch(request.clone()).then(function(response) {
      if (response && response.status === 200) {
        var cloned = response.clone();
        caches.open(cacheName).then(function(cache) {
          cache.put(request, cloned).catch(function(){});
        });
      }
      return response;
    }).catch(function() { return new Response('', { status: 503 }); });
  });
}

function offlinePage() {
  var h = '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Çevrimdışı</title><style>body{margin:0;font-family:Arial,sans-serif;background:#0d0d0d;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}h1{font-size:22px;color:#E8622A}button{background:#E8622A;color:#fff;border:none;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-top:20px}</style></head><body><div style="font-size:72px;margin-bottom:20px">🏃</div><h1>Bağlantı Yok</h1><p style="color:#aaa;max-width:320px">Bağlantın kurulunca otomatik yenilenir.</p><button onclick="location.reload()">Yeniden Dene</button><script>window.addEventListener("online",function(){location.reload();});<\/script></body></html>';
  return new Response(h, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ═══ FCM — Arka plan push bildirimi ═════════════════════════
messaging.onBackgroundMessage(function(payload) {
  var data = payload.data || {};
  var title = data.title || 'RunClubTürkiye';
  var body  = data.body  || '';
  var url   = data.url || data.clickTarget || 'https://www.runclubturkiye.com/';
  var icon  = data.icon  || '/icon-192.png';
  var options = {
    body: body,
    icon: icon,
    badge: '/icon-192.png',
    data: { clickTarget: url },
    requireInteraction: false,
    tag: 'rct-push-' + Date.now(),
    vibrate: [200, 100, 200],
  };
  if (data.image) options.image = data.image;
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.clickTarget)
    || 'https://www.runclubturkiye.com/';
  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes('runclubturkiye.com') && 'focus' in client) {
          client.focus();
          if (targetUrl !== client.url) client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
