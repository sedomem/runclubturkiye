// Hoş geldin e-postalarını uçtan uca test eder (Cloud Shell'de çalıştırılır).
// node test_welcome.js <gmail-kullanici-adi>
// 1) Üye ve bekleyen grup admin olarak iki geçici hesap açar (şifresiz) → onUserCreated tetiklenir
// 2) Grup admin onay e-postasını doğrudan kuyruğa ekler
// 3) Gönderim durumlarını (Trigger Email eklentisi) okur, sonra geçici hesapları ve kayıtları siler
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { groupAdminApprovedTemplate } = require('./emails');

initializeApp({ projectId: 'runclubturkiye' });
const auth = getAuth(), db = getFirestore();
const user = process.argv[2];
if (!user) { console.log('kullanım: node test_welcome.js <gmail-kullanici-adi>'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = Date.now();

async function main() {
  const tests = [
    { uid: 'wtest-uye-' + ts, email: user + '+uyetest@gmail.com', name: 'Test Koşucu', role: 'member' },
    { uid: 'wtest-ga-' + ts, email: user + '+gatest@gmail.com', name: 'Test Yönetici', role: 'pending_groupadmin', clubName: 'Test Koşu Kulübü' },
  ];
  for (const t of tests) {
    await auth.createUser({ uid: t.uid, email: t.email, displayName: t.name });
    await db.collection('users').doc(t.uid).set({ name: t.name, email: t.email, role: t.role, clubName: t.clubName || '', totalKm: 0, eventCount: 0, clubCount: 0, badges: [], isTest: true, createdAt: FieldValue.serverTimestamp() });
    console.log('hesap açıldı:', t.email, t.role);
  }
  const approvedTo = user + '+onaytest@gmail.com';
  const apRef = await db.collection('mail').add({
    to: approvedTo,
    message: {
      subject: '🎉 Tebrikler Test Yönetici! Test Koşu Kulübü artık RunClubTürkiye\'de — Grup Admin panelin açıldı',
      html: groupAdminApprovedTemplate().replace(/\{\{NAME\}\}/g, 'Test Yönetici').replace(/\{\{CLUB_NAME\}\}/g, 'Test Koşu Kulübü'),
      text: 'Test',
    },
  });
  console.log('onay e-postası kuyruğa eklendi:', approvedTo);

  const emails = tests.map((t) => t.email).concat([approvedTo]);
  const found = {};
  for (let i = 0; i < 24 && Object.keys(found).filter((k) => found[k].state === 'SUCCESS' || found[k].state === 'ERROR').length < emails.length; i++) {
    await sleep(5000);
    for (const e of emails) {
      const s = await db.collection('mail').where('to', '==', e).get();
      s.forEach((d) => { const x = d.data(); found[e] = { id: d.id, subject: x.message && x.message.subject, state: x.delivery && x.delivery.state, error: x.delivery && x.delivery.error }; });
    }
  }
  console.log('\n=== SONUÇ ===');
  for (const e of emails) console.log(e, '→', JSON.stringify(found[e] || 'mail kaydı yok'));
  for (const t of tests) {
    const a = await db.collection('announcements').where('targetUid', '==', t.uid).get();
    console.log('duyuru', t.role, '→', a.size ? a.docs[0].data().title : 'yok');
    a.forEach((d) => d.ref.delete());
  }
  // temizlik (mail kayıtları gönderim geçmişi olarak kalır, test hesapları silinir)
  for (const t of tests) {
    await auth.deleteUser(t.uid).catch(() => {});
    await db.collection('users').doc(t.uid).delete().catch(() => {});
  }
  console.log('test hesapları silindi');
}
main().then(() => process.exit(0)).catch((e) => { console.error('HATA', e.message); process.exit(1); });
