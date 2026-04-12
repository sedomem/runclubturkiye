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

// ── Arka planda gelen DATA-ONLY mesajları yakala ───────────────────
messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] Arka plan mesajı:', payload);

  // Cloud Function'dan data-only payload geliyor
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
    // actions ve silent kaldırıldı - Chrome varsayılan "URL kopyala" butonunu engeller
    vibrate: [200, 100, 200],
  };

  return self.registration.showNotification(title, options);
});

// ── Bildirime tıklandığında yönlendirme ───────────────────────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const targetUrl = event.notification.data?.clickTarget || event.notification.data?.targetUrl || event.notification.data?.url || 'https://www.runclubturkiye.com/';

  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(function(clientList) {
      // Zaten açık RunClub sekmesi var mı?
      for (let client of clientList) {
        if (client.url.includes('runclubturkiye.com') && 'focus' in client) {
          client.focus();
          if (targetUrl !== client.url) client.navigate(targetUrl);
          return;
        }
      }
      // Yoksa yeni sekme aç
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
