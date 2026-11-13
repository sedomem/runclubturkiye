// Türkiye'nin 81 ili + şehir eşleştirme yardımcıları (sitemap ve ön-render ortak)
const PROVINCES = ['Adana','Adıyaman','Afyonkarahisar','Ağrı','Aksaray','Amasya','Ankara','Antalya','Ardahan','Artvin','Aydın','Balıkesir','Bartın','Batman','Bayburt','Bilecik','Bingöl','Bitlis','Bolu','Burdur','Bursa','Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Düzce','Edirne','Elazığ','Erzincan','Erzurum','Eskişehir','Gaziantep','Giresun','Gümüşhane','Hakkari','Hatay','Iğdır','Isparta','İstanbul','İzmir','Kahramanmaraş','Karabük','Karaman','Kars','Kastamonu','Kayseri','Kilis','Kırıkkale','Kırklareli','Kırşehir','Kocaeli','Konya','Kütahya','Malatya','Manisa','Mardin','Mersin','Muğla','Muş','Nevşehir','Niğde','Ordu','Osmaniye','Rize','Sakarya','Samsun','Şanlıurfa','Siirt','Sinop','Sivas','Şırnak','Tekirdağ','Tokat','Trabzon','Tunceli','Uşak','Van','Yalova','Yozgat','Zonguldak'];
const ALIASES = { urfa: 'Şanlıurfa', maras: 'Kahramanmaraş', afyon: 'Afyonkarahisar', antep: 'Gaziantep', icel: 'Mersin', izmit: 'Kocaeli' };
function slugify(s) {
  return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const BY_SLUG = {}; PROVINCES.forEach(p => { BY_SLUG[slugify(p)] = p; });
function cityOf(text) {
  if (!text) return null;
  const parts = String(text).split(',');
  const scan = t => { const toks = slugify(t).split('-'); for (let i = toks.length - 1; i >= 0; i--) { if (BY_SLUG[toks[i]]) return BY_SLUG[toks[i]]; if (ALIASES[toks[i]]) return ALIASES[toks[i]]; } return null; };
  return scan(parts[parts.length - 1]) || scan(text);
}
// Bulunma eki: İstanbul'da, Erzurum'da, Muş'ta, Ordu'da, İzmir'de
function loc(name) {
  const l = String(name).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
  const v = (l.match(/[aıoueiöü]/g) || ['e']).pop();
  const back = /[aıou]/.test(v);
  const t = /[çfhkpsşt]$/.test(l);
  return name + "'" + (t ? 't' : 'd') + (back ? 'a' : 'e');
}
module.exports = { PROVINCES, slugify, cityOf, loc, BY_SLUG };
