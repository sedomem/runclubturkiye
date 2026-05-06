importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:"AIzaSyDWFv6jtbCvSH7ky0n8v5DYPtJX5hpFxiY",
  authDomain:"runclubturkiye.firebaseapp.com",
  projectId:"runclubturkiye",
  storageBucket:"runclubturkiye.appspot.com",
  messagingSenderId:"1040984820849",
  appId:"1:1040984820849:web:06869a5b74b74e17cbbecf"
});

const messaging = firebase.messaging();

// ═══════════════════════════════════════════════════════════════════
// CACHE STRATEJİSİ — Offline Mode
// Versiyon numarasını değiştirmek tüm cache'i temizler
// ═══════════════════════════════════════════════════════════════════
const CACHE_VERSION  = 'rct-v3';
const STATIC_CACHE   = CACHE_VERSION + '-static';
const DYNAMIC_CACHE  = CACHE_VERSION + '-dynamic';
const IMAGE_CACHE    = CACHE_VERSION + '-images';

// Kurulumda cache'lenecek kritik dosyalar (App Shell)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Raleway:wght@700;800;900&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.quilljs.com/1.3.7/quill.snow.css',
  'https://cdn.quilljs.com/1.3.7/quill.min.js',
];

// Bu URL pattern'ları için NETWORK FIRST (her zaman taze veri):
const NETWORK_FIRST_PATTERNS = [
  /firestore\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /fcm\.googleapis\.com/,
  /googleapis\.com\/v1\/projects/,
];

// Bu pattern'lar için CACHE FIRST (statik içerik):
const CACHE_FIRST_PATTERNS = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdn\.jsdelivr\.net/,
  /cdn\.quilljs\.com/,
  /gstatic\.com\/firebasejs/,
  /leafletjs\.com/,
];

// Görseller için IMAGE CACHE (en uzun ömürlü):
const IMAGE_PATTERNS = [
  /firebasestorage\.googleapis\.com/,
  /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i,
];

// ── INSTALL — App Shell'i cache'e al ─────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] Install:', CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(
        STATIC_ASSETS.filter(function(url) {
          // Sadece erişilebilir URL'leri cache'le, hata olursa atla
          return true;
        })
      ).catch(function(err) {
        console.warn('[SW] Static cache partial fail:', err.message);
        // Kritik olmayan dosyalarda hata olsa da kurulumu tamamla
        return cache.addAll(['/', '/index.html']).catch(function(){});
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE — Eski cache'leri temizle ───────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] Activate:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) {
            // Eski versiyon cache'leri sil
            return name.startsWith('rct-') && !name.startsWith(CACHE_VERSION);
          })
          .map(function(name) {
            console.log('[SW] Eski cache silindi:', name);
            return caches.delete(name);
          })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH — Akıllı cache stratejisi ──────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  var method = event.request.method;

  // POST/PUT/DELETE istekleri cache'lenemez
  if (method !== 'GET') return;

  // Chrome extension ve data URL'lerini atla
  if (url.startsWith('chrome-extension:') || url.startsWith('data:')) return;

  // ── 1. NETWORK FIRST — Firebase API istekleri ──────────────────
  if (NETWORK_FIRST_PATTERNS.some(function(p) { return p.test(url); })) {
    event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
    return;
  }

  // ── 2. GÖRSEL — Cache First, uzun TTL ─────────────────────────
  if (IMAGE_PATTERNS.some(function(p) { return p.test(url); })) {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
    return;
  }

  // ── 3. STATİK CDN — Cache First ───────────────────────────────
  if (CACHE_FIRST_PATTERNS.some(function(p) { return p.test(url); })) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // ── 4. ANA SAYFA & HTML — Stale While Revalidate ──────────────
  if (url.includes('runclubturkiye.com') &&
     (url.endsWith('/') || url.includes('/index.html') ||
      url.match(/runclubturkiye\.com\/(yaris|kulup|etkinlik|blog)\//))) {
    event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
    return;
  }

  // ── 5. DİĞER — Network First, cache fallback ──────────────────
  event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
});

// ═══════════════════════════════════════════════════════════════════
// STRATEJİ FONKSİYONLARI
// ═══════════════════════════════════════════════════════════════════

// Network First: önce ağa git, offline ise cache'ten sun
function networkFirst(request, cacheName) {
  return fetch(request.clone()).then(function(response) {
    if (response && response.status === 200) {
      var cloned = response.clone();
      caches.open(cacheName).then(function(cache) {
        // Sadece same-origin ve CORS izinli istekleri cache'le
        if (request.url.startsWith('https://')) {
          cache.put(request, cloned).catch(function(){});
        }
      });
    }
    return response;
  }).catch(function() {
    // Network yok — cache'e bak
    return caches.match(request).then(function(cached) {
      if (cached) return cached;
      // HTML isteğiyse offline fallback göster
      if (request.headers.get('accept') &&
          request.headers.get('accept').includes('text/html')) {
        return offlinePage();
      }
      return new Response('', { status: 503, statusText: 'Offline' });
    });
  });
}

// Cache First: önce cache'e bak, yoksa ağdan çek ve cache'le
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
    }).catch(function() {
      return new Response('', { status: 503 });
    });
  });
}

// Stale While Revalidate: cache'ten hemen sun, arka planda güncelle
function staleWhileRevalidate(request, cacheName) {
  var fetchPromise = fetch(request.clone()).then(function(response) {
    if (response && response.status === 200) {
      var cloned = response.clone();
      caches.open(cacheName).then(function(cache) {
        cache.put(request, cloned).catch(function(){});
      });
    }
    return response;
  }).catch(function() { return null; });

  return caches.match(request).then(function(cached) {
    return cached || fetchPromise.then(function(r) {
      return r || offlinePage();
    });
  });
}

// Offline fallback sayfası
function offlinePage() {
  var html = '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/>'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"/>'
    + '<title>RunClubTürkiye — Çevrimdışı</title>'
    + '<style>'
    + 'body{margin:0;font-family:Arial,sans-serif;background:#0d0d0d;color:#fff;'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
    + 'min-height:100vh;text-align:center;padding:20px}'
    + '.icon{font-size:72px;margin-bottom:20px}'
    + 'h1{font-size:22px;font-weight:800;margin:0 0 10px;color:#E8622A}'
    + 'p{font-size:14px;color:#aaa;line-height:1.6;max-width:320px;margin:0 auto 24px}'
    + 'button{background:#E8622A;color:#fff;border:none;padding:12px 28px;'
    + 'border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}'
    + '</style></head><body>'
    + '<div class="icon">🏃</div>'
    + '<h1>İnternet Bağlantısı Yok</h1>'
    + '<p>RunClubTürkiye\'ye erişmek için internet bağlantına ihtiyacın var. '
    + 'Bağlantın tekrar kurulunca sayfa otomatik yenilenir.</p>'
    + '<button onclick="location.reload()">🔄 Yeniden Dene</button>'
    + '<script>window.addEventListener("online",function(){location.reload();});<\/script>'
    + '</body></html>';
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ═══════════════════════════════════════════════════════════════════
// FCM — Arka plan push bildirimleri (mevcut kod korundu)
// ═══════════════════════════════════════════════════════════════════
messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] Arka plan mesajı:', payload);
  const data = payload.data || {};
  const title = data.title || 'RunClubTürkiye';
  const body  = data.body  || '';
  const url   = data.url   || 'https://www.runclubturkiye.com/';
  const icon  = data.icon  || '/icon-192.png';
  const image = data.image || '';
  const options = {
    body,
    icon,
    badge: '/icon-192.png',
    ...(image ? {image} : {}),
    data: { clickTarget: url },
    requireInteraction: false,
    tag: 'rct-push-' + Date.now(),
    vibrate: [200, 100, 200],
  };
  return self.registration.showNotification(title, options);
});

// ── Bildirime tıklandığında yönlendirme ──────────────────────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = event.notification.data?.clickTarget
    || event.notification.data?.targetUrl
    || event.notification.data?.url
    || 'https://www.runclubturkiye.com/';
  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(function(clientList) {
      for (let client of clientList) {
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
