// RunClubTürkiye — arama motorları için sunucu tarafı ön-render (Vercel Serverless Function)
// Detay sayfalarında (/haber, /yaris, /kulup, /etkinlik) ve ana bölüm sayfalarında
// doğru <title>, açıklama, canonical, Open Graph, JSON-LD ve okunabilir içerik HTML'de hazır gelir.
// Uygulama yüklendiğinde ön-render bloğu kaldırılır; kullanıcı aynı içeriği SPA'da görür.
const fs = require('fs');
const path = require('path');

const SITE = 'https://www.runclubturkiye.com';
const FS = 'https://firestore.googleapis.com/v1/projects/runclubturkiye/databases/(default)/documents';
const BRAND = 'RunClub Türkiye';
const DEFAULT_IMG = SITE + '/og-image.png';

let BASE = null;
async function baseHtml() {
  if (BASE) return BASE;
  try { BASE = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8'); }
  catch (e) { BASE = await (await fetch(SITE + '/index.html')).text(); }
  return BASE;
}

function val(v) {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.arrayValue) return (v.arrayValue.values || []).map(val);
  return undefined;
}
function obj(doc) {
  const o = { id: doc.name.split('/').pop() };
  Object.entries(doc.fields || {}).forEach(([k, v]) => { o[k] = val(v); });
  return o;
}
async function bySlug(collection, slug) {
  const r = await fetch(`${FS}:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: 'slug' }, op: 'EQUAL', value: { stringValue: slug } } }, limit: 1 } }),
  });
  if (!r.ok) throw new Error('firestore ' + r.status);
  const j = await r.json(); const d = (j || []).find(x => x.document); if (d) return obj(d.document);
  return byId(collection, slug);
}
async function byId(collection, id) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  const r = await fetch(`${FS}/${collection}/${id}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('firestore ' + r.status);
  return obj(await r.json());
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function short(s, n) { s = plain(s); if (s.length <= n) return s; s = s.slice(0, n - 3); return s.slice(0, Math.max(s.lastIndexOf(' '), n - 40)) + '…'; }
const safeBody = h => String(h || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<(iframe|object|embed|style)[\s\S]*?<\/\1>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
function trDate(d) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : (d || ''); }

const PAGES = {
  'yaris-takvimi': ['Koşu Yarışları Takvimi 2026–2027 — Maraton, Yarı Maraton, Trail ve Ultra', 'Türkiye\'deki tüm koşu yarışları tek takvimde: maraton, yarı maraton, 10K, trail ve ultra yarışların tarihleri, şehirleri ve kayıt bilgileri.'],
  'kulupler': ['Koşu Kulüpleri ve Koşu Grupları — Türkiye', 'Şehrindeki koşu kulüplerini ve grup koşularını keşfet, ücretsiz üye ol ve birlikte koş.'],
  'haberler': ['Koşu Rehberleri ve Haberleri — Antrenman, Beslenme, Yarış', 'Koşu antrenmanı, beslenme, sakatlık önleme ve yarış haberleri: koşucular için pratik rehberler.'],
  'etkinlikler': ['Koşu Etkinlikleri ve Grup Koşuları', 'Kulüplerin düzenlediği grup koşuları ve koşu etkinlikleri. Katıl, birlikte koş.'],
  'topluluk': ['Koşu Topluluğu', 'Türkiye koşu topluluğunun paylaşımları, koşu kayıtları ve motivasyon akışı.'],
  'tartismalar': ['Yarış Tartışma Merkezi', 'Koşucuların yarış deneyimleri, parkur yorumları ve tavsiyeleri.'],
  'firsatlar': ['Koşucular İçin Fırsatlar', 'Koşu ekipmanı ve yarış kayıtlarında koşuculara özel fırsatlar.'],
  'hakkimizda': ['Hakkımızda', 'RunClub Türkiye, Türkiye\'deki koşu yarışlarını, kulüplerini ve koşucuları bir araya getiren ücretsiz topluluk platformudur.'],
  'iletisim': ['İletişim', 'RunClub Türkiye ile iletişime geç: runclubturkiye@gmail.com'],
  'sss': ['Sıkça Sorulan Sorular', 'RunClub Türkiye üyelik, kulüp, yarış takvimi ve etkinlikler hakkında sıkça sorulan sorular.'],
  'kvkk': ['KVKK Aydınlatma Metni', 'RunClub Türkiye kişisel verilerin korunması aydınlatma metni.'],
  'gizlilik': ['Gizlilik Politikası', 'RunClub Türkiye gizlilik politikası.'],
  'kullanim-kosullari': ['Kullanım Koşulları', 'RunClub Türkiye kullanım koşulları.'],
};

function apply(html, m) {
  const t = esc(m.title), d = esc(m.desc), u = esc(m.url), img = esc(m.image || DEFAULT_IMG);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`);
  html = html.replace(/<meta name="description"[^>]*>/g, `<meta name="description" content="${d}"/>`);
  html = html.replace(/<link rel="canonical"[^>]*>/g, `<link rel="canonical" href="${u}"/>`);
  html = html.replace(/<meta property="og:url"[^>]*>/g, `<meta property="og:url" content="${u}"/>`);
  html = html.replace(/<meta property="og:title"[^>]*>/g, `<meta property="og:title" content="${t}"/>`);
  html = html.replace(/<meta property="og:description"[^>]*>/g, `<meta property="og:description" content="${d}"/>`);
  html = html.replace(/<meta property="og:image"[^>]*>/g, `<meta property="og:image" content="${img}"/>`);
  html = html.replace(/<meta property="og:type"[^>]*>/g, `<meta property="og:type" content="${m.ogType || 'website'}"/>`);
  html = html.replace(/<meta name="twitter:title"[^>]*>/g, `<meta name="twitter:title" content="${t}"/>`);
  html = html.replace(/<meta name="twitter:description"[^>]*>/g, `<meta name="twitter:description" content="${d}"/>`);
  html = html.replace(/<meta name="twitter:image"[^>]*>/g, `<meta name="twitter:image" content="${img}"/>`);
  if (m.jsonld) html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(m.jsonld).replace(/</g, '\\u003c')}</script>\n</head>`);
  if (m.content) {
    const block = `<div id="ssr-seo" style="max-width:820px;margin:0 auto;padding:96px 16px 32px;font-family:system-ui,sans-serif;line-height:1.6">${m.content}</div>` +
      `<script>window.addEventListener('load',function(){var e=document.getElementById('ssr-seo');if(e)e.parentNode.removeChild(e);});</script>`;
    html = html.replace(/<body>/, '<body>\n' + block);
  }
  return html;
}

async function meta(t, s) {
  if (t === 'page') {
    const p = PAGES[s]; if (!p) return null;
    return { title: `${p[0]} | ${BRAND}`, desc: p[1], url: `${SITE}/${s}` };
  }
  if (t === 'haber') {
    const b = await bySlug('blog', s); if (!b || (b.status && b.status !== 'published')) return null;
    const url = `${SITE}/haber/${b.slug || b.id}`;
    const title = b.metaTitle || b.title;
    const desc = short(b.metaDesc || b.body, 158);
    return {
      title: `${title} | ${BRAND}`, desc, url, image: b.coverUrl, ogType: 'article',
      jsonld: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: b.title, description: desc, image: b.coverUrl || DEFAULT_IMG, datePublished: b.publishedAt || b.createdAt, dateModified: b.updatedAt || b.publishedAt || b.createdAt, author: { '@type': 'Organization', name: b.authorName || BRAND }, publisher: { '@type': 'Organization', name: BRAND, logo: { '@type': 'ImageObject', url: SITE + '/icon-192.png' } }, mainEntityOfPage: url, inLanguage: 'tr-TR', keywords: (b.tags || []).join(', ') },
      content: `<nav style="font-size:13px"><a href="/">Ana Sayfa</a> › <a href="/haberler">Koşu Rehberleri</a></nav><article><h1>${esc(b.title)}</h1>${b.kategori ? `<p style="color:#888">${esc(b.kategori)}</p>` : ''}${safeBody(b.body)}</article>`,
    };
  }
  if (t === 'yaris') {
    const r = await bySlug('races', s); if (!r) return null;
    const url = `${SITE}/yaris/${r.slug || r.id}`;
    const where = r.location || r.city || '';
    const desc = short(`${r.name} — ${where}${r.date ? ', ' + trDate(r.date) : ''}${r.distance ? '. Mesafeler: ' + r.distance : ''}. ${plain(r.about)}`, 158);
    const ld = { '@context': 'https://schema.org', '@type': 'SportsEvent', name: r.name, description: desc, startDate: r.date, eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', sport: 'Running', image: r.imgUrl || DEFAULT_IMG, location: { '@type': 'Place', name: where || r.name, address: { '@type': 'PostalAddress', addressLocality: where, addressCountry: 'TR' } }, url };
    if (r.website) ld.organizer = { '@type': 'Organization', name: r.name, url: r.website };
    return {
      title: `${r.name}${r.date ? ' — ' + trDate(r.date) : ''} | ${BRAND}`, desc, url, image: r.imgUrl, jsonld: ld,
      content: `<nav style="font-size:13px"><a href="/">Ana Sayfa</a> › <a href="/yaris-takvimi">Yarış Takvimi</a></nav><h1>${esc(r.name)}</h1><ul>${r.date ? `<li><b>Tarih:</b> ${esc(trDate(r.date))}</li>` : ''}${where ? `<li><b>Yer:</b> ${esc(where)}</li>` : ''}${r.distance ? `<li><b>Mesafeler:</b> ${esc(r.distance)}</li>` : ''}${r.regDeadline ? `<li><b>Son kayıt:</b> ${esc(trDate(r.regDeadline))}</li>` : ''}${r.fee ? `<li><b>Ücret:</b> ${esc(r.fee)}</li>` : ''}</ul>${r.about ? `<p>${esc(plain(r.about))}</p>` : ''}${r.website ? `<p><a href="${esc(r.website)}" rel="nofollow noopener">Resmi web sitesi</a></p>` : ''}`,
    };
  }
  if (t === 'kulup') {
    const c = await byId('clubs', s); if (!c || !c.name) return null;
    const url = `${SITE}/kulup/${c.id}`;
    const desc = short(`${c.name}${c.city ? ' — ' + c.city + ' koşu kulübü' : ' koşu kulübü'}. ${plain(c.desc)}`, 158);
    return {
      title: `${c.name}${c.city ? ' — ' + c.city : ''} Koşu Kulübü | ${BRAND}`, desc, url, image: c.imgUrl,
      jsonld: { '@context': 'https://schema.org', '@type': 'SportsClub', name: c.name, description: desc, image: c.imgUrl || DEFAULT_IMG, url, sport: 'Running', address: { '@type': 'PostalAddress', addressLocality: c.city || '', addressCountry: 'TR' } },
      content: `<nav style="font-size:13px"><a href="/">Ana Sayfa</a> › <a href="/kulupler">Koşu Kulüpleri</a></nav><h1>${esc(c.name)}</h1>${c.city ? `<p><b>Şehir:</b> ${esc(c.city)}</p>` : ''}${c.desc ? `<p>${esc(plain(c.desc))}</p>` : ''}`,
    };
  }
  if (t === 'etkinlik') {
    const e = await bySlug('events', s); if (!e || e.status !== 'approved') return null;
    const url = `${SITE}/etkinlik/${e.slug || e.id}`;
    const desc = short(`${e.title} — ${e.city || ''}${e.date ? ', ' + trDate(e.date) : ''}. ${plain(e.desc)}`, 158);
    return {
      title: `${e.title}${e.date ? ' — ' + trDate(e.date) : ''} | ${BRAND}`, desc, url, image: e.imgUrl || e.img,
      content: `<nav style="font-size:13px"><a href="/">Ana Sayfa</a> › <a href="/etkinlikler">Etkinlikler</a></nav><h1>${esc(e.title)}</h1>${e.date ? `<p><b>Tarih:</b> ${esc(trDate(e.date))}</p>` : ''}${e.city ? `<p><b>Şehir:</b> ${esc(e.city)}</p>` : ''}${e.desc ? `<p>${esc(plain(e.desc))}</p>` : ''}`,
    };
  }
  return null;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const t = String(q.t || ''), s = decodeURIComponent(String(q.s || '')).replace(/\/+$/, '');
  let html = await baseHtml();
  try {
    const m = s ? await meta(t, s) : null;
    if (m) html = apply(html, m);
    else if (t !== 'page') {
      // Bulunamayan detay sayfası: arama motorları dizine eklemesin (soft 404 önlemi)
      html = html.replace(/<meta name="robots"[^>]*>/g, '').replace('</head>', '<meta name="robots" content="noindex, follow"/>\n</head>');
      res.statusCode = 404;
    }
  } catch (e) { /* hata olursa uygulama HTML'i olduğu gibi döner */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  if (!res.statusCode || res.statusCode === 200) res.statusCode = 200;
  res.end(html);
};
