// ═══════════════════════════════════════════════════════════════
// OFFICE INTEGRATION v2 — mounts the office dashboard + admin/security
// layer onto your existing Express app. Still completely separate from
// Twilio/OpenAI — nothing here touches your phone-handling routes.
//
// Usage in index.js (unchanged):
//   const mountOffice = require('./office-integration');
//   mountOffice(app, requireAuth);
//
// Env vars needed (separate from phone system's TWILIO_*/OPENAI_API_KEY):
//   ANTHROPIC_API_KEY   — real AI in the office app
//   OFFICE_API_KEY      — secret protecting /office/api/*
//   DATABASE_URL        — REAL PERSISTENCE. Without this, data lives in a
//                         JSON file that Render WIPES on every deploy —
//                         that's exactly the data-loss bug you hit. Add a
//                         Render Postgres database and set this to fix it
//                         for good. See SETUP.md for exact steps.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

module.exports = function mountOffice(app, requireAuth) {
  app.set('trust proxy', true); // so req.ip is the REAL visitor IP behind Render's proxy, not Render's own

  // ── Storage layer — Postgres if DATABASE_URL is set (survives every
  // deploy, this is the real fix for the data-loss bug), else a local
  // JSON file (works, but Render wipes it on every deploy — fine for
  // local testing only). ──────────────────────────────────────────────
  const OFFICE_DIR = process.env.OFFICE_DATA_DIR || path.join(__dirname, 'office-data');
  if (!fs.existsSync(OFFICE_DIR)) { try { fs.mkdirSync(OFFICE_DIR, { recursive: true }); } catch (e) {} }
  const STATE_FILE = path.join(OFFICE_DIR, 'office_state.json');
  const CRASH_FILE = path.join(OFFICE_DIR, 'office_crashes.json');
  const VISITORS_FILE = path.join(OFFICE_DIR, 'office_visitors.json');
  const BANS_FILE = path.join(OFFICE_DIR, 'office_bans.json');

  function readJSONFile(file, fallback) {
    try { if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return fallback; }
  }
  function writeJSONFile(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
    catch (e) { console.error('office: failed to save', file, e.message); }
  }

  let store;
  if (process.env.DATABASE_URL) {
    let Pool;
    try { Pool = require('pg').Pool; } catch (e) {
      console.error('✗ DATABASE_URL is set but the "pg" package is not installed. Run: npm install pg');
      console.error('  Falling back to local JSON storage (NOT persistent across deploys) until you fix this.');
    }
    if (Pool) {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      const ready = pool.query(`
        CREATE TABLE IF NOT EXISTS office_state (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS office_crashes (id SERIAL PRIMARY KEY, fingerprint TEXT NOT NULL, kind TEXT, message TEXT, session_id TEXT NOT NULL, reported_at TIMESTAMPTZ NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS office_visitors (id SERIAL PRIMARY KEY, ip TEXT NOT NULL, country TEXT, path TEXT, user_agent TEXT, visited_at TIMESTAMPTZ NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS office_bans (ip TEXT PRIMARY KEY, reason TEXT, banned_at TIMESTAMPTZ NOT NULL DEFAULT now());
      `).then(() => console.log('✓ Office: Postgres connected — data now survives every deploy.'))
        .catch(err => console.error('✗ Office: Postgres setup failed:', err.message));

      store = {
        kind: 'postgres', ready,
        async getState(key) { const r = await pool.query('SELECT value FROM office_state WHERE key=$1', [key]); return r.rows.length ? r.rows[0].value : null; },
        async getAllState() { const r = await pool.query('SELECT key, value FROM office_state'); const o = {}; r.rows.forEach(row => o[row.key] = row.value); return o; },
        async setState(key, value) { await pool.query(`INSERT INTO office_state (key,value,updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, [key, JSON.stringify(value)]); },
        async recordCrash(fp, kind, message, sessionId) { await pool.query('INSERT INTO office_crashes (fingerprint,kind,message,session_id) VALUES ($1,$2,$3,$4)', [fp, kind || '', (message || '').slice(0, 500), sessionId || 'unknown']); },
        async getCrashSummary() {
          const r = await pool.query(`SELECT fingerprint, (array_agg(message ORDER BY reported_at DESC))[1] message, (array_agg(kind ORDER BY reported_at DESC))[1] kind, COUNT(*)::int total_count, COUNT(DISTINCT session_id)::int session_count, MIN(reported_at) first_seen, MAX(reported_at) last_seen FROM office_crashes GROUP BY fingerprint ORDER BY total_count DESC LIMIT 50`);
          return r.rows.map(row => ({ fingerprint: row.fingerprint, message: row.message, kind: row.kind, totalCount: row.total_count, sessionCount: row.session_count, firstSeen: row.first_seen, lastSeen: row.last_seen }));
        },
        async recordVisitor(ip, country, path_, ua) { await pool.query('INSERT INTO office_visitors (ip,country,path,user_agent) VALUES ($1,$2,$3,$4)', [ip, country || 'Unknown', path_, (ua || '').slice(0, 300)]); },
        async getVisitors(limit) { const r = await pool.query('SELECT ip, country, path, user_agent, visited_at FROM office_visitors ORDER BY visited_at DESC LIMIT $1', [limit || 500]); return r.rows; },
        async isBanned(ip) { const r = await pool.query('SELECT 1 FROM office_bans WHERE ip=$1', [ip]); return r.rows.length > 0; },
        async getBans() { const r = await pool.query('SELECT ip, reason, banned_at FROM office_bans ORDER BY banned_at DESC'); return r.rows; },
        async banIp(ip, reason) { await pool.query('INSERT INTO office_bans (ip,reason) VALUES ($1,$2) ON CONFLICT (ip) DO UPDATE SET reason=$2', [ip, reason || '']); },
        async unbanIp(ip) { await pool.query('DELETE FROM office_bans WHERE ip=$1', [ip]); },
        async getDbSizeBytes() { const r = await pool.query('SELECT pg_database_size(current_database()) AS size'); return parseInt(r.rows[0].size, 10); },
        async getVisitorCount() { const r = await pool.query('SELECT COUNT(*)::int AS c FROM office_visitors'); return r.rows[0].c; }
      };
    }
  }
  if (!store) {
    console.warn('⚠ Office: no DATABASE_URL — using local JSON files. Render WIPES these on every deploy.');
    console.warn('  Add a Postgres database in Render and set DATABASE_URL to fix data loss for good.');
    store = {
      kind: 'json-file', ready: Promise.resolve(),
      async getState(key) { const all = readJSONFile(STATE_FILE, {}); return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null; },
      async getAllState() { return readJSONFile(STATE_FILE, {}); },
      async setState(key, value) { const all = readJSONFile(STATE_FILE, {}); all[key] = value; writeJSONFile(STATE_FILE, all); },
      async recordCrash(fp, kind, message, sessionId) { const all = readJSONFile(CRASH_FILE, []); all.push({ fingerprint: fp, kind: kind || '', message: (message || '').slice(0, 500), sessionId: sessionId || 'unknown', reportedAt: new Date().toISOString() }); writeJSONFile(CRASH_FILE, all.slice(-5000)); },
      async getCrashSummary() {
        const all = readJSONFile(CRASH_FILE, []); const byFp = {};
        all.forEach(r => { if (!byFp[r.fingerprint]) byFp[r.fingerprint] = { fingerprint: r.fingerprint, message: r.message, kind: r.kind, totalCount: 0, sessions: new Set(), firstSeen: r.reportedAt, lastSeen: r.reportedAt }; const g = byFp[r.fingerprint]; g.totalCount++; g.sessions.add(r.sessionId); g.message = r.message; if (r.reportedAt < g.firstSeen) g.firstSeen = r.reportedAt; if (r.reportedAt > g.lastSeen) g.lastSeen = r.reportedAt; });
        return Object.values(byFp).map(g => ({ fingerprint: g.fingerprint, message: g.message, kind: g.kind, totalCount: g.totalCount, sessionCount: g.sessions.size, firstSeen: g.firstSeen, lastSeen: g.lastSeen })).sort((a, b) => b.totalCount - a.totalCount).slice(0, 50);
      },
      async recordVisitor(ip, country, path_, ua) { const all = readJSONFile(VISITORS_FILE, []); all.push({ ip, country: country || 'Unknown', path: path_, user_agent: (ua || '').slice(0, 300), visited_at: new Date().toISOString() }); writeJSONFile(VISITORS_FILE, all.slice(-2000)); },
      async getVisitors(limit) { const all = readJSONFile(VISITORS_FILE, []); return all.slice(-(limit || 500)).reverse(); },
      async isBanned(ip) { const bans = readJSONFile(BANS_FILE, []); return bans.some(b => b.ip === ip); },
      async getBans() { return readJSONFile(BANS_FILE, []); },
      async banIp(ip, reason) { const bans = readJSONFile(BANS_FILE, []); const existing = bans.find(b => b.ip === ip); if (existing) existing.reason = reason; else bans.push({ ip, reason: reason || '', banned_at: new Date().toISOString() }); writeJSONFile(BANS_FILE, bans); },
      async unbanIp(ip) { const bans = readJSONFile(BANS_FILE, []).filter(b => b.ip !== ip); writeJSONFile(BANS_FILE, bans); },
      async getDbSizeBytes() { try { return [STATE_FILE, CRASH_FILE, VISITORS_FILE, BANS_FILE].reduce((sum, f) => sum + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0); } catch (e) { return 0; } },
      async getVisitorCount() { return readJSONFile(VISITORS_FILE, []).length; }
    };
  }

  // ── GeoIP — free lookup (ip-api.com, no key), cached in memory so we
  // don't hammer it. Best-effort: shows "Unknown" if it fails, never
  // blocks the request. ────────────────────────────────────────────
  const geoCache = new Map();
  async function lookupCountry(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) return 'Local';
    if (geoCache.has(ip)) return geoCache.get(ip);
    try {
      const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=country,status`);
      const data = await r.json();
      const country = (data && data.status === 'success' && data.country) ? data.country : 'Unknown';
      geoCache.set(ip, country);
      return country;
    } catch (e) { return 'Unknown'; }
  }
  function getClientIp(req) {
    return (req.ip || (req.connection && req.connection.remoteAddress) || 'unknown').replace('::ffff:', '');
  }

  // ── Security headers — applied to every response ───────────────────
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0'); // deprecated header, explicitly disabled rather than relying on it
    next();
  });

  // ── IP ban check — runs before EVERYTHING else on the whole server,
  // including your phone routes. A banned IP gets a flat 403, no matter
  // what it requests. ─────────────────────────────────────────────────
  app.use(async (req, res, next) => {
    const ip = getClientIp(req);
    try {
      if (await store.isBanned(ip)) return res.status(403).send('Forbidden.');
    } catch (e) {}
    next();
  });

  // ── Visitor logging — every request, whole server. Fire-and-forget,
  // never blocks or slows down the actual response. ──────────────────
  app.use((req, res, next) => {
    const ip = getClientIp(req);
    const uaString = req.headers['user-agent'] || '';
    const reqPath = req.path;
    lookupCountry(ip).then(country => { store.recordVisitor(ip, country, reqPath, uaString).catch(() => {}); }).catch(() => {});
    next();
  });

  // ── Basic-auth brute-force guard — after N failed attempts from the
  // same IP within a window, that IP gets auto-banned. Tracks in memory
  // (resets on restart — fine, it's a throttle, not a permanent record;
  // the real permanent record is the ban list itself, which IS persistent).
  const failedAttempts = new Map(); // ip -> { count, firstAt }
  const MAX_FAILED = 20; // real brute-force bots fire far more than this; a human mistyping a password won't hit it
  const WINDOW_MS = 10 * 60 * 1000;
  app.use((req, res, next) => {
    const original = res.status.bind(res);
    res.status = function (code) {
      if (code === 401) {
        const ip = getClientIp(req);
        const now = Date.now();
        const rec = failedAttempts.get(ip);
        if (!rec || now - rec.firstAt > WINDOW_MS) failedAttempts.set(ip, { count: 1, firstAt: now });
        else {
          rec.count++;
          if (rec.count >= MAX_FAILED) {
            store.banIp(ip, `Auto-banned: ${rec.count} failed login attempts`).catch(() => {});
            failedAttempts.delete(ip);
          }
        }
      }
      return original(code);
    };
    next();
  });

  // ── Auth for the office's own JSON API — header-based key ──────────
  function requireOfficeApiKey(req, res, next) {
    const key = process.env.OFFICE_API_KEY;
    if (!key) return res.status(503).json({ error: 'OFFICE_API_KEY is not set on the server yet.' });
    if (req.header('X-API-Key') !== key) return res.status(401).json({ error: 'Invalid or missing X-API-Key header.' });
    next();
  }

  // ── The office dashboard — behind your existing admin login ────────
  app.get('/office', requireAuth, (req, res) => {
    const filePath = path.join(__dirname, 'office.html');
    if (!fs.existsSync(filePath)) return res.status(500).send('office.html not found next to index.js.');
    res.sendFile(filePath);
  });

  // ── State sync ───────────────────────────────────────────────────
  app.get('/office/api/state', requireOfficeApiKey, async (req, res) => { try { res.json(await store.getAllState()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/office/api/state/:key', requireOfficeApiKey, async (req, res) => { try { res.json({ key: req.params.key, value: await store.getState(req.params.key) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/office/api/state/:key', requireOfficeApiKey, async (req, res) => {
    if (!req.body || !('value' in req.body)) return res.status(400).json({ error: 'Request body must be {"value": ...}' });
    try { await store.setState(req.params.key, req.body.value); res.json({ ok: true, key: req.params.key }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Crash aggregation ────────────────────────────────────────────
  app.post('/office/api/crashes', requireOfficeApiKey, async (req, res) => {
    const { fingerprint, kind, message, sessionId } = req.body || {};
    if (!fingerprint) return res.status(400).json({ error: 'fingerprint is required' });
    try { await store.recordCrash(fingerprint, kind, message, sessionId); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/office/api/crashes/summary', requireOfficeApiKey, async (req, res) => { try { res.json(await store.getCrashSummary()); } catch (e) { res.status(500).json({ error: e.message }); } });

  // ── Real AI proxy ────────────────────────────────────────────────
  app.post('/office/api/ai', requireOfficeApiKey, async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set on the server yet.' });
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(req.body)
      });
      const data = await anthropicRes.json();
      res.status(anthropicRes.status).json(data);
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // ── Phone data — read-only, for the Phone panel inside the office ──
  // Reads your existing call_logs.json / appointments.json / messages.json
  // directly. Adjust PHONE_LOGS_DIR if your logs live somewhere else
  // (matches your existing LOGS_DIR/current pattern from index.js).
  const PHONE_LOGS_DIR = process.env.PHONE_LOGS_DIR || path.join(__dirname, 'logs', 'current');
  function readPhoneFile(name) {
    try { return JSON.parse(fs.readFileSync(path.join(PHONE_LOGS_DIR, name), 'utf8')); } catch (e) { return []; }
  }
  app.get('/office/api/phone-data', requireOfficeApiKey, (req, res) => {
    res.json({
      calls: readPhoneFile('call_logs.json'),
      appointments: readPhoneFile('appointments.json'),
      messages: readPhoneFile('messages.json')
    });
  });

  // ── Admin — visitor log + IP bans, behind your existing admin login ─
  app.get('/office/api/admin/visitors', requireAuth, async (req, res) => {
    try { res.json(await store.getVisitors(500)); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/office/api/admin/bans', requireAuth, async (req, res) => {
    try { res.json(await store.getBans()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // ── Real server health — uptime since last restart, real cloud storage
  // size (not localStorage — the actual database), total real visitors.
  app.get('/office/api/server-info', requireOfficeApiKey, async (req, res) => {
    try {
      const info = {
        uptimeSeconds: Math.round(process.uptime()),
        storageKind: store.kind,
        nodeVersion: process.version
      };
      if (store.kind === 'postgres' && typeof store.getDbSizeBytes === 'function') {
        info.dbSizeBytes = await store.getDbSizeBytes();
      }
      info.visitorCount = typeof store.getVisitorCount === 'function' ? await store.getVisitorCount() : null;
      res.json(info);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/office/api/admin/ban', requireAuth, async (req, res) => {
    const { ip, reason } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip is required' });
    const requesterIp = getClientIp(req);
    if (ip === requesterIp) return res.status(400).json({ error: "You can't ban your own current IP — that would lock you out of this admin panel entirely with no way back in." });
    try { await store.banIp(ip, reason || 'Manually banned by owner'); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/office/api/admin/unban', requireAuth, async (req, res) => {
    const { ip } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip is required' });
    try { await store.unbanIp(ip); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log(`🏢 Office app mounted at /office (storage: ${store.kind}${store.kind === 'json-file' ? ' — NOT persistent, add DATABASE_URL' : ''})`);
};
