// RunClubTürkiye e-posta şablonları (hoş geldin + grup yöneticisi)
// Not: Şablonlarda ters tırnak ve ${ kullanılmaz; index.html'e de gömülebilsin diye.
const SITE = 'https://www.runclubturkiye.com';
const OR = '#E8622A';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function btn(href, label, dark) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;margin:4px 6px 4px 0"><tr><td style="background:' + (dark ? '#121010' : OR) + ';border-radius:10px">'
    + '<a href="' + href + '" style="display:inline-block;padding:13px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">' + label + '</a></td></tr></table>';
}
function h2(t) { return '<h2 style="margin:30px 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;color:#121010">' + t + '</h2>'; }
function p(t, st) { return '<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.65;color:#3b3b3b;' + (st || '') + '">' + t + '</p>'; }
// ikon + başlık + açıklama satırları
function rows(items) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + items.map((it) =>
    '<tr><td valign="top" style="width:44px;padding:0 0 14px"><div style="width:36px;height:36px;border-radius:10px;background:#FDF0EA;text-align:center;line-height:36px;font-size:18px">' + it[0] + '</div></td>'
    + '<td valign="top" style="padding:0 0 14px 6px;font-family:Arial,Helvetica,sans-serif">'
    + '<div style="font-size:14.5px;font-weight:700;color:#121010;margin:1px 0 3px">' + (it[3] ? '<a href="' + it[3] + '" style="color:#121010;text-decoration:none">' + it[1] + ' <span style="color:' + OR + '">›</span></a>' : it[1]) + '</div>'
    + '<div style="font-size:13.5px;line-height:1.55;color:#5b5b5b">' + it[2] + '</div></td></tr>').join('') + '</table>';
}
// numaralı adımlar
function steps(items) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7F2;border:1px solid #F6D9C9;border-radius:14px"><tr><td style="padding:18px 20px 6px">'
    + items.map((it, i) => '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top" style="width:34px;padding:0 0 12px"><div style="width:26px;height:26px;border-radius:50%;background:' + OR + ';color:#fff;text-align:center;line-height:26px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700">' + (i + 1) + '</div></td>'
      + '<td valign="top" style="padding:3px 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#3b3b3b"><b style="color:#121010">' + it[0] + '</b> ' + it[1] + '</td></tr></table>').join('')
    + '</td></tr></table>';
}
function box(title, inner) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#16171B;border-radius:14px;margin-top:8px"><tr><td style="padding:20px 22px;font-family:Arial,Helvetica,sans-serif">'
    + '<div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#F0A070;text-transform:uppercase;margin-bottom:10px">' + title + '</div>'
    + '<div style="font-size:13.5px;line-height:1.7;color:#E9E9EC">' + inner + '</div></td></tr></table>';
}

function wrap(preheader, heroKicker, heroTitle, body) {
  const y = new Date().getFullYear();
  return '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="x-apple-disable-message-reformatting"/><title>RunClubTürkiye</title>'
    + '<style>@media(max-width:620px){.pad{padding:26px 20px!important}.hero{font-size:24px!important}}</style></head>'
    + '<body style="margin:0;padding:0;background:#F2EFEA">'
    + '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + preheader + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2EFEA"><tr><td align="center" style="padding:26px 12px 40px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">'
    // logo
    + '<tr><td align="center" style="padding:4px 0 18px"><a href="' + SITE + '"><img src="' + SITE + '/logo.png" width="200" height="41" alt="RunClubTürkiye" style="display:block;border:0;width:200px;height:auto"/></a></td></tr>'
    // kart
    + '<tr><td style="background:#ffffff;border-radius:18px;overflow:hidden">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
    + '<tr><td style="height:6px;background:' + OR + ';font-size:0;line-height:0">&nbsp;</td></tr>'
    + '<tr><td class="pad" style="padding:34px 40px 36px">'
    + '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2.5px;color:' + OR + ';text-transform:uppercase;margin-bottom:8px">' + heroKicker + '</div>'
    + '<h1 class="hero" style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;color:#121010;font-weight:900">' + heroTitle + '</h1>'
    + body
    + '</td></tr></table></td></tr>'
    // alt bilgi
    + '<tr><td align="center" style="padding:22px 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#8a8580">'
    + '<a href="https://www.instagram.com/runclubturkiye/" style="color:' + OR + ';font-weight:700;text-decoration:none">Instagram @runclubturkiye</a> &nbsp;·&nbsp; <a href="' + SITE + '" style="color:' + OR + ';font-weight:700;text-decoration:none">runclubturkiye.com</a><br/>'
    + 'Sorun mu var? Bu e-postayı yanıtla ya da <a href="mailto:runclubturkiye@gmail.com" style="color:#8a8580">runclubturkiye@gmail.com</a> adresine yaz.<br/>'
    + '© ' + y + ' RunClubTürkiye &nbsp;·&nbsp; <a href="' + SITE + '/gizlilik" style="color:#8a8580">Gizlilik</a> &nbsp;·&nbsp; <a href="' + SITE + '/kullanim-kosullari" style="color:#8a8580">Kullanım Koşulları</a>'
    + '</td></tr></table></td></tr></table></body></html>';
}

const SITE_FEATURES = [
  ['🏁', 'Yarış Takvimi', 'Türkiye\'deki maraton, yarı maraton, 10K, trail ve ultra yarışları tek listede. Şehre, mesafeye ve tarihe göre filtrele; kayıt bitmeden hatırlatıcı kur.', SITE + '/yaris-takvimi'],
  ['🤝', 'Kulüpler', 'Şehrindeki koşu kulüplerini bul, tek tıkla katıl; kulübünün antrenman ve yarış takvimi paneline gelsin.', SITE + '/kulupler'],
  ['📅', 'Etkinlikler', 'Grup koşuları, antrenmanlar ve buluşmalar. Kaydol, dijital kartındaki QR ile girişini yap.', SITE + '/etkinlikler'],
  ['🎁', 'Fırsatlar', 'Yarış kayıtlarında ve koşu ürünlerinde <b>sadece üyelere özel</b> indirim kodları. Kodlar giriş yaptığında görünür.', SITE + '/firsatlar'],
  ['📰', 'Rehber ve 360° Yarış Değerlendirmeleri', 'Antrenman rehberleri, yarış haberleri ve tamamlanan yarışların puanlı değerlendirme raporları.', SITE + '/haberler'],
  ['💬', 'Topluluk', 'Koşucularla paylaş, yarışlar hakkında soru sor, deneyimini anlat.', SITE + '/topluluk'],
];
const MEMBER_DASH = [
  ['🏠', 'Genel', 'Etkinlik, kulüp, km ve rozet özetin; son yarışın ve haftalık km\'n tek bakışta. <b>Dijital kartın (QR)</b> de burada.'],
  ['🏃', 'Koşu &amp; Yarış', 'Saatinden ya da Strava\'dan aldığın <b>GPX / TCX / FIT</b> dosyasını yükle: mesafe, pace, tırmanış ve rota otomatik çıkar. Haftalık, aylık ve yıllık km\'n hesaplanır.'],
  ['🏅', 'Yarış Sonuçlarım', 'Bitirdiğin yarışı ekle; pace ve <b>kişisel rekorların</b> (5K, 10K, yarı maraton, maraton) otomatik güncellenir.'],
  ['📲', 'Story Kartı', 'Her yarış sonucun için hazır <b>Instagram story / gönderi kartı</b>: kendi fotoğrafınla ya da rotanla, tek dokunuşla Instagram, WhatsApp ve Facebook\'ta paylaş.'],
  ['🗓', 'Kulüp Takvimi', 'Üyesi olduğun kulübün antrenmanları ve birlikte koşacağınız yarışlar; tek tıkla katılım.'],
  ['🔔', 'Bildirimler ve Rozetler', 'Kulüp duyuruları, yeni yarışlar ve fırsatlar; koştukça kazandığın rozetler.'],
];

function memberWelcome(name) {
  const n = esc(name || 'Koşucu');
  const body = p('RunClubTürkiye\'ye katıldığın için çok mutluyuz. Yarışlar, kulüpler, etkinlikler ve koşu geçmişin artık tek yerde. İlk 5K\'na hazırlanıyor ya da ultra koşuyor olsan da burası senin yerin.')
    + h2('3 adımda başla')
    + steps([
      ['Profilini tamamla.', 'Fotoğrafını, şehrini ve tişört bedenini ekle; etkinlik kayıtların hızlansın.'],
      ['Bir kulübe katıl.', 'Şehrindeki kulüpleri gör, katıl; kulüp antrenmanları panelinde görünsün.'],
      ['Bildirimleri aç.', 'Yeni yarışlar, kayıt son günleri ve üyelere özel fırsatlar ilk sana gelsin.'],
    ])
    + '<div style="padding:18px 0 4px">' + btn(SITE + '/?go=dashboard', 'Panelime git →') + btn(SITE + '/yaris-takvimi', 'Yarış takvimini aç', true) + '</div>'
    + h2('Panelinde neler yapabilirsin?')
    + p('Sağ üstteki <b>Dashboard</b> düğmesiyle (telefonda alttaki menüden) paneline ulaşırsın:', 'color:#5b5b5b;font-size:13.5px')
    + rows(MEMBER_DASH)
    + h2('Sitede seni neler bekliyor?')
    + rows(SITE_FEATURES)
    + box('İpucu', 'Siteyi telefonunun ana ekranına ekle: tarayıcı menüsünden <b style="color:#fff">"Ana ekrana ekle"</b> de; RunClubTürkiye uygulama gibi açılsın, bildirimler anında gelsin.')
    + p('<br/>Görüşmek üzere, iyi koşular! 🧡<br/><b style="color:' + OR + '">RunClubTürkiye Ekibi</b>', 'margin-top:8px');
  return wrap('Hoş geldin ' + n + '! Yarış takvimi, kulüpler, story kartları ve daha fazlası seni bekliyor.', 'Hoş geldin', 'Merhaba ' + n + ', koşu yolculuğun artık tek yerde 🏃', body);
}

const GA_PANEL = [
  ['📅', 'Etkinlikler', 'Grup koşusu ve antrenman oluştur (tarih, mesafe, kontenjan, ücret, pace grupları). Onaydan sonra sitede ve kulüp sayfanda yayınlanır.'],
  ['🗓', 'Etkinlik Takvimi ve Kulüp Yarışları', 'Haftalık antrenman programını ve kulüpçe katılacağınız yarışları ekle; üyelerinin panelinde otomatik görünür.'],
  ['👥', 'Üyeler ve Başvurular', 'Kulübüne katılmak isteyenleri onayla, üye listeni yönet, etkinlik katılımcılarını gör.'],
  ['📢', 'Duyurular ve Mesajlaşma', 'Üyelerine duyuru gönder; bildirim olarak paneline düşsün. Üyelerinle mesajlaş.'],
  ['🏅', 'Performanslar ve İstatistikler', 'Üyelerinin yarış sonuçları, en aktif üyeler ve katılım istatistikleri.'],
  ['⚙', 'Kulüp Ayarları', 'Logo, kapak görseli, açıklama, şehir ve sosyal medya hesapların. İyi görsel ve açıklama, kulüp sayfanı aramalarda öne çıkarır.'],
];

function groupAdminPending(name, club) {
  const n = esc(name || 'Koşucu'), c = esc(club || 'kulübün');
  const body = p('<b>' + c + '</b> için grup yöneticisi başvurun bize ulaştı. Ekibimiz başvurunu inceleyip en kısa sürede onaylayacak; onaylandığında sana ayrıca e-posta göndereceğiz.')
    + box('Sırada ne var?', '1. Başvurun incelenir (genellikle 1-2 iş günü).<br/>2. Onay e-postası gelir; giriş yaptığında menüde <b style="color:#fff">Grup Admin Paneli</b> açılır.<br/>3. Kulüp sayfanı kurar, ilk etkinliğini yayınlarsın.')
    + h2('Onaydan sonra panelinde neler olacak?')
    + rows(GA_PANEL)
    + h2('Bu arada üye olarak hemen kullanabileceklerin')
    + rows(SITE_FEATURES.slice(0, 4))
    + '<div style="padding:12px 0 4px">' + btn(SITE, 'Siteye git →') + '</div>'
    + p('<br/>Topluluğumuza kulübünle katıldığın için teşekkürler! 🧡<br/><b style="color:' + OR + '">RunClubTürkiye Ekibi</b>');
  return wrap('Başvurun alındı. Onaydan sonra kulüp panelin açılacak.', 'Kulüp başvurusu alındı', 'Merhaba ' + n + ', başvurun elimizde ✅', body);
}

// index.html (süper admin onayı) için yer tutuculu şablon: {{NAME}}, {{CLUB_NAME}}
function groupAdminApprovedTemplate() {
  const body = p('Tebrikler! <b>{{CLUB_NAME}}</b> için grup yöneticisi başvurun <b>onaylandı</b>. Kulübün artık RunClubTürkiye\'de; giriş yaptığında menüde <b>Grup Admin Paneli</b> seni bekliyor.')
    + h2('İlk 15 dakikada kulübünü hazırla')
    + steps([
      ['Kulüp Ayarları:', 'logo, kapak görseli, kısa açıklama, şehir ve Instagram hesabını ekle.'],
      ['İlk etkinliğini oluştur:', 'haftalık grup koşunu ya da antrenmanını yayınla; üyeler sitede kaydolsun.'],
      ['Takvimi doldur:', 'antrenman programını ve kulüpçe katılacağınız yarışları ekle.'],
      ['Üyelerini davet et:', 'kulüp sayfanın linkini WhatsApp grubunda ve Instagram\'da paylaş; başvuruları panelden onayla.'],
    ])
    + '<div style="padding:18px 0 4px">' + btn(SITE + '/?go=panel', 'Grup Admin Paneline git →') + '</div>'
    + h2('Panelinde neler yapabilirsin?')
    + rows(GA_PANEL)
    + box('Üyelerine sunduklarımız', 'Kulübüne katılan her koşucu kendi panelinde kulüp takvimini görür, etkinliklere kaydolur, koşu dosyalarını yükleyip haftalık km\'sini takip eder ve yarış sonuçlarını <b style="color:#fff">story kartı</b> olarak paylaşır. Paylaşılan her kartta kulübünün adı yer alır.')
    + p('<br/>Herhangi bir konuda yardıma ihtiyacın olursa bu e-postayı yanıtlaman yeterli.<br/>İyi koşular! 🧡<br/><b style="color:' + OR + '">RunClubTürkiye Ekibi</b>', 'margin-top:8px');
  return wrap('{{CLUB_NAME}} artık RunClubTürkiye\'de! Grup Admin panelin açıldı.', 'Başvurun onaylandı', 'Tebrikler {{NAME}}, kulübün yayında! 🎉', body);
}

module.exports = { memberWelcome, groupAdminPending, groupAdminApprovedTemplate, SITE };
