// ═══════════════════════════════════════════════════════════════════════════
// Firebase Cloud Messaging Service Worker
// Dosya: public/firebase-messaging-sw.js
// RunClubTürkiye - Background Push Notifications (DATA-ONLY Support)
// VERSION: 2.0.0 - CACHE BUSTING ENABLED
// ═══════════════════════════════════════════════════════════════════════════

const SW_VERSION = '2.0.0';
const CACHE_NAME = 'fcm-sw-v2.0.0';

console.log(`[SW] Version ${SW_VERSION} loading...`);

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIREBASE CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const firebaseConfig = {
  apiKey: "AIzaSyDJGIl9f_nHo2aB0pCGhXLSF8q-aQbZ0XY",
  authDomain: "one-question-8e3bc.firebaseapp.com",
  projectId: "one-question-8e3bc",
  storageBucket: "one-question-8e3bc.firebasestorage.app",
  messagingSenderId: "690128633859",
  appId: "1:690128633859:web:27c50bde1621c1b8783f2d"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

console.log('[SW] Firebase Messaging initialized');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BACKGROUND MESSAGE HANDLER — DATA-ONLY PAYLOAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cloud Function sadece 'data' field gönderiyor (notification field yok)
// Bu handler manuel olarak notification gösterir

messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload);

  // DATA payload'dan bilgileri al (notification değil!)
  const data = payload.data || {};
  
  const notificationTitle = data.title || 'RunClubTürkiye';
  const notificationOptions = {
    body: data.body || '',
    icon: data.icon || 'https://www.runclubturkiye.com/icon-192.png',
    badge: 'https://www.runclubturkiye.com/icon-192.png',
    image: data.image || null,
    data: {
      clickTarget: data.clickTarget || 'https://www.runclubturkiye.com/',
      timestamp: data.timestamp || Date.now()
    },
    requireInteraction: false,
    tag: 'runclub-notification',
    vibrate: [200, 100, 200],
    timestamp: parseInt(data.timestamp) || Date.now()
  };

  console.log('[SW] Showing notification:', notificationTitle, notificationOptions);

  // Notification göster
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NOTIFICATION CLICK HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  
  event.notification.close();

  const clickTarget = event.notification.data?.clickTarget || 'https://www.runclubturkiye.com/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Aynı URL zaten açıksa focus et
      for (const client of clientList) {
        if (client.url === clickTarget && 'focus' in client) {
          console.log('[SW] Focusing existing tab');
          return client.focus();
        }
      }
      
      // Yoksa yeni tab aç
      if (clients.openWindow) {
        console.log('[SW] Opening new window:', clickTarget);
        return clients.openWindow(clickTarget);
      }
    })
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUSH EVENT LISTENER (Fallback)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bazı durumlarda onBackgroundMessage yerine push eventi tetiklenebilir

self.addEventListener('push', (event) => {
  console.log('[SW] Push event received');
  
  if (!event.data) {
    console.log('[SW] No data in push event');
    return;
  }

  let data;
  try {
    data = event.data.json();
    console.log('[SW] Push data:', data);
  } catch (e) {
    console.log('[SW] Could not parse push data:', e);
    return;
  }

  // data payload varsa göster
  if (data.data) {
    const payload = data.data;
    const title = payload.title || 'RunClubTürkiye';
    const options = {
      body: payload.body || '',
      icon: payload.icon || 'https://www.runclubturkiye.com/icon-192.png',
      badge: 'https://www.runclubturkiye.com/icon-192.png',
      data: {
        clickTarget: payload.clickTarget || 'https://www.runclubturkiye.com/'
      }
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SERVICE WORKER LIFECYCLE - CACHE BUSTING & FORCE UPDATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${SW_VERSION}...`);
  
  // FORCE UPDATE: Eski SW'yi beklemeden hemen aktif et
  self.skipWaiting();
  
  console.log('[SW] ✅ Installed and skipped waiting');
});

self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating version ${SW_VERSION}...`);
  
  event.waitUntil(
    // Eski cache'leri temizle
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => {
            console.log('[SW] 🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
    .then(() => {
      console.log('[SW] ✅ Old caches cleared');
      // Tüm client'ları hemen kontrol et
      return clients.claim();
    })
    .then(() => {
      console.log('[SW] ✅ All clients claimed');
      // Tüm client'lara güncelleme mesajı gönder
      return clients.matchAll({ type: 'window' });
    })
    .then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'SW_UPDATED',
          version: SW_VERSION
        });
      });
    })
  );
});

// Message event - Client'tan gelen mesajları dinle
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Client requested skip waiting');
    self.skipWaiting();
  }
});
