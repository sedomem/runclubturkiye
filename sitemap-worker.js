/**
 * RunClubTürkiye — Dynamic Sitemap Worker
 * Cloudflare Worker olarak deploy edilir
 * Firebase Firestore REST API ile veri çeker
 * sitemap.xml, sitemap-pages.xml, sitemap-blog.xml vb. üretir
 *
 * Deploy: Cloudflare Dashboard → Workers → Create Worker
 * Route: runclubturkiye.com/sitemap*.xml
 */

const SITE = 'https://www.runclubturkiye.com';
const PROJECT = 'runclubturkiye';
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Cache: 6 saat (CDN) + 1 saat (browser)
const CACHE_HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=21600',
  'X-Robots-Tag': 'noindex',
};

// ── Firestore REST API ile koleksiyon çek ─────────────────
async function fetchCollection(collection, fields, orderBy, limit) {
  const params = new URLSearchParams();
  if (orderBy) params.append('orderBy', orderBy);
  if (limit) params.append('pageSize', String(limit));
  // Sadece gerekli alanlar
  if (fields && fields.length) {
    fields.forEach(f => params.append('mask.fieldPaths', f));
  }
  const url = `${FIRESTORE_URL}/${collection}?${params.toString()}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.documents || []).map(doc => {
      const id = doc.name.split('/').pop();
      const obj = { id };
      if (doc.fields) {
        for (const [key, val] of Object.entries(doc.fields)) {
          if (val.stringValue !== undefined) obj[key] = val.stringValue;
          else if (val.timestampValue) obj[key] = val.timestampValue;
          else if (val.booleanValue !== undefined) obj[key] = val.booleanValue;
          else if (val.integerValue !== undefined) obj[key] = parseInt(val.integerValue);
        }
      }
      return obj;
    });
  } catch (e) {
    console.error(`Fetch error [${collection}]:`, e.message);
    return [];
  }
}

function xmlEscape(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toW3CDate(ts) {
  if (!ts) return new Date().toISOString().split('T')[0];
  try { return new Date(ts).toISOString().split('T')[0]; } catch { return new Date().toISOString().split('T')[0]; }
}

// ── Statik sayfalar sitemap ───────────────────────────────
function sitemapPages() {
  const pages = [
    { loc: '/', freq: 'daily', priority: '1.0' },
    { loc: '/etkinlikler', freq: 'daily', priority: '0.9' },
    { loc: '/kulupler', freq: 'weekly', priority: '0.9' },
    { loc: '/yaris-takvimi', freq: 'weekly', priority: '0.9' },
    { loc: '/haberler', freq: 'weekly', priority: '0.8' },
    { loc: '/firsatlar', freq: 'weekly', priority: '0.7' },
    { loc: '/topluluk', freq: 'daily', priority: '0.7' },
    { loc: '/tartismalar', freq: 'daily', priority: '0.7' },
    { loc: '/hakkimizda', freq: 'monthly', priority: '0.6' },
    { loc: '/iletisim', freq: 'monthly', priority: '0.5' },
    { loc: '/sss', freq: 'monthly', priority: '0.5' },
    { loc: '/kvkk', freq: 'yearly', priority: '0.3' },
    { loc: '/gizlilik', freq: 'yearly', priority: '0.3' },
    { loc: '/kullanim-kosullari', freq: 'yearly', priority: '0.3' },
  ];
  const today = new Date().toISOString().split('T')[0];
  const urls = pages.map(p =>
    `  <url>\n    <loc>${SITE}${p.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.freq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

// ── Blog sitemap ──────────────────────────────────────────
async function sitemapBlog() {
  const posts = await fetchCollection('blog', ['slug', 'title', 'updatedAt', 'createdAt', 'coverUrl'], 'createdAt desc', 200);
  const urls = posts.filter(p => !p.draft).map(p => {
    const slug = p.slug || p.id;
    const lastmod = toW3CDate(p.updatedAt || p.createdAt);
    return `  <url>\n    <loc>${SITE}/haber/${xmlEscape(slug)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls}\n</urlset>`;
}

// ── Events sitemap ────────────────────────────────────────
async function sitemapEvents() {
  const events = await fetchCollection('events', ['slug', 'title', 'updatedAt', 'createdAt', 'status'], 'createdAt desc', 300);
  const urls = events.filter(e => e.status === 'approved').map(e => {
    const slug = e.slug || e.id;
    const lastmod = toW3CDate(e.updatedAt || e.createdAt);
    return `  <url>\n    <loc>${SITE}/etkinlik/${xmlEscape(slug)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

// ── Clubs sitemap ─────────────────────────────────────────
async function sitemapClubs() {
  const clubs = await fetchCollection('clubs', ['slug', 'name', 'updatedAt', 'createdAt'], '', 500);
  const urls = clubs.map(c => {
    const slug = c.slug || c.id;
    const lastmod = toW3CDate(c.updatedAt || c.createdAt);
    return `  <url>\n    <loc>${SITE}/kulup/${xmlEscape(slug)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

// ── Races sitemap ─────────────────────────────────────────
async function sitemapRaces() {
  const races = await fetchCollection('races', ['slug', 'name', 'updatedAt', 'createdAt'], 'createdAt desc', 500);
  const urls = races.map(r => {
    const slug = r.slug || r.id;
    const lastmod = toW3CDate(r.updatedAt || r.createdAt);
    return `  <url>\n    <loc>${SITE}/yaris/${xmlEscape(slug)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

// ── Sitemap Index ─────────────────────────────────────────
function sitemapIndex() {
  const today = new Date().toISOString().split('T')[0];
  const sitemaps = [
    'sitemap-pages.xml',
    'sitemap-blog.xml',
    'sitemap-events.xml',
    'sitemap-clubs.xml',
    'sitemap-races.xml',
  ];
  const entries = sitemaps.map(s =>
    `  <sitemap>\n    <loc>${SITE}/${s}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`;
}

// ── Worker entry point ────────────────────────────────────
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    let xml;
    if (path === '/sitemap.xml') {
      xml = sitemapIndex();
    } else if (path === '/sitemap-pages.xml') {
      xml = sitemapPages();
    } else if (path === '/sitemap-blog.xml') {
      xml = await sitemapBlog();
    } else if (path === '/sitemap-events.xml') {
      xml = await sitemapEvents();
    } else if (path === '/sitemap-clubs.xml') {
      xml = await sitemapClubs();
    } else if (path === '/sitemap-races.xml') {
      xml = await sitemapRaces();
    } else {
      return new Response('Not Found', { status: 404 });
    }

    return new Response(xml, { headers: CACHE_HEADERS });
  }
};
