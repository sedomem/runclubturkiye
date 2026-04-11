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

messaging.onBackgroundMessage(payload => {
  console.log('[SW] onBackgroundMessage:', JSON.stringify(payload));

  // webpush.notification varsa onu kullan, yoksa data'dan al
  const n = payload.notification || {};
  const d = payload.data || {};

  const title = n.title || d.title || 'RunClubTürkiye';
  const body  = n.body  || d.body  || 'Yeni bir bildirim var.';
  const icon  = n.icon  || d.icon  || '/icon-192.png';
  const url   = n.click_action || d.url || 'https://www.runclubturkiye.com/';
  const image = n.image || d.image || undefined;

  return self.registration.showNotification(title, {
    body,
    icon,
    badge: '/icon-96.png',
    image,
    data: { url },
    actions: [
      { action: 'open',    title: 'Görüntüle' },
      { action: 'dismiss', title: 'Kapat' }
    ],
    requireInteraction: false,
    vibrate: [200, 100, 200],
    tag: 'rct-notification',
    renotify: true,
  });
});

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
