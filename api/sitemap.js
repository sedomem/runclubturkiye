// RunClubTürkiye — dinamik sitemap (Vercel Serverless Function)
// /sitemap.xml, /sitemap-pages.xml, /sitemap-blog.xml, /sitemap-races.xml,
// /sitemap-clubs.xml, /sitemap-events.xml adresleri vercel.json ile buraya yönlenir.
const SITE = 'https://www.runclubturkiye.com';
const { slugify, cityOf } = require('./_cities');
const FS = 'https://firestore.googleapis.com/v1/projects/runclubturkiye/databases/(default)/documents';

function val(v) {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  return undefined;
}

async function list(collection, fields) {
  const out = [];
  let token = '';
  for (let page = 0; page < 20; page++) {
    const p = new URLSearchParams({ pageSize: '300' });
    fields.forEach(f => p.append('mask.fieldPaths', f));
    if (token) p.set('pageToken', token);
    const r = await fetch(`${FS}/${collection}?${p}`);
    if (!r.ok) break;
    const j = await r.json();
    (j.documents || []).forEach(d => {
      const o = { id: d.name.split('/').pop() };
      Object.entries(d.fields || {}).forEach(([k, v]) => { o[k] = val(v); });
      out.push(o);
    });
    if (!j.nextPageToken) break;
    token = j.nextPageToken;
  }
  return out;
}

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = t => { try { const d = t ? new Date(t) : new Date(); return isNaN(d) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10); } catch (e) { return new Date().toISOString().slice(0, 10); } };
const urlset = items => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.map(i =>
  `  <url><loc>${SITE}${esc(i.loc)}</loc><lastmod>${day(i.lastmod)}</lastmod><changefreq>${i.freq}</changefreq><priority>${i.pri}</priority></url>`).join('\n')}\n</urlset>\n`;

const PAGES = [
  ['/', 'daily', '1.0'], ['/yaris-takvimi', 'daily', '0.9'], ['/kulupler', 'weekly', '0.9'],
  ['/etkinlikler', 'daily', '0.8'], ['/haberler', 'daily', '0.8'], ['/firsatlar', 'weekly', '0.6'],
  ['/topluluk', 'daily', '0.6'], ['/tartismalar', 'daily', '0.6'], ['/hakkimizda', 'monthly', '0.5'],
  ['/iletisim', 'monthly', '0.4'], ['/sss', 'monthly', '0.5'], ['/kvkk', 'yearly', '0.2'],
  ['/gizlilik', 'yearly', '0.2'], ['/kullanim-kosullari', 'yearly', '0.2'],
];

async function build(type) {
  if (type === 'index') {
    const t = day();
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['pages', 'blog', 'races', 'clubs', 'events'].map(s =>
      `  <sitemap><loc>${SITE}/sitemap-${s}.xml</loc><lastmod>${t}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>\n`;
  }
  if (type === 'pages') return urlset(PAGES.map(([loc, freq, pri]) => ({ loc, freq, pri })));
  if (type === 'blog') {
    const posts = await list('blog', ['slug', 'status', 'updatedAt', 'publishedAt', 'createdAt']);
    return urlset(posts.filter(p => !p.status || p.status === 'published').map(p => ({
      loc: '/haber/' + (p.slug || p.id), lastmod: p.updatedAt || p.publishedAt || p.createdAt, freq: 'monthly', pri: '0.7' })));
  }
  if (type === 'races') {
    const races = await list('races', ['slug', 'date', 'updatedAt', 'createdAt']);
    const today = day();
    return urlset(races.map(r => ({
      loc: '/yaris/' + (r.slug || r.id), lastmod: r.updatedAt || r.createdAt,
      freq: (r.date && r.date >= today) ? 'weekly' : 'yearly', pri: (r.date && r.date >= today) ? '0.8' : '0.4' })));
  }
  if (type === 'clubs') {
    const clubs = await list('clubs', ['name', 'city', 'slug', 'updatedAt', 'createdAt']);
    const items = clubs.filter(c => c.name).map(c => ({
      loc: '/kulup/' + c.id, lastmod: c.updatedAt || c.createdAt, freq: 'weekly', pri: '0.6' }));
    // Şehir sayfaları: en az 1 kulüp veya 2 yaklaşan yarış olan iller
    const races = await list('races', ['date', 'location']);
    const today = day(); const cnt = {};
    clubs.filter(c => c.name).forEach(c => { const ct = cityOf(c.city); if (ct) (cnt[ct] = cnt[ct] || { c: 0, r: 0 }).c++; });
    races.filter(r => r.date && r.date >= today).forEach(r => { const ct = cityOf(r.location); if (ct) (cnt[ct] = cnt[ct] || { c: 0, r: 0 }).r++; });
    Object.entries(cnt).filter(([, v]) => v.c >= 1 || v.r >= 2).forEach(([name, v]) => items.push({ loc: '/kulupler/' + slugify(name), freq: 'weekly', pri: v.c ? '0.8' : '0.6' }));
    return urlset(items);
  }
  if (type === 'events') {
    const events = await list('events', ['slug', 'status', 'updatedAt', 'createdAt']);
    return urlset(events.filter(e => e.status === 'approved').map(e => ({
      loc: '/etkinlik/' + (e.slug || e.id), lastmod: e.updatedAt || e.createdAt, freq: 'weekly', pri: '0.6' })));
  }
  return null;
}

module.exports = async (req, res) => {
  const type = String((req.query && req.query.type) || 'index');
  try {
    const xml = await build(type);
    if (!xml) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400');
    res.statusCode = 200;
    res.end(xml);
  } catch (e) {
    res.statusCode = 500;
    res.end('Sitemap error');
  }
};
