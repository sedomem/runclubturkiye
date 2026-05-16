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

// ════════════════════════════════════════════════════════════════════
// ORTAK: Email şablonu helper'ları
// ════════════════════════════════════════════════════════════════════

const SITE = 'https://www.runclubturkiye.com';

// Şık email wrapper — header + footer her mail için ortak
function emailWrap(headerLabel, headerEmoji, preheaderText, bodyHtml) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="tr" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>RunClub Türkiye</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  *{box-sizing:border-box;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  body{margin:0;padding:0;background-color:#F0EDE8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}
  a{color:#E8622A;text-decoration:none}
  img{border:0;display:block;max-width:100%}
  .email-body{background:#F0EDE8;padding:24px 0 40px}
  .container{max-width:600px;margin:0 auto;padding:0 16px}
  @media(max-width:620px){
    .container{padding:0 12px}
    .content-pad{padding:24px 20px !important}
    .card-grid{display:block !important}
    .card-item{width:100% !important;display:block !important;margin-bottom:12px !important}
    .hero-title{font-size:22px !important}
    .cta-btn{display:block !important;text-align:center !important}
  }
</style>
</head>
<body>
<div class="email-body">
  <div class="container">

    <!-- HEADER -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td style="padding:24px 0 16px;text-align:center;">
          <a href="${SITE}" style="text-decoration:none;">
            <table cellpadding="0" cellspacing="0" role="presentation" style="display:inline-table;">
              <tr>
                <td style="background:#E8622A;border-radius:12px;padding:10px 20px;">
                  <span style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px;font-family:Arial,sans-serif;">
                    ${headerEmoji} RunClub Türkiye
                  </span>
                </td>
              </tr>
            </table>
          </a>
          <p style="margin:8px 0 0;font-size:12px;color:#999;">${preheaderText}</p>
        </td>
      </tr>
    </table>

    <!-- KONU ETİKETİ -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:8px;">
      <tr>
        <td style="text-align:center;">
          <span style="display:inline-block;background:#E8622A;color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:4px 14px;border-radius:20px;">${headerLabel}</span>
        </td>
      </tr>
    </table>

    <!-- ANA İÇERİK -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          ${bodyHtml}
        </td>
      </tr>
    </table>

    <!-- FOOTER -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:24px;">
      <tr>
        <td style="text-align:center;padding:0 16px;">
          <p style="margin:0 0 8px;font-size:12px;color:#999;line-height:1.6;">
            Bu e-postayı aldınız çünkü <a href="${SITE}" style="color:#E8622A;">${SITE.replace('https://','')}</a>'e kayıt oldunuz.
          </p>
          <p style="margin:0;font-size:11px;color:#bbb;">
            <a href="${SITE}/gizlilik" style="color:#bbb;">Gizlilik</a> &nbsp;·&nbsp;
            <a href="${SITE}/kullanim-kosullari" style="color:#bbb;">Koşullar</a> &nbsp;·&nbsp;
            <a href="${SITE}" style="color:#bbb;">Siteye Git</a>
          </p>
          <p style="margin:10px 0 0;font-size:11px;color:#ccc;">© ${year} RunClub Türkiye</p>
        </td>
      </tr>
    </table>

  </div>
</div>
</body>
</html>`;
}

// Tek içerik kartı (blog/etkinlik/yarış/fırsat için)
function contentCard(emoji, tag, tagColor, title, subtitle, excerpt, url, ctaText) {
  return `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:12px;border:1px solid #f0f0f0;border-radius:12px;overflow:hidden;">
  <tr>
    <td style="padding:18px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-bottom:8px;">
            <span style="display:inline-block;background:${tagColor}18;color:${tagColor};font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;padding:3px 10px;border-radius:20px;">${emoji} ${tag}</span>
          </td>
        </tr>
        <tr>
          <td>
            <a href="${url}" style="font-size:16px;font-weight:700;color:#1a1a1a;text-decoration:none;line-height:1.4;display:block;margin-bottom:6px;">${title}</a>
          </td>
        </tr>
        ${subtitle ? `<tr><td style="font-size:12px;color:#888;margin-bottom:6px;padding-bottom:6px;">${subtitle}</td></tr>` : ''}
        ${excerpt ? `<tr><td style="font-size:13px;color:#555;line-height:1.65;padding-bottom:12px;">${excerpt}</td></tr>` : ''}
        <tr>
          <td>
            <a href="${url}" style="display:inline-block;background:#E8622A;color:#fff;font-size:12px;font-weight:700;padding:8px 18px;border-radius:8px;text-decoration:none;">${ctaText} →</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// Özet satırı (birden fazla yarış/etkinlik için kompakt)
function summaryRow(emoji, title, meta, url) {
  return `
<tr>
  <td style="padding:10px 0;border-bottom:1px solid #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="32" style="font-size:20px;vertical-align:top;padding-top:2px;">${emoji}</td>
        <td style="vertical-align:top;">
          <a href="${url}" style="font-size:14px;font-weight:600;color:#1a1a1a;text-decoration:none;display:block;">${title}</a>
          ${meta ? `<span style="font-size:12px;color:#999;">${meta}</span>` : ''}
        </td>
        <td width="80" style="vertical-align:middle;text-align:right;">
          <a href="${url}" style="font-size:11px;font-weight:700;color:#E8622A;text-decoration:none;white-space:nowrap;">Oku →</a>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

// ════════════════════════════════════════════════════════════════════
// 8. Yeni Blog Yazısı → Tüm üyelere bildirim maili
//    Tetikleyici: blog/{docId} oluşturulduğunda (published:true)
// ════════════════════════════════════════════════════════════════════
exports.onBlogPublished = onDocumentCreated(
  {document:'blog/{docId}', region:'europe-west1'},
  async (event) => {
    const docId = event.params.docId;
    const data  = event.data.data();

    // Sadece yayınlanan yazılar
    if (data.draft === true) return;
    console.log(`[Blog Mail] Yeni blog: ${docId} — ${data.title}`);

    const title   = data.title    || 'Yeni Yazı';
    const slug    = data.slug     || docId;
    const excerpt = data.subtitle || (data.body||'').replace(/<[^>]+>/g,'').slice(0,160) + '...';
    const author  = data.authorName || 'RunClub Editör';
    const url     = `${SITE}/haber/${slug}`;

    const bodyHtml = `
      <div class="content-pad" style="padding:32px 36px 36px;">
        <h1 class="hero-title" style="margin:0 0 6px;font-size:26px;font-weight:900;color:#1a1a1a;line-height:1.3;">${title}</h1>
        <p style="margin:0 0 20px;font-size:13px;color:#aaa;">Yazan: ${author}</p>
        <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.75;">${excerpt}</p>
        <a href="${url}" class="cta-btn" style="display:inline-block;background:#E8622A;color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none;">
          Yazının Tamamını Oku →
        </a>
      </div>
      <div style="background:#FDF6F2;padding:20px 36px;border-top:1px solid #f0e8e0;">
        <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
          💡 Koşu dünyasından en güncel içerikler her hafta RunClub Türkiye'de.
          Aklındaki soruları toplulukta paylaşmayı unutma!
        </p>
      </div>`;

    // Push bildirimi gönder (tüm pushEnabled kullanıcılara)
    try {
      const pushTitle = '📰 Yeni Blog Yazısı!';
      const pushBody  = title + (author ? ' — ' + author : '');
      const pushUrl   = url;
      const tokens = await getTargetTokens('', '');
      if (tokens.length) {
        await sendBatch(tokens, pushTitle, pushBody, pushUrl, '');
        console.log('[Blog Push] ' + tokens.length + ' kişiye gönderildi');
      }
    } catch(pushErr) {
      console.warn('[Blog Push] Hata:', pushErr.message);
    }

    // Email digest gönder
    await sendDigestToAllUsers(
      `📰 Yeni Yazı: ${title}`,
      bodyHtml,
      'Yeni Blog Yazısı',
      '📰',
      'Koşu dünyasından yeni bir yazı yayınlandı'
    );
  }
);

// ════════════════════════════════════════════════════════════════════
// 9. Yeni Etkinlik → Tüm üyelere bildirim maili
//    Tetikleyici: events/{docId} oluşturulduğunda
// ════════════════════════════════════════════════════════════════════
exports.onEventCreatedMail = onDocumentCreated(
  {document:'events/{docId}', region:'europe-west1'},
  async (event) => {
    const docId = event.params.docId;
    const data  = event.data.data();

    // Sadece onaylanan etkinlikler
    if (data.status && data.status !== 'approved') return;
    console.log(`[Event Mail] Yeni etkinlik: ${docId} — ${data.title}`);

    const title    = data.title    || 'Yeni Etkinlik';
    const slug     = data.slug     || docId;
    const city     = data.city     || data.location || '';
    const dateStr  = data.date     ? new Date(data.date).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'}) : '';
    const clubName = data.clubName || '';
    const desc     = (data.description||data.desc||'').slice(0,160) + '...';
    const url      = `${SITE}/etkinlik/${slug}`;
    const cap      = data.cap || 0;
    const reg      = data.reg || 0;
    const spotsLeft = cap > 0 ? cap - reg : null;

    const bodyHtml = `
      <div class="content-pad" style="padding:32px 36px 36px;">
        ${spotsLeft !== null && spotsLeft < 20 ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF3CD;border-radius:8px;margin-bottom:16px;">
          <tr><td style="padding:10px 16px;font-size:13px;color:#856404;font-weight:600;">
            ⚡ Sadece ${spotsLeft} yer kaldı! Hemen kayıt ol.
          </td></tr>
        </table>` : ''}
        <h1 class="hero-title" style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1a1a1a;line-height:1.3;">${title}</h1>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
          ${dateStr ? `<tr><td style="padding:3px 0;font-size:13px;color:#666;">📅 <strong>${dateStr}</strong></td></tr>` : ''}
          ${city    ? `<tr><td style="padding:3px 0;font-size:13px;color:#666;">📍 <strong>${city}</strong></td></tr>` : ''}
          ${clubName? `<tr><td style="padding:3px 0;font-size:13px;color:#666;">🤝 <strong>${clubName}</strong></td></tr>` : ''}
        </table>
        ${desc ? `<p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7;">${desc}</p>` : ''}
        <a href="${url}" class="cta-btn" style="display:inline-block;background:#E8622A;color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none;">
          Etkinliği Gör & Katıl →
        </a>
      </div>
      <div style="background:#F5F5F5;padding:16px 36px;border-top:1px solid #eee;">
        <p style="margin:0;font-size:12px;color:#999;">
          Şehrindeki tüm koşu etkinliklerini takip etmek için 
          <a href="${SITE}/etkinlikler" style="color:#E8622A;">etkinlikler sayfasını</a> ziyaret et.
        </p>
      </div>`;

    await sendDigestToAllUsers(
      `📅 Yeni Etkinlik: ${title}${city?' — '+city:''}`,
      bodyHtml,
      'Yeni Etkinlik',
      '📅',
      `${city ? city+' – ' : ''}${dateStr}`
    );
  }
);

// ════════════════════════════════════════════════════════════════════
// 10. Yeni Yarış → Tüm üyelere bildirim maili
//     Tetikleyici: races/{docId} oluşturulduğunda
// ════════════════════════════════════════════════════════════════════
exports.onRaceCreatedMail = onDocumentCreated(
  {document:'races/{docId}', region:'europe-west1'},
  async (event) => {
    const docId = event.params.docId;
    const data  = event.data.data();

    console.log(`[Race Mail] Yeni yarış: ${docId} — ${data.name}`);

    const name      = data.name     || 'Yeni Yarış';
    const slug      = data.slug     || docId;
    const location  = data.location || '';
    const dateStr   = data.date ? new Date(data.date).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'}) : '';
    const distance  = data.distance || '';
    const fee       = data.fee      || '';
    const deadline  = data.regDeadline ? new Date(data.regDeadline).toLocaleDateString('tr-TR',{day:'numeric',month:'long'}) : '';
    const website   = data.website  || `${SITE}/yaris/${slug}`;
    const url       = `${SITE}/yaris/${slug}`;

    // Rapor varsa özet çek
    const reportOzet = data.report?.ozet || '';
    const hasReport  = reportOzet.length > 20;

    const bodyHtml = `
      <div class="content-pad" style="padding:32px 36px 36px;">
        ${deadline ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF0F0;border-radius:8px;margin-bottom:16px;">
          <tr><td style="padding:10px 16px;font-size:13px;color:#c0392b;font-weight:600;">
            ⏰ Kayıt Son Tarihi: ${deadline}
          </td></tr>
        </table>` : ''}

        <h1 class="hero-title" style="margin:0 0 10px;font-size:24px;font-weight:900;color:#1a1a1a;line-height:1.3;">${name}</h1>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
          ${dateStr   ? `<tr><td style="padding:3px 0;font-size:13px;color:#666;">📅 <strong>${dateStr}</strong></td></tr>` : ''}
          ${location  ? `<tr><td style="padding:3px 0;font-size:13px;color:#666;">📍 <strong>${location}</strong></td></tr>` : ''}
          ${distance  ? `<tr><td style="padding:3px 0;font-size:13px;color:#666;">🏃 <strong>${distance}</strong></td></tr>` : ''}
          ${fee       ? `<tr><td style="padding:3px 0;font-size:13px;color:#27ae60;">💰 <strong>${fee}</strong></td></tr>` : ''}
        </table>

        ${hasReport ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF6F2;border-left:4px solid #E8622A;border-radius:0 8px 8px 0;margin-bottom:20px;">
          <tr><td style="padding:14px 18px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#E8622A;text-transform:uppercase;letter-spacing:.5px;">Yarış Özeti</p>
            <p style="margin:0;font-size:14px;color:#444;line-height:1.7;">${reportOzet.slice(0,200).replace(/<[^>]+>/g,'')}${reportOzet.length>200?'...':''}</p>
          </td></tr>
        </table>` : ''}

        <table cellpadding="0" cellspacing="6" style="margin-top:4px;">
          <tr>
            <td>
              <a href="${url}" style="display:inline-block;background:#E8622A;color:#fff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:10px;text-decoration:none;">
                Yarışı İncele →
              </a>
            </td>
            ${website && website !== url ? `
            <td>
              <a href="${website}" style="display:inline-block;background:#1a1a1a;color:#fff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:10px;text-decoration:none;">
                📝 Kayıt Ol
              </a>
            </td>` : ''}
          </tr>
        </table>
      </div>
      <div style="background:#F5F5F5;padding:16px 36px;border-top:1px solid #eee;">
        <p style="margin:0;font-size:12px;color:#999;">
          Tüm yarış takvimini görmek için 
          <a href="${SITE}/yaris-takvimi" style="color:#E8622A;">yarış takvimine</a> göz at.
        </p>
      </div>`;

    await sendDigestToAllUsers(
      `🏆 Yeni Yarış: ${name}${location?' — '+location:''}`,
      bodyHtml,
      'Yeni Yarış',
      '🏆',
      `${dateStr}${location?' · '+location:''}`
    );
  }
);

// ════════════════════════════════════════════════════════════════════
// 11. Haftalık Özet — Her Pazartesi 09:00 (Türkiye saatiyle)
//     Son 7 günün: yeni yarışları, etkinlikleri, blog yazılarını özetler
// ════════════════════════════════════════════════════════════════════
exports.weeklyDigest = onSchedule(
  {schedule:'every monday 09:00', timeZone:'Europe/Istanbul', region:'europe-west1'},
  async () => {
    console.log('[Weekly] Haftalık digest başladı');

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Son 7 günün içerikleri
    const [racesSnap, eventsSnap, blogSnap] = await Promise.all([
      db.collection('races')
        .where('createdAt', '>=', oneWeekAgo)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get(),
      db.collection('events')
        .where('createdAt', '>=', oneWeekAgo)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get(),
      db.collection('blog')
        .where('createdAt', '>=', oneWeekAgo)
        .orderBy('createdAt', 'desc')
        .limit(4)
        .get(),
    ]);

    const races  = [];
    const events = [];
    const blogs  = [];

    racesSnap.forEach(d  => races.push({id:d.id,...d.data()}));
    eventsSnap.forEach(d => events.push({id:d.id,...d.data()}));
    blogSnap.forEach(d   => blogs.push({id:d.id,...d.data()}));

    const total = races.length + events.length + blogs.length;
    if (total === 0) {
      console.log('[Weekly] Bu hafta yeni içerik yok, digest atlandı.');
      return;
    }

    const weekStr = new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'});
    console.log(`[Weekly] ${races.length} yarış, ${events.length} etkinlik, ${blogs.length} blog`);

    // Digest içerik bloğu oluştur
    let raceRows  = '';
    let eventRows = '';
    let blogRows  = '';

    races.forEach(r => {
      const slug = r.slug || r.id;
      const meta = [
        r.date ? new Date(r.date).toLocaleDateString('tr-TR',{day:'numeric',month:'short'}) : '',
        r.location || '',
        r.distance || '',
      ].filter(Boolean).join(' · ');
      raceRows += summaryRow('🏆', r.name || 'Yarış', meta, `${SITE}/yaris/${slug}`);
    });

    events.forEach(e => {
      const slug = e.slug || e.id;
      const meta = [
        e.date ? new Date(e.date).toLocaleDateString('tr-TR',{day:'numeric',month:'short'}) : '',
        e.city || e.location || '',
      ].filter(Boolean).join(' · ');
      eventRows += summaryRow('📅', e.title || 'Etkinlik', meta, `${SITE}/etkinlik/${slug}`);
    });

    blogs.forEach(b => {
      const slug = b.slug || b.id;
      const meta = b.authorName || 'RunClub Editör';
      blogRows += summaryRow('📰', b.title || 'Blog Yazısı', meta, `${SITE}/haber/${slug}`);
    });

    const bodyHtml = `
      <div style="background:#E8622A;padding:28px 36px;">
        <h1 style="margin:0;font-size:22px;font-weight:900;color:#fff;line-height:1.3;">
          Bu Haftanın Özeti 🏃
        </h1>
        <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">${weekStr} haftası</p>
      </div>
      <div class="content-pad" style="padding:24px 36px 32px;">

        ${races.length > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="padding-bottom:10px;border-bottom:2px solid #E8622A;">
              <span style="font-size:16px;font-weight:800;color:#1a1a1a;">🏆 Yeni Yarışlar</span>
              <span style="font-size:12px;color:#999;margin-left:8px;">${races.length} yarış eklendi</span>
            </td>
          </tr>
          ${raceRows}
        </table>` : ''}

        ${events.length > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="padding-bottom:10px;border-bottom:2px solid #3b82f6;">
              <span style="font-size:16px;font-weight:800;color:#1a1a1a;">📅 Yeni Etkinlikler</span>
              <span style="font-size:12px;color:#999;margin-left:8px;">${events.length} etkinlik eklendi</span>
            </td>
          </tr>
          ${eventRows}
        </table>` : ''}

        ${blogs.length > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="padding-bottom:10px;border-bottom:2px solid #10b981;">
              <span style="font-size:16px;font-weight:800;color:#1a1a1a;">📰 Yeni Yazılar</span>
              <span style="font-size:12px;color:#999;margin-left:8px;">${blogs.length} yazı yayınlandı</span>
            </td>
          </tr>
          ${blogRows}
        </table>` : ''}

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;margin-top:8px;">
          <tr>
            <td style="padding:20px 24px;">
              <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#E8622A;">
                🔥 Hepsini Keşfet
              </p>
              <table cellpadding="0" cellspacing="8">
                <tr>
                  <td><a href="${SITE}/yaris-takvimi" style="display:inline-block;background:#E8622A;color:#fff;font-size:12px;font-weight:700;padding:9px 16px;border-radius:8px;text-decoration:none;">Yarış Takvimi</a></td>
                  <td><a href="${SITE}/etkinlikler" style="display:inline-block;background:#3b82f6;color:#fff;font-size:12px;font-weight:700;padding:9px 16px;border-radius:8px;text-decoration:none;">Etkinlikler</a></td>
                  <td><a href="${SITE}/haberler" style="display:inline-block;background:#10b981;color:#fff;font-size:12px;font-weight:700;padding:9px 16px;border-radius:8px;text-decoration:none;">Haberler</a></td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>`;

    await sendDigestToAllUsers(
      `🏃 RunClub Türkiye — Bu Hafta (${weekStr})`,
      bodyHtml,
      'Haftalık Özet',
      '🗓️',
      `${total} yeni içerik — yarışlar, etkinlikler ve yazılar`
    );

    console.log('[Weekly] Digest tamamlandı.');
  }
);

// ════════════════════════════════════════════════════════════════════
// YARDIMCI: Tüm emailOptIn üyelere toplu mail gönder
//   - users koleksiyonunda emailOptIn !== false olanlar
//   - Batch halinde gönderir (Firebase Email Extension üzerinden)
// ════════════════════════════════════════════════════════════════════
async function sendDigestToAllUsers(subject, bodyHtml, headerLabel, headerEmoji, preheaderText) {
  try {
    // emailOptIn === false olanları hariç tut — varsayılan true
    const usersSnap = await db.collection('users')
      .where('emailOptIn', '!=', false)
      .get();

    if (usersSnap.empty) {
      console.log(`[Digest] Alıcı bulunamadı: ${subject}`);
      return;
    }

    const emails = [];
    usersSnap.forEach(doc => {
      const data = doc.data();
      if (data.email && data.email.includes('@')) {
        emails.push({ email: data.email, name: data.name || 'Koşucu' });
      }
    });

    if (!emails.length) {
      console.log(`[Digest] Geçerli email yok: ${subject}`);
      return;
    }

    const html = emailWrap(headerLabel, headerEmoji, preheaderText, bodyHtml);
    const batch = db.batch();
    let count = 0;

    // Firebase Email Extension — her kullanıcıya ayrı mail
    // (kişiselleştirme için) — batch halinde Firestore'a yaz
    for (const { email, name } of emails) {
      const personalHtml = html.replace(/{{NAME}}/g, name);
      const ref = db.collection('mail').doc();
      batch.set(ref, {
        to:      email,
        message: {
          subject,
          html:    personalHtml,
          text:    `${subject}\n\nTüm detaylar için: ${SITE}`,
        },
        createdAt: FieldValue.serverTimestamp(),
        type:      'digest',
      });
      count++;

      // Firestore batch limiti 500
      if (count % 490 === 0) {
        await batch.commit();
        console.log(`[Digest] ${count} mail kuyruğa eklendi`);
      }
    }

    await batch.commit();
    console.log(`[Digest] Toplam ${count} mail kuyruğa eklendi. Konu: ${subject}`);

  } catch (e) {
    console.error('[Digest] Hata:', e.message);
  }
}
