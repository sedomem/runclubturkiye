/**
 * RunClubTürkiye — Firebase Cloud Functions
 * Push Bildirim Sistemi
 *
 * Fonksiyonlar:
 *  1. onPushNotificationCreated  — Firestore trigger: pushNotifications koleksiyonuna
 *                                   yeni doc eklenince tüm kayıtlı kullanıcılara FCM gönderir
 *  2. sendPushToUser             — HTTPS callable: belirli bir kullanıcıya bildirim gönderir
 *  3. sendPushToTopic            — HTTPS callable: topic bazlı toplu bildirim
 *  4. cleanOldNotifications      — Scheduled: 30 günden eski bildirimleri temizler
 */

const { onDocumentCreated }    = require('firebase-functions/v2/firestore');
const { onCall, HttpsError }   = require('firebase-functions/v2/https');
const { onSchedule }           = require('firebase-functions/v2/scheduler');
const { initializeApp }        = require('firebase-admin/app');
const { getMessaging }         = require('firebase-admin/messaging');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth }              = require('firebase-admin/auth');

initializeApp();

const db  = getFirestore();
const fcm = getMessaging();

const SUPER_EMAIL  = 'sedomem@gmail.com';
const PROJECT_ID   = 'runclubturkiye';
const DEFAULT_ICON = 'https://www.runclubturkiye.com/icon-192.png';
const DEFAULT_URL  = 'https://www.runclubturkiye.com/';

// ─────────────────────────────────────────────────────────────
// YARDIMCI: Süper admin mi?
// ─────────────────────────────────────────────────────────────
async function verifySuperAdmin(auth) {
  if (!auth || !auth.token || auth.token.email !== SUPER_EMAIL) {
    throw new HttpsError('permission-denied', 'Sadece süper admin kullanabilir.');
  }
}

// ─────────────────────────────────────────────────────────────
// YARDIMCI: Tüm FCM tokenları getir
// ─────────────────────────────────────────────────────────────
async function getAllFcmTokens() {
  const snap = await db.collection('users')
    .where('pushEnabled', '==', true)
    .get();

  const tokens = [];
  snap.forEach(doc => {
    const data = doc.data();
    if (data.fcmToken && typeof data.fcmToken === 'string' && data.fcmToken.length > 20) {
      tokens.push({ uid: doc.id, token: data.fcmToken });
    }
  });
  return tokens;
}

// ─────────────────────────────────────────────────────────────
// YARDIMCI: Geçersiz tokenleri temizle
// ─────────────────────────────────────────────────────────────
async function cleanInvalidTokens(invalidTokens) {
  if (!invalidTokens || invalidTokens.length === 0) return;
  const batch = db.batch();
  const snap = await db.collection('users')
    .where('pushEnabled', '==', true)
    .get();
  snap.forEach(doc => {
    if (invalidTokens.includes(doc.data().fcmToken)) {
      batch.update(doc.ref, { fcmToken: FieldValue.delete(), pushEnabled: false });
    }
  });
  await batch.commit();
  console.log(`[FCM] ${invalidTokens.length} geçersiz token temizlendi`);
}

// ─────────────────────────────────────────────────────────────
// YARDIMCI: Batch FCM gönder (maks 500 token/istek)
// ─────────────────────────────────────────────────────────────
async function sendBatchMessages(tokens, notification, data = {}) {
  const results = { success: 0, failure: 0, invalidTokens: [] };
  if (tokens.length === 0) return results;

  // 500'lük gruplara böl
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) {
    chunks.push(tokens.slice(i, i + 500));
  }

  for (const chunk of chunks) {
    const messages = chunk.map(({ token }) => ({
      token,
      notification: {
        title: notification.title,
        body:  notification.body,
        imageUrl: notification.imageUrl || undefined,
      },
      webpush: {
        notification: {
          title:   notification.title,
          body:    notification.body,
          icon:    notification.icon    || DEFAULT_ICON,
          image:   notification.imageUrl || undefined,
          badge:   'https://www.runclubturkiye.com/icon-96.png',
          requireInteraction: false,
          actions: [
            { action: 'open',    title: 'Görüntüle' },
            { action: 'dismiss', title: 'Kapat'     }
          ],
        },
        fcmOptions: {
          link: data.url || DEFAULT_URL,
        },
      },
      data: {
        url:       data.url       || DEFAULT_URL,
        type:      data.type      || 'general',
        entityId:  data.entityId  || '',
        timestamp: String(Date.now()),
      },
    }));

    try {
      const response = await fcm.sendEach(messages);
      results.success += response.successCount;
      results.failure += response.failureCount;

      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code || '';
          if (
            errCode === 'messaging/registration-token-not-registered' ||
            errCode === 'messaging/invalid-registration-token'
          ) {
            results.invalidTokens.push(chunk[idx].token);
          }
          console.warn(`[FCM] Token hatası: ${errCode} — uid: ${chunk[idx].uid}`);
        }
      });
    } catch (err) {
      console.error('[FCM] Batch gönderim hatası:', err.message);
      results.failure += chunk.length;
    }
  }

  if (results.invalidTokens.length > 0) {
    await cleanInvalidTokens(results.invalidTokens);
  }

  return results;
}

// ═════════════════════════════════════════════════════════════
// 1. FIRESTORE TRIGGER — pushNotifications koleksiyonu
//    Admin "Tüm Kullanıcılara Gönder" tıkladığında tetiklenir
// ═════════════════════════════════════════════════════════════
exports.onPushNotificationCreated = onDocumentCreated(
  {
    document: 'pushNotifications/{docId}',
    region: 'europe-west1',
  },
  async (event) => {
    const docId  = event.params.docId;
    const data   = event.data.data();

    console.log(`[FCM] Yeni bildirim: ${docId}`, data);

    // Sadece 'pending' durumundaki bildirimleri işle
    if (data.status !== 'pending') {
      console.log('[FCM] Pending değil, atlandı:', data.status);
      return;
    }

    const notifRef = db.collection('pushNotifications').doc(docId);

    try {
      // İşleniyor olarak işaretle (tekrar tetiklenmeyi önle)
      await notifRef.update({ status: 'processing', processedAt: FieldValue.serverTimestamp() });

      const notification = {
        title:    data.title    || 'RunClubTürkiye',
        body:     data.body     || '',
        icon:     data.icon     || DEFAULT_ICON,
        imageUrl: data.image    || undefined,
      };

      const extraData = {
        url:      data.url      || DEFAULT_URL,
        type:     data.type     || 'general',
        entityId: data.entityId || '',
      };

      let results;

      if (data.target === 'topic' && data.topic) {
        // Topic bazlı gönderim
        const msg = {
          topic: data.topic,
          notification,
          webpush: {
            notification: {
              ...notification,
              icon:  DEFAULT_ICON,
              badge: 'https://www.runclubturkiye.com/icon-96.png',
            },
            fcmOptions: { link: extraData.url },
          },
          data: {
            url: extraData.url,
            type: extraData.type,
            timestamp: String(Date.now()),
          },
        };
        await fcm.send(msg);
        results = { success: 1, failure: 0, invalidTokens: [] };

      } else if (data.target === 'user' && data.targetUid) {
        // Tek kullanıcı
        const userDoc = await db.collection('users').doc(data.targetUid).get();
        const token   = userDoc.data()?.fcmToken;
        if (!token) throw new Error('Kullanıcıda FCM token yok');
        results = await sendBatchMessages(
          [{ uid: data.targetUid, token }],
          notification,
          extraData
        );

      } else {
        // Tüm kayıtlı kullanıcılar
        const tokens = await getAllFcmTokens();
        console.log(`[FCM] ${tokens.length} token bulundu`);
        if (tokens.length === 0) {
          await notifRef.update({ status: 'no_subscribers', completedAt: FieldValue.serverTimestamp() });
          return;
        }
        results = await sendBatchMessages(tokens, notification, extraData);
      }

      console.log(`[FCM] Tamamlandı — başarı: ${results.success}, hata: ${results.failure}`);

      // Sonucu Firestore'a yaz
      await notifRef.update({
        status:       'sent',
        sentCount:    results.success,
        failCount:    results.failure,
        completedAt:  FieldValue.serverTimestamp(),
      });

    } catch (err) {
      console.error('[FCM] Bildirim hatası:', err.message);
      await notifRef.update({
        status:   'error',
        error:    err.message,
        errorAt:  FieldValue.serverTimestamp(),
      }).catch(() => {});
    }
  }
);

// ═════════════════════════════════════════════════════════════
// 2. HTTPS CALLABLE — Belirli bir kullanıcıya bildirim
//    Admin panelinden spesifik kullanıcıya gönderim için
// ═════════════════════════════════════════════════════════════
exports.sendPushToUser = onCall(
  { region: 'europe-west1' },
  async (request) => {
    await verifySuperAdmin(request.auth);

    const { targetUid, title, body, url, image } = request.data;
    if (!targetUid || !title || !body) {
      throw new HttpsError('invalid-argument', 'targetUid, title, body zorunlu.');
    }

    const userDoc = await db.collection('users').doc(targetUid).get();
    if (!userDoc.exists) throw new HttpsError('not-found', 'Kullanıcı bulunamadı.');

    const token = userDoc.data()?.fcmToken;
    if (!token) throw new HttpsError('not-found', 'Kullanıcıda FCM token yok.');

    const results = await sendBatchMessages(
      [{ uid: targetUid, token }],
      { title, body, imageUrl: image },
      { url: url || DEFAULT_URL }
    );

    return { success: results.success > 0, ...results };
  }
);

// ═════════════════════════════════════════════════════════════
// 3. HTTPS CALLABLE — Topic bazlı toplu bildirim
//    Ör: 'istanbul', 'maraton', 'yeni_etkinlik'
// ═════════════════════════════════════════════════════════════
exports.sendPushToTopic = onCall(
  { region: 'europe-west1' },
  async (request) => {
    await verifySuperAdmin(request.auth);

    const { topic, title, body, url, image } = request.data;
    if (!topic || !title || !body) {
      throw new HttpsError('invalid-argument', 'topic, title, body zorunlu.');
    }

    const msg = {
      topic,
      notification: { title, body, imageUrl: image || undefined },
      webpush: {
        notification: {
          title, body,
          icon:  DEFAULT_ICON,
          badge: 'https://www.runclubturkiye.com/icon-96.png',
          image: image || undefined,
        },
        fcmOptions: { link: url || DEFAULT_URL },
      },
      data: { url: url || DEFAULT_URL, topic, timestamp: String(Date.now()) },
    };

    const msgId = await fcm.send(msg);
    console.log(`[FCM] Topic ${topic} gönderildi: ${msgId}`);
    return { success: true, messageId: msgId };
  }
);

// ═════════════════════════════════════════════════════════════
// 4. Yeni etkinlik oluşturulduğunda otomatik bildirim
// ═════════════════════════════════════════════════════════════
exports.onEventApproved = onDocumentCreated(
  {
    document: 'events/{eventId}',
    region: 'europe-west1',
  },
  async (event) => {
    const data = event.data.data();

    // Sadece onaylı etkinlikler
    if (data.status !== 'approved') return;

    const title = '🏃 Yeni Etkinlik!';
    const body  = `${data.title || data.name || 'Etkinlik'} — ${data.location || ''}`;
    const url   = `${DEFAULT_URL}#events/${event.params.eventId}`;

    const tokens = await getAllFcmTokens();
    if (tokens.length === 0) return;

    const results = await sendBatchMessages(
      tokens,
      { title, body, icon: DEFAULT_ICON },
      { url, type: 'event', entityId: event.params.eventId }
    );

    console.log(`[FCM] Etkinlik bildirimi — başarı: ${results.success}`);
  }
);

// ═════════════════════════════════════════════════════════════
// 5. Yeni yarış eklendiğinde otomatik bildirim
// ═════════════════════════════════════════════════════════════
exports.onRaceCreated = onDocumentCreated(
  {
    document: 'races/{raceId}',
    region: 'europe-west1',
  },
  async (event) => {
    const data = event.data.data();

    const title = '🏆 Yeni Yarış Eklendi!';
    const body  = `${data.name || 'Yarış'} — ${data.date || ''} ${data.location || ''}`;
    const url   = `${DEFAULT_URL}#races/${event.params.raceId}`;

    const tokens = await getAllFcmTokens();
    if (tokens.length === 0) return;

    await sendBatchMessages(
      tokens,
      { title, body, icon: DEFAULT_ICON },
      { url, type: 'race', entityId: event.params.raceId }
    );

    console.log(`[FCM] Yarış bildirimi gönderildi: ${data.name}`);
  }
);

// ═════════════════════════════════════════════════════════════
// 6. SCHEDULED — Her gün sabah 04:00'te eski bildirimleri temizle
// ═════════════════════════════════════════════════════════════
exports.cleanOldNotifications = onSchedule(
  {
    schedule:  'every day 04:00',
    timeZone:  'Europe/Istanbul',
    region:    'europe-west1',
  },
  async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const snap = await db.collection('pushNotifications')
      .where('createdAt', '<', cutoff)
      .get();

    if (snap.empty) {
      console.log('[Cleanup] Temizlenecek eski bildirim yok.');
      return;
    }

    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`[Cleanup] ${snap.size} eski bildirim silindi.`);
  }
);
