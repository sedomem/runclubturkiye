// Strava OAuth + aktivite proxy'si.
// Gizli anahtar (STRAVA_CLIENT_SECRET) yalnızca burada, Vercel ortam değişkeninde durur; tarayıcıya hiç gitmez.
// Ortam değişkenleri: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
const ORIGINS = ['https://www.runclubturkiye.com', 'https://runclubturkiye.com'];
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';

function cors(req, res) {
  const o = req.headers.origin || '';
  if (ORIGINS.includes(o)) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return await new Promise((resolve) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (_) { resolve({}); } });
  });
}

async function token(params) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      ...params,
    }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || 'Strava token hatası'), { status: r.status });
  const a = j.athlete || {};
  return {
    access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at,
    scope: j.scope || params.scope || '',
    athlete: a.id ? { id: a.id, firstname: a.firstname || '', lastname: a.lastname || '', profile: a.profile_medium || a.profile || '', city: a.city || '' } : undefined,
  };
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const configured = !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);

  if (req.method === 'GET') {
    // İstemcinin yetkilendirme adresini kurabilmesi için yalnızca açık (public) client_id döner.
    return res.status(200).json({ configured, client_id: configured ? process.env.STRAVA_CLIENT_ID : null });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!configured) return res.status(503).json({ error: 'Strava bağlantısı henüz yapılandırılmadı' });

  const b = await readBody(req);
  try {
    if (b.action === 'exchange') {
      if (!b.code || typeof b.code !== 'string') return res.status(400).json({ error: 'code' });
      const t = await token({ code: b.code, grant_type: 'authorization_code' });
      if (b.scope) t.scope = String(b.scope);
      return res.status(200).json(t);
    }
    if (b.action === 'refresh') {
      if (!b.refresh_token) return res.status(400).json({ error: 'refresh_token' });
      return res.status(200).json(await token({ refresh_token: b.refresh_token, grant_type: 'refresh_token' }));
    }
    if (b.action === 'activities') {
      if (!b.access_token) return res.status(400).json({ error: 'access_token' });
      const q = new URLSearchParams({ per_page: String(Math.min(+b.per_page || 100, 200)), page: String(Math.max(+b.page || 1, 1)) });
      if (b.after) q.set('after', String(parseInt(b.after, 10) || 0));
      const r = await fetch(API + '/athlete/activities?' + q, { headers: { Authorization: 'Bearer ' + b.access_token } });
      const j = await r.json().catch(() => []);
      if (!r.ok) return res.status(r.status).json({ error: (j && j.message) || 'Strava API hatası' });
      // Yalnızca gereken alanlar
      const runs = (Array.isArray(j) ? j : []).filter((a) => /Run/i.test(a.sport_type || a.type || '')).map((a) => ({
        id: String(a.id), name: a.name || 'Koşu', type: a.sport_type || a.type, start: a.start_date_local || a.start_date,
        distance: a.distance || 0, moving_time: a.moving_time || 0, elapsed_time: a.elapsed_time || 0,
        elev: a.total_elevation_gain || 0, workout_type: a.workout_type == null ? null : a.workout_type,
        hr: a.average_heartrate || null, polyline: (a.map && a.map.summary_polyline) || '',
      }));
      return res.status(200).json({ count: Array.isArray(j) ? j.length : 0, runs });
    }
    if (b.action === 'deauthorize') {
      if (b.access_token) await fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { Authorization: 'Bearer ' + b.access_token } }).catch(() => {});
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'action' });
  } catch (e) {
    return res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
};
