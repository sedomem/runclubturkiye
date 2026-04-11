// firebase-messaging-sw.js — DATA-ONLY mimari
// notification objesi gelmez, sadece data gelir
// SW her zaman tetiklenir ve bildirimi kendisi gösterir

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

messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] onBackgroundMessage tetiklendi:', JSON.stringify(payload));

  // DATA-ONLY: tüm içerik payload.data içinde gelir
  const data = payload.data || {};

  const title  = data.title  || 'RunClubTürkiye';
  const body   = data.body   || 'Yeni bir bildirim var.';
  const icon   = data.icon   || '/icon-192.png';
  const badge  = data.badge  || '/icon-96.png';
  const url    = data.url    || 'https://www.runclubturkiye.com/';
  const image  = data.image  || undefined;

  console.log('[SW] Bildirim gösteriliyor:', title, body);

  return self.registration.showNotification(title, {
    body:               body,
    icon:               icon,
    badge:              badge,
    image:              image,
    data:               { url: url },
    tag:                'rct-push',
    renotify:           true,
    requireInteraction: false,
    vibrate:            [200, 100, 200],
    actions: [
      { action: 'open',    title: 'Görüntüle' },
      { action: 'dismiss', title: 'Kapat' }
    ],
  });
});

self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Bildirime tıklandı:', event.action);
  event.notification.close();
  if (event.action === 'dismiss') return;

  const url = (event.notification.data && event.notification.data.url)
    || 'https://www.runclubturkiye.com/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === url && 'focus' in list[i]) {
          return list[i].focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
