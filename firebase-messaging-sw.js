// firebase-messaging-sw.js
// Bu dosya domain root'una (/firebase-messaging-sw.js) yüklenmelidir.
// Vercel'de: public/ klasörüne koy veya vercel.json ile serve et.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyCpr0QnKgm4AugAIZB0WdvBBn45ZeNmChs",
  authDomain:        "runclubturkiye.firebaseapp.com",
  projectId:         "runclubturkiye",
  storageBucket:     "runclubturkiye.firebasestorage.app",
  messagingSenderId: "112561439264",
  appId:             "1:112561439264:web:e0b3bca89db6f335423245"
});

const messaging = firebase.messaging();

// Arka planda gelen bildirimler (uygulama kapalıyken)
messaging.onBackgroundMessage(payload => {
  console.log('[SW] Arka plan bildirimi:', payload);
  const { title, body, icon, image, click_action } = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(title || 'RunClubTürkiye', {
    body:  body  || 'Yeni bir bildirim var.',
    icon:  icon  || '/icon-192.png',
    badge: '/icon-96.png',
    image: image || undefined,
    data:  { url: click_action || data.url || 'https://www.runclubturkiye.com/' },
    actions: [
      { action: 'open',    title: 'Görüntüle' },
      { action: 'dismiss', title: 'Kapat'     }
    ],
    requireInteraction: false,
    vibrate: [200, 100, 200]
  });
});

// Bildirimi tıklama — sayfayı aç
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = (event.notification.data && event.notification.data.url)
    || 'https://www.runclubturkiye.com/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
