// Firebase Cloud Functions — index.js
// Deploy: firebase deploy --only functions
// Gereksinimler: firebase-admin, firebase-functions (v2)
// package.json: { "engines": { "node": "18" } }

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const { getMessaging }      = require('firebase-admin/messaging');

initializeApp();
const db        = getFirestore();
const messaging = getMessaging();

// ── pushNotifications koleksiyonunu dinle ──────────────────────
exports.sendPushOnCreate = onDocumentCreated(
  'pushNotifications/{docId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const d          = snap.data();
    const { title, body, url, image, target, targetRole, targetClubId } = d;

    // İşlendi mi?
    if (d.status === 'sent' || d.status === 'error') return;
    await snap.ref.update({ status: 'processing' });

    try {
      // FCM token listesini al
      let tokens = [];

      if (target === 'all') {
        const snap2 = await db.collection('users')
          .where('fcmToken', '!=', '')
          .where('pushEnabled', '==', true)
          .get();
        snap2.forEach(doc => { if (doc.data().fcmToken) tokens.push(doc.data().fcmToken); });

      } else if (target === 'members' || target === 'groupadmins') {
        const snap2 = await db.collection('users')
          .where('role', '==', targetRole)
          .where('pushEnabled', '==', true)
          .get();
        snap2.forEach(doc => { if (doc.data().fcmToken) tokens.push(doc.data().fcmToken); });

      } else if (target === 'club' && targetClubId) {
        const snap2 = await db.collection('memberships')
          .where('clubId', '==', targetClubId)
          .get();
        const uids = snap2.docs.map(doc => doc.data().userId || doc.data().uid).filter(Boolean);

        // UID'lerden FCM token al (batch 10'ar)
        for (let i = 0; i < uids.length; i += 10) {
          const batch = uids.slice(i, i + 10);
          const uSnap = await db.collection('users')
            .where('__name__', 'in', batch)
            .where('pushEnabled', '==', true)
            .get();
          uSnap.forEach(doc => { if (doc.data().fcmToken) tokens.push(doc.data().fcmToken); });
        }
      }

      if (!tokens.length) {
        await snap.ref.update({ status: 'no_tokens', sentCount: 0 });
        return;
      }

      // Tekrarlı token'ları temizle
      tokens = [...new Set(tokens)];

      // DATA-ONLY mesaj gönder (notification: {} YOK)
      // SW'nin onBackgroundMessage'ı yakalaması için şart
      const message = {
        data: {
          title:       title || 'RunClubTürkiye',
          body:        body  || '',
          clickTarget: url   || 'https://www.runclubturkiye.com/',
          icon:        '/icon-192.png',
          ...(image ? { image } : {}),
        },
        // Android için arka planda göster
        android: {
          priority: 'high',
        },
        // iOS için APNs content-available
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: { contentAvailable: true } },
        },
      };

      // sendEachForMulticast ile gönder (max 500 token)
      let successCount = 0;
      let failCount    = 0;
      const invalidTokens = [];

      for (let i = 0; i < tokens.length; i += 500) {
        const batch  = tokens.slice(i, i + 500);
        const result = await messaging.sendEachForMulticast({ ...message, tokens: batch });

        result.responses.forEach((resp, idx) => {
          if (resp.success) {
            successCount++;
          } else {
            failCount++;
            const errCode = resp.error?.code || '';
            // Geçersiz token → temizle
            if (errCode.includes('registration-token-not-registered') ||
                errCode.includes('invalid-registration-token')) {
              invalidTokens.push(batch[idx]);
            }
          }
        });
      }

      // Geçersiz token'ları Firestore'dan temizle
      if (invalidTokens.length) {
        const cleanSnaps = await db.collection('users')
          .where('fcmToken', 'in', invalidTokens.slice(0, 10))
          .get();
        const batch2 = db.batch();
        cleanSnaps.forEach(doc => {
          batch2.update(doc.ref, { fcmToken: '', pushEnabled: false });
        });
        await batch2.commit();
      }

      await snap.ref.update({
        status: 'sent',
        sentCount: successCount,
        failCount,
        sentAt: new Date(),
      });

      console.log(`[Push] Gönderildi: ${successCount}, Hata: ${failCount}`);

    } catch (err) {
      console.error('[Push] Hata:', err);
      await snap.ref.update({ status: 'error', error: err.message });
    }
  }
);
