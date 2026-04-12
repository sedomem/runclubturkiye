const{onDocumentCreated}    = require('firebase-functions/v2/firestore');
const{onDocumentDeleted}    = require('firebase-functions/v2/firestore');
const{onCall,HttpsError}    = require('firebase-functions/v2/https');
const{onSchedule}           = require('firebase-functions/v2/scheduler');
const{initializeApp}        = require('firebase-admin/app');
const{getMessaging}         = require('firebase-admin/messaging');
const{getFirestore,FieldValue} = require('firebase-admin/firestore');
initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

const SUPER_EMAIL  = 'sedomem@gmail.com';
const DEFAULT_ICON = 'https://www.runclubturkiye.com/icon-192.png';
const DEFAULT_URL  = 'https://www.runclubturkiye.com/';

// ── Token listesi getir (targetRole + targetClubId destekli) ──────────
async function getTargetTokens(targetRole, targetClubId) {
  let query = db.collection('users').where('pushEnabled','==',true);
  const tokens = [];
  const seenTokens = new Set();

  // targetRole filtresi
  if (targetRole && targetRole !== '') {
    const snap = await db.collection('users')
      .where('pushEnabled','==',true)
      .where('role','==',targetRole)
      .get();
    snap.forEach(doc => {
      const t = doc.data().fcmToken;
      if (t && !seenTokens.has(t)) { seenTokens.add(t); tokens.push({uid:doc.id,token:t}); }
    });
    console.log(`[FCM] targetRole=${targetRole}: ${tokens.length} token`);
    return tokens;
  }

  // targetClubId filtresi — memberships üzerinden
  if (targetClubId && targetClubId !== '') {
    const memSnap = await db.collection('memberships')
      .where('clubId','==',targetClubId)
      .get();
    const uids = [];
    memSnap.forEach(d => {
      const uid = d.data().userId || d.data().uid;
      if (uid && !uids.includes(uid)) uids.push(uid);
    });
    // Her uid için fcmToken çek (50'lik chunk'lar)
    for (let i = 0; i < uids.length; i += 10) {
      const chunk = uids.slice(i, i+10);
      const userSnap = await db.collection('users')
        .where('__name__','in',chunk)
        .get();
      userSnap.forEach(doc => {
        const t = doc.data().fcmToken;
        if (t && !seenTokens.has(t)) { seenTokens.add(t); tokens.push({uid:doc.id,token:t}); }
      });
    }
    console.log(`[FCM] targetClubId=${targetClubId}: ${tokens.length} token`);
    return tokens;
  }

  // Herkese gönder
  const snap = await db.collection('users').where('pushEnabled','==',true).get();
  snap.forEach(doc => {
    const t = doc.data().fcmToken;
    if (t && !seenTokens.has(t)) { seenTokens.add(t); tokens.push({uid:doc.id,token:t}); }
  });
  console.log(`[FCM] all users: ${tokens.length} token`);
  return tokens;
}

// ── Geçersiz tokenleri temizle ────────────────────────────────────────
async function cleanInvalidTokens(invalidTokens) {
  if (!invalidTokens?.length) return;
  const snap = await db.collection('users').where('pushEnabled','==',true).get();
  const batch = db.batch();
  snap.forEach(doc => {
    if (invalidTokens.includes(doc.data().fcmToken)) {
      batch.update(doc.ref, {fcmToken:FieldValue.delete(), pushEnabled:false});
    }
  });
  await batch.commit();
  console.log(`[FCM] ${invalidTokens.length} geçersiz token temizlendi`);
}

// ── Batch FCM gönderim ────────────────────────────────────────────────
async function sendBatch(tokens, title, body, url, image) {
  const results = {success:0, failure:0, invalidTokens:[]};
  if (!tokens.length) return results;
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i,i+500));

  for (const chunk of chunks) {
    const messages = chunk.map(({token}) => ({
      token,
      // DATA-ONLY: tarayıcı "Bu site arka planda güncellendi" göstermesin
      data: {
        title: title || 'RunClubTürkiye',
        body:  body  || '',
        icon:  DEFAULT_ICON,
        url:   url   || DEFAULT_URL,
        image: image || '',
        timestamp: String(Date.now()),
      },
      webpush: {
        headers: {'TTL':'86400'},
        fcmOptions: {link: url || DEFAULT_URL},
      },
      android: {priority:'high'},
      apns: {payload:{aps:{'content-available':1}}},
    }));

    try {
      const response = await fcm.sendEach(messages);
      results.success += response.successCount;
      results.failure += response.failureCount;
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const code = resp.error?.code||'';
          if (code==='messaging/registration-token-not-registered'||
              code==='messaging/invalid-registration-token') {
            results.invalidTokens.push(chunk[idx].token);
          }
          console.warn(`[FCM] Token hatası uid:${chunk[idx].uid} code:${code}`);
        }
      });
    } catch(e) {
      console.error('[FCM] sendEach hatası:', e.message);
      results.failure += chunk.length;
    }
  }
  if (results.invalidTokens.length) await cleanInvalidTokens(results.invalidTokens);
  return results;
}

// ════════════════════════════════════════════════════════════════════
// 1. ANA TETİKLEYİCİ — pushNotifications koleksiyonu
//    targetRole: 'member' | 'groupadmin' | '' (herkese)
//    targetClubId: clubId | '' (filtresiz)
// ════════════════════════════════════════════════════════════════════
exports.onPushNotificationCreated = onDocumentCreated(
  {document:'pushNotifications/{docId}', region:'europe-west1'},
  async (event) => {
    const docId = event.params.docId;
    const data  = event.data.data();
    console.log(`[FCM] Tetiklendi: ${docId}`, JSON.stringify(data));

    if (data.status !== 'pending') { console.log('[FCM] Atlandı:', data.status); return; }
    const ref = db.collection('pushNotifications').doc(docId);
    await ref.update({status:'processing', processedAt:FieldValue.serverTimestamp()});

    try {
      const title  = data.title || 'RunClubTürkiye';
      const body   = data.body  || '';
      const url    = data.url   || DEFAULT_URL;
      const image  = data.image || '';
      const targetRole   = data.targetRole   || '';
      const targetClubId = data.targetClubId || '';

      console.log(`[FCM] title="${title}" target="${data.target}" role="${targetRole}" club="${targetClubId}"`);

      const tokens = await getTargetTokens(targetRole, targetClubId);
      if (!tokens.length) {
        await ref.update({status:'no_subscribers', completedAt:FieldValue.serverTimestamp()});
        return;
      }

      const results = await sendBatch(tokens, title, body, url, image);
      console.log(`[FCM] Tamamlandı: ${results.success} başarı, ${results.failure} hata`);

      await ref.update({
        status:'sent',
        sentCount: results.success,
        failCount: results.failure,
        targetCount: tokens.length,
        completedAt: FieldValue.serverTimestamp(),
      });
    } catch(e) {
      console.error('[FCM] Hata:', e.message);
      await ref.update({status:'error', error:e.message, errorAt:FieldValue.serverTimestamp()}).catch(()=>{});
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// 2. Tek kullanıcıya bildirim (callable)
// ════════════════════════════════════════════════════════════════════
exports.sendPushToUser = onCall({region:'europe-west1'}, async(req) => {
  if (!req.auth || req.auth.token.email !== SUPER_EMAIL)
    throw new HttpsError('permission-denied','Sadece süper admin.');
  const{targetUid,title,body,url,image}=req.data;
  if(!targetUid||!title||!body) throw new HttpsError('invalid-argument','Eksik parametre.');
  const userDoc = await db.collection('users').doc(targetUid).get();
  if(!userDoc.exists) throw new HttpsError('not-found','Kullanıcı bulunamadı.');
  const token = userDoc.data()?.fcmToken;
  if(!token) throw new HttpsError('not-found','FCM token yok.');
  const r = await sendBatch([{uid:targetUid,token}],title,body,url||DEFAULT_URL,image||'');
  return{success:r.success>0,...r};
});

// ════════════════════════════════════════════════════════════════════
// 3. Yeni onaylı etkinlik → otomatik bildirim
// ════════════════════════════════════════════════════════════════════
exports.onEventApproved = onDocumentCreated(
  {document:'events/{eventId}', region:'europe-west1'},
  async(event) => {
    const data = event.data.data();
    if (data.status !== 'approved') return;
    const title = '🏃 Yeni Etkinlik!';
    const body  = `${data.title||data.name||'Etkinlik'} — ${data.location||''}`.trim();
    const url   = `${DEFAULT_URL}#events/${event.params.eventId}`;
    // Kulübün üyelerine veya herkese
    const targetClubId = data.clubId || '';
    const tokens = await getTargetTokens('', targetClubId);
    if (!tokens.length) return;
    await sendBatch(tokens, title, body, url, '');
    console.log(`[FCM] Etkinlik bildirimi: ${tokens.length} token`);
  }
);

// ════════════════════════════════════════════════════════════════════
// 4. Yeni yarış → otomatik bildirim (herkese)
// ════════════════════════════════════════════════════════════════════
exports.onRaceCreated = onDocumentCreated(
  {document:'races/{raceId}', region:'europe-west1'},
  async(event) => {
    const data = event.data.data();
    const title = '🏆 Yeni Yarış Eklendi!';
    const body  = `${data.name||'Yarış'} — ${data.date||''} ${data.location||''}`.trim();
    const url   = `${DEFAULT_URL}#races/${event.params.raceId}`;
    const tokens = await getTargetTokens('','');
    if (!tokens.length) return;
    await sendBatch(tokens, title, body, url, '');
    console.log(`[FCM] Yarış bildirimi gönderildi`);
  }
);

// ════════════════════════════════════════════════════════════════════
// 5. Kullanıcı silinince raceResults temizle
// ════════════════════════════════════════════════════════════════════
exports.onUserDeleted = onDocumentDeleted(
  {document:'users/{userId}', region:'europe-west1'},
  async(event) => {
    const userId = event.params.userId;
    const snap = await db.collection('raceResults').where('userId','==',userId).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`[Cleanup] ${snap.size} raceResult silindi (userId:${userId})`);
  }
);

// ════════════════════════════════════════════════════════════════════
// 6. Her gece 04:00 — eski bildirimleri temizle
// ════════════════════════════════════════════════════════════════════
exports.cleanOldNotifications = onSchedule(
  {schedule:'every day 04:00', timeZone:'Europe/Istanbul', region:'europe-west1'},
  async() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate()-30);
    const snap = await db.collection('pushNotifications').where('createdAt','<',cutoff).get();
    if (snap.empty) { console.log('[Cleanup] Temizlenecek yok.'); return; }
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`[Cleanup] ${snap.size} eski bildirim silindi.`);
  }
);
