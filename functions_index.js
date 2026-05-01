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
        clickTarget: url   || DEFAULT_URL,
        image: image || '',
        timestamp: String(Date.now()),
      },
      webpush: {
        headers: {'TTL':'86400'},
        // fcmOptions.link kaldırıldı - SW notificationclick ile yönlendirme yapılıyor
        // Bu satır "URL kopyalamak için dokunun" sorununa neden oluyordu
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

// ════════════════════════════════════════════════════════════════════
// 7. Yeni kullanıcı kaydı → Hoşgeldin push + e-posta + duyuru
//    Firebase Auth trigger (v1) — her yeni kayıtta tetiklenir
//
//    E-posta için Firebase Extension gerekli:
//    https://console.firebase.google.com/project/runclubturkiye/extensions
//    → "Trigger Email from Firestore" extension'ını kur
//    → SMTP ayarlarını gir (Gmail, SendGrid vb.)
//    → Mail collection name: "mail"
// ════════════════════════════════════════════════════════════════════
const functionsV1 = require('firebase-functions');

const WELCOME_EMAIL_HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
      <tr>
        <td style="background:#E8622A;padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;">🏃 RunClub Türkiye</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Türkiye'nin En Büyük Koşu Topluluğu</p>
        </td>
      </tr>
      <tr>
        <td style="padding:36px 40px;">
          <h2 style="margin:0 0 14px;color:#1a1a1a;font-size:20px;">Merhaba {{NAME}}, 👋</h2>
          <p style="margin:0 0 14px;color:#444;font-size:14px;line-height:1.7;">
            <strong>RunClub Türkiye ailesine resmen katıldın!</strong> Artık sadece bir platformun üyesi değil,
            Türkiye'nin en dinamik koşu topluluğunun bir parçasısın.
          </p>
          <p style="margin:0 0 22px;color:#444;font-size:14px;line-height:1.7;">
            Hangi seviyede olursan ol — ister ilk 5K'na hazırlanıyor ol, ister bir ultra maratoncu — burada senin için bir yer var.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf6f2;border-radius:10px;margin-bottom:24px;">
            <tr><td style="padding:22px 26px;">
              <h3 style="margin:0 0 14px;color:#E8622A;font-size:15px;">🚀 RunClub'da Seni Neler Bekliyor?</h3>
              <p style="margin:0 0 10px;color:#333;font-size:13px;line-height:1.7;">
                🏆 <strong>Güncel Yarış Takvimi</strong> — Türkiye ve dünyadaki maraton, yarı maraton ve trail yarışlarını tek listeden takip et, kayıt tarihlerini kaçırma.
              </p>
              <p style="margin:0 0 10px;color:#333;font-size:13px;line-height:1.7;">
                💬 <strong>Yarış Tartışma Merkezi</strong> — Parkurlar, zemin yapısı veya doğru ayakkabı seçimi hakkında diğer koşuculardan gerçek tüyolar al.
              </p>
              <p style="margin:0 0 10px;color:#333;font-size:13px;line-height:1.7;">
                📝 <strong>Yarış Sonrası Raporları</strong> — Kendi deneyimlerini paylaş, diğer koşuculara ilham ver ve topluluk hafızasına katkıda bulun.
              </p>
              <p style="margin:0;color:#333;font-size:13px;line-height:1.7;">
                📊 <strong>Kişisel Dashboard</strong> — Koşu geçmişini, yazdığın yorumları ve aldığın beğenileri profilinden kolayca yönet.
              </p>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:10px;margin-bottom:26px;">
            <tr><td style="padding:22px 26px;">
              <h3 style="margin:0 0 8px;color:#E8622A;font-size:14px;">🔥 Haberdar Ol!</h3>
              <p style="margin:0 0 16px;color:#ccc;font-size:13px;line-height:1.6;">
                En yeni yarış duyurularından, özel topluluk indirimlerinden ve koşu dünyasındaki önemli haberlerden ilk senin haberin olsun!
              </p>
              <a href="https://www.runclubturkiye.com/#newsletter"
                 style="display:inline-block;background:#E8622A;color:#ffffff;font-size:13px;font-weight:700;padding:11px 24px;border-radius:8px;text-decoration:none;">
                📬 Haberdar Ol! Listesine Katıl
              </a>
            </td></tr>
          </table>
          <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
            Koşu ayakkabıların hazırsa, biz de hazırız. Görüşmek üzere!<br/>
            <strong style="color:#E8622A;">RunClub Türkiye Ekibi</strong> 🧡
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#f9f9f9;padding:16px 40px;border-top:1px solid #eee;text-align:center;">
          <p style="margin:0;color:#aaa;font-size:11px;">
            © 2025 RunClub Türkiye &nbsp;·&nbsp;
            <a href="https://www.runclubturkiye.com/privacy-policy.html" style="color:#aaa;">Gizlilik</a> &nbsp;·&nbsp;
            <a href="https://www.runclubturkiye.com/" style="color:#aaa;">Siteye Git</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

exports.onUserCreated = functionsV1.auth.user().onCreate(async (user) => {
  const uid   = user.uid;
  const email = user.email || '';

  console.log(`[Welcome] Yeni kullanıcı: ${uid} (${email})`);

  try {
    // Firestore'da users dokümanının yazılmasını bekle
    await new Promise(r => setTimeout(r, 3000));

    const userDoc = await db.collection('users').doc(uid).get();
    const userData   = userDoc.exists ? userDoc.data() : {};
    const name       = userData.name  || user.displayName || email.split('@')[0] || 'Koşucu';
    const pushEnabled = userData.pushEnabled || false;
    const fcmToken    = userData.fcmToken    || null;

    // 1. Uygulama içi hoşgeldin duyurusu (Firestore announcements)
    await db.collection('announcements').add({
      title:      '🎉 RunClub Türkiye\'ye Hoş Geldin!',
      body:       `Merhaba ${name}! Türkiye'nin en büyük koşu topluluğuna katıldın. Yakındaki kulüpleri keşfet, etkinliklere katıl ve koşu arkadaşları bul.`,
      authorUid:  'system',
      authorName: 'RunClub Türkiye',
      targetUid:  uid,
      isWelcome:  true,
      createdAt:  FieldValue.serverTimestamp(),
    });
    console.log(`[Welcome] Firestore duyurusu oluşturuldu: ${uid}`);

    // 2. Push bildirimi — kullanıcı push'u etkinleştirdiyse gönder
    if (pushEnabled && fcmToken) {
      await db.collection('pushNotifications').add({
        title:       `🎉 Hoş Geldin ${name}!`,
        body:        'RunClub Türkiye\'ye katıldığın için teşekkürler. Hadi bir kulübe katıl! 🏃',
        url:         DEFAULT_URL,
        target:      'single',
        targetUid:   uid,
        targetToken: fcmToken,
        status:      'pending',
        sentBy:      'system-welcome',
        createdAt:   FieldValue.serverTimestamp(),
      });
      console.log(`[Welcome] Push kuyruğa eklendi: ${uid}`);
    }

    // 3. Hoşgeldin e-postası (Firebase Email Extension — "mail" koleksiyonu)
    if (email) {
      const emailHtml = WELCOME_EMAIL_HTML.replace(/\{\{NAME\}\}/g, name);
      await db.collection('mail').add({
        to:      email,
        message: {
          subject:  'RunClub Türkiye\'ye Hoş Geldin! 🏃‍♂️ | Yolculuğumuz Başlıyor',
          html:     emailHtml,
          text:     `Merhaba ${name}, RunClub Türkiye ailesine hoş geldin! Topluluğumuzun bir parçası olduğun için heyecanlıyız. Hadi, beraber koşalım! ${DEFAULT_URL}`,
        },
      });
      console.log(`[Welcome] E-posta kuyruğa eklendi: ${email}`);
    }

  } catch (e) {
    console.error(`[Welcome] Hata (uid:${uid}):`, e.message);
  }
});
