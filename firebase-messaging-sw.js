importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:           "AIzaSyDWFv6jtbCvSH7ky0n8v5DYPtJX5hpFxiY",
  authDomain:       "runclubturkiye.firebaseapp.com",
  projectId:        "runclubturkiye",
  storageBucket:    "runclubturkiye.appspot.com",
  messagingSenderId:"1040984820849",
  appId:            "1:1040984820849:web:06869a5b74b74e17cbbecf"
});

const messaging = firebase.messaging();

// ── DATA-ONLY payload yakalama ──────────────────────────────────
messaging.onBackgroundMessage(function(payload) {
  console.log('[FCM-SW] Payload:', payload);

  const data  = payload.data || {};
  const title = data.title || 'RunClubTürkiye';
  const body  = data.body  || '';
  const icon  = data.icon  || '/icon-192.png';
  const image = data.image || '';
  // clickTarget: Cloud Function'ın gönderdiği key
  const clickUrl = data.clickTarget || data.url || 'https://www.runclubturkiye.com/';

  const options = {
    body,
    icon,
    badge: '/icon-192.png',
    ...(image ? { image } : {}),
    data: { clickTarget: clickUrl },   // notificationclick'e taşı
    requireInteraction: false,
    silent: false,
    tag: 'rct-push',                   // aynı tag → yeni bildirim eskiyi replace eder
    vibrate: [200, 100, 200],
    // ❌ actions: [] — KALDIRILD I. Chrome'un "URL kopyala" butonunu engelliyor
  };

  return self.registration.showNotification(title, options);
});

// ── Bildirime tıklanma ──────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.clickTarget)
    || 'https://www.runclubturkiye.com/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
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
