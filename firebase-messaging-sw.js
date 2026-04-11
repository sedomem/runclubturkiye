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

// Bu fonksiyon tetiklenirse SW devreye girdi demektir
// "Bu site arka planda güncellendi" mesajı artık gösterilmez
messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] onBackgroundMessage:', JSON.stringify(payload));

  const n = payload.notification || {};
  const d = payload.data || {};

  const title = n.title || d.title || 'RunClubTürkiye';
  const body  = n.body  || d.body  || 'Yeni bir bildirim';
  const icon  = '/icon-192.png';
  const url   = d.url   || 'https://www.runclubturkiye.com/';

  return self.registration.showNotification(title, {
    body:     body,
    icon:     icon,
    badge:    '/icon-96.png',
    data:     { url: url },
    tag:      'rct-push',
    renotify: true,
    requireInteraction: false,
    vibrate:  [200, 100, 200],
  });
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = (event.notification.data && event.notification.data.url)
    || 'https://www.runclubturkiye.com/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === url && 'focus' in list[i]) return list[i].focus();
      }
      return clients.openWindow(url);
    })
  );
});
