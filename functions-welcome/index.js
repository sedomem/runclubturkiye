// Yeni kullanıcı kaydı → hoş geldin duyurusu + (varsa) push + e-posta
// Tek başına dağıtılan 1. nesil Auth tetikleyicisi (onUserCreated, us-central1).
// Dağıtım: gcloud functions deploy onUserCreated --no-gen2 --region=us-central1 --runtime=nodejs22 \
//   --trigger-event=providers/firebase.auth/eventTypes/user.create --trigger-resource=runclubturkiye \
//   --entry-point=onUserCreated --source=. --project=runclubturkiye
const functions = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { memberWelcome, groupAdminPending, SITE } = require('./emails');

initializeApp();
const db = getFirestore();

exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid;
  const email = user.email || '';
  console.log('[Welcome] Yeni kullanıcı: ' + uid);
  try {
    // users dokümanının yazılmasını bekle (ad, rol, kulüp adı)
    let data = {};
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const snap = await db.collection('users').doc(uid).get();
      if (snap.exists) { data = snap.data(); if (data.name) break; }
    }
    const name = data.name || user.displayName || (email.split('@')[0]) || 'Koşucu';
    const isGA = data.role === 'pending_groupadmin';

    await db.collection('announcements').add({
      title: isGA ? '✅ Kulüp başvurun alındı' : '🎉 RunClubTürkiye\'ye hoş geldin!',
      body: isGA
        ? 'Merhaba ' + name + '! ' + (data.clubName || 'Kulübün') + ' için başvurunu inceliyoruz. Onaylanınca Grup Admin panelin açılacak.'
        : 'Merhaba ' + name + '! Profilini tamamla, şehrindeki bir kulübe katıl ve bildirimleri aç. Koşu dosyalarını yükleyip yarış sonuçlarını story kartı olarak paylaşabilirsin.',
      authorUid: 'system', authorName: 'RunClubTürkiye', targetUid: uid, isWelcome: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (data.pushEnabled && data.fcmToken) {
      await db.collection('pushNotifications').add({
        title: '🎉 Hoş geldin ' + name + '!',
        body: isGA ? 'Kulüp başvurun alındı, onaylanınca haber vereceğiz.' : 'Hadi bir kulübe katıl ve ilk koşunu ekle! 🏃',
        url: SITE + '/', target: 'single', targetUid: uid, targetToken: data.fcmToken,
        status: 'pending', sentBy: 'system-welcome', createdAt: FieldValue.serverTimestamp(),
      });
    }

    if (email) {
      await db.collection('mail').add({
        to: email,
        message: isGA ? {
          subject: '✅ Başvurun alındı ' + name + ' — ' + (data.clubName || 'kulübün') + ' yakında RunClubTürkiye\'de',
          html: groupAdminPending(name, data.clubName),
          text: 'Merhaba ' + name + ', grup yöneticisi başvurun alındı. Onaylanınca Grup Admin panelin açılacak ve sana e-posta göndereceğiz. ' + SITE,
        } : {
          subject: '🏃 Hoş geldin ' + name + '! RunClubTürkiye\'de seni neler bekliyor',
          html: memberWelcome(name),
          text: 'Merhaba ' + name + ', RunClubTürkiye\'ye hoş geldin! Profilini tamamla, bir kulübe katıl, koşularını yükle ve yarış sonuçlarını story kartı olarak paylaş. Panelin: ' + SITE + '/?go=dashboard',
        },
      });
      console.log('[Welcome] E-posta kuyruğa eklendi (' + (isGA ? 'grup admin' : 'üye') + ')');
    }
  } catch (e) {
    console.error('[Welcome] Hata (uid:' + uid + '):', e.message);
  }
});
