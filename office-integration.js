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
//   DEEPSEEK_API_KEY    — real AI in the office app (via DeepSeek's real Anthropic-compatible endpoint)
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
  const crypto = require('crypto');
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
  const IG_FILE = path.join(OFFICE_DIR, 'office_instagram.json');

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
        CREATE TABLE IF NOT EXISTS instagram_messages (id SERIAL PRIMARY KEY, thread_id TEXT NOT NULL, sender_id TEXT NOT NULL, direction TEXT NOT NULL, text TEXT, raw JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
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
        async getVisitorCount() { const r = await pool.query('SELECT COUNT(*)::int AS c FROM office_visitors'); return r.rows[0].c; },
        async saveInstagramMessage(threadId, senderId, direction, text, raw) {
          await pool.query('INSERT INTO instagram_messages (thread_id, sender_id, direction, text, raw) VALUES ($1,$2,$3,$4,$5)', [threadId, senderId, direction, text || '', JSON.stringify(raw || {})]);
        },
        async getInstagramThreads() {
          const r = await pool.query(`SELECT thread_id, MAX(created_at) AS last_at, COUNT(*)::int AS msg_count FROM instagram_messages GROUP BY thread_id ORDER BY last_at DESC LIMIT 100`);
          return r.rows.map(row => ({ threadId: row.thread_id, lastAt: row.last_at, messageCount: row.msg_count }));
        },
        async getInstagramMessages(threadId) {
          const r = await pool.query('SELECT sender_id, direction, text, created_at FROM instagram_messages WHERE thread_id=$1 ORDER BY created_at ASC', [threadId]);
          return r.rows.map(row => ({ senderId: row.sender_id, direction: row.direction, text: row.text, createdAt: row.created_at }));
        }
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
      async getVisitorCount() { return readJSONFile(VISITORS_FILE, []).length; },
      async saveInstagramMessage(threadId, senderId, direction, text, raw) {
        const all = readJSONFile(IG_FILE, []);
        all.push({ threadId, senderId, direction, text: text || '', raw: raw || {}, createdAt: new Date().toISOString() });
        writeJSONFile(IG_FILE, all.slice(-5000));
      },
      async getInstagramThreads() {
        const all = readJSONFile(IG_FILE, []);
        const byThread = {};
        all.forEach(m => { if (!byThread[m.threadId] || m.createdAt > byThread[m.threadId].lastAt) byThread[m.threadId] = { threadId: m.threadId, lastAt: m.createdAt }; });
        const counts = {};
        all.forEach(m => { counts[m.threadId] = (counts[m.threadId] || 0) + 1; });
        return Object.values(byThread).map(t => ({ ...t, messageCount: counts[t.threadId] })).sort((a, b) => (b.lastAt > a.lastAt ? 1 : -1)).slice(0, 100);
      },
      async getInstagramMessages(threadId) {
        return readJSONFile(IG_FILE, []).filter(m => m.threadId === threadId).sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
      }
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

  // ── Security headers — comprehensive set, applied to every response ─
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0'); // deprecated header, explicitly disabled rather than relying on it
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // CSP: real, not decorative. Allows what the office app actually needs
    // (inline scripts/styles — it's a single-file app — plus fetch to
    // self). Tightens everything else, including blocking any framing.
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'"
    ].join('; '));
    next();
  });

  // ── Threat log — real record of things this server actually blocked
  // (honeypot hits, injection probes, bans), separate from the general
  // visitor log so real attacks are easy to find. ────────────────────
  const THREATS_FILE = path.join(OFFICE_DIR, 'office_threats.json');
  function logThreat(ip, kind, detail) {
    try {
      const all = readJSONFile(THREATS_FILE, []);
      all.push({ ip, kind, detail: (detail || '').slice(0, 300), at: new Date().toISOString() });
      writeJSONFile(THREATS_FILE, all.slice(-2000));
    } catch (e) {}
  }

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

  // ── Honeypot paths — real scanners and bots probe these constantly
  // (WordPress, .env files, phpMyAdmin, .git, etc.) on every server they
  // find. This app has none of them — hitting one is proof of malicious
  // scanning, not a mistake. Instant ban, no warning. ─────────────────
  const HONEYPOT_PATHS = new Set([
    '/wp-admin', '/wp-login.php', '/wp-content', '/wp-includes', '/wp-json',
    '/.env', '/.env.local', '/.env.production', '/.env.backup',
    '/config.php', '/phpmyadmin', '/pma', '/.git/config', '/.git/HEAD',
    '/admin.php', '/xmlrpc.php', '/.aws/credentials', '/server-status',
    '/actuator/env', '/actuator/health', '/.docker', '/docker-compose.yml',
    '/administrator/index.php', '/.ssh/id_rsa', '/id_rsa', '/backup.sql',
    '/database.sql', '/.htaccess', '/vendor/phpunit', '/console',
    '/.vscode/sftp.json', '/laravel/.env', '/api/.env', '/telescope'
  ]);
  app.use((req, res, next) => {
    if (HONEYPOT_PATHS.has(req.path.toLowerCase())) {
      const ip = getClientIp(req);
      store.banIp(ip, `Auto-banned: probed honeypot path ${req.path}`).catch(() => {});
      logThreat(ip, 'honeypot', req.path);
      return res.status(404).send('Not found.'); // 404, not 403 — don't tip off that this is a trap
    }
    next();
  });

  // ── Suspicious-pattern detection — SQL injection and path-traversal
  // probes in the URL or query string. Real attack signatures, not
  // guesses: anyone sending these on a plain marketing/office server has
  // no legitimate reason to. ──────────────────────────────────────────
  const SUSPICIOUS_PATTERNS = [
    /\.\.\//, /union\s+select/i, /select\s+.*\s+from\s+/i, /drop\s+table/i,
    /or\s+1\s*=\s*1/i, /<script[\s>]/i, /etc\/passwd/i, /\bexec\s*\(/i,
    /base64_decode/i, /eval\s*\(/i
  ];
  app.use((req, res, next) => {
    const fullUrl = req.originalUrl || req.url || '';
    let decoded = fullUrl;
    try { decoded = decodeURIComponent(fullUrl.replace(/\+/g, ' ')); } catch (e) {} // handle both %20 and + as space (both are valid query-string space encodings) — malformed encoding falls through to the raw check below rather than crashing
    if (SUSPICIOUS_PATTERNS.some(p => p.test(fullUrl) || p.test(decoded))) {
      const ip = getClientIp(req);
      store.banIp(ip, `Auto-banned: suspicious request pattern`).catch(() => {});
      logThreat(ip, 'injection-probe', decoded);
      return res.status(400).send('Bad request.');
    }
    next();
  });

  // ── General rate limiting — a real person, even clicking around fast,
  // won't fire 300 requests in a minute. A scanner/bot hammering the
  // server will. Once an IP crosses that, it's auto-banned — this is real
  // protection against brute-force and scraping, not just the login form.
  const requestCounts = new Map(); // ip -> { count, windowStart }
  const RATE_LIMIT_MAX = 300;
  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  app.use((req, res, next) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const rec = requestCounts.get(ip);
    if (!rec || now - rec.windowStart > RATE_LIMIT_WINDOW_MS) {
      requestCounts.set(ip, { count: 1, windowStart: now });
    } else {
      rec.count++;
      if (rec.count > RATE_LIMIT_MAX) {
        store.banIp(ip, `Auto-banned: ${rec.count} requests in under a minute (rate limit)`).catch(() => {});
        logThreat(ip, 'rate-limit', `${rec.count} req/min`);
        requestCounts.delete(ip);
        return res.status(429).send('Too many requests.');
      }
    }
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
  function timingSafeStringEqual(a, b) {
    const bufA = Buffer.from(String(a || ''));
    const bufB = Buffer.from(String(b || ''));
    if (bufA.length !== bufB.length) {
      // Still run a comparison of equal length to avoid leaking length via timing.
      crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }
  function requireOfficeApiKey(req, res, next) {
    const key = process.env.OFFICE_API_KEY;
    if (!key) return res.status(503).json({ error: 'OFFICE_API_KEY is not set on the server yet.' });
    if (!timingSafeStringEqual(req.header('X-API-Key'), key)) return res.status(401).json({ error: 'Invalid or missing X-API-Key header.' });
    next();
  }

  // ── The office dashboard — behind your existing admin login ────────
  app.get('/office', requireAuth, (req, res) => {
    const filePath = path.join(__dirname, 'office.html');
    if (!fs.existsSync(filePath)) return res.status(500).send('office.html not found next to index.js.');
    // Never let the browser cache this page — otherwise updates you push
    // can silently keep showing the old version until a hard refresh.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
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

  // ── Real AI proxy — now DeepSeek, via its Anthropic-compatible
  // endpoint. Same Messages API request/response shape as before, so the
  // client (office.html) needed zero changes to its request format —
  // only the base URL, key, and model name changed. ───────────────────
  app.post('/office/api/ai', requireOfficeApiKey, async (req, res) => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'DEEPSEEK_API_KEY is not set on the server yet.' });
    try {
      const dsRes = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(req.body)
      });
      const data = await dsRes.json();
      res.status(dsRes.status).json(data);
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // ── Instagram — Alex's channel. Real Meta webhook (verification +
  // incoming DMs) and a real send-reply endpoint via the Graph API.
  // Needs INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_VERIFY_TOKEN (you choose this
  // one — used only during Meta's webhook setup handshake), and
  // optionally INSTAGRAM_APP_SECRET for verifying incoming webhook
  // signatures (recommended — without it, anyone who finds your webhook
  // URL could send fake "messages").

  // Meta's webhook verification handshake — GET with hub.challenge.
  app.get('/office/api/instagram/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN && process.env.INSTAGRAM_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    res.sendStatus(403);
  });

  // Real incoming messages. Signature verification needs the RAW request
  // body bytes — but your existing global express.json() (in index.js)
  // already parses the body before this route ever sees it, so a
  // route-specific raw() parser here can't recover the original bytes.
  // Fix: run add-rawbody-capture.js once — it adds a tiny `verify` hook
  // to your existing express.json() call that stashes the raw bytes on
  // req.rawBody for every request. Until you run that, this still WORKS
  // (accepts real messages), it just can't verify the signature and says
  // so honestly instead of silently pretending it's secure.
  app.post('/office/api/instagram/webhook', (req, res) => {
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    if (appSecret && req.rawBody) {
      const signature = req.header('X-Hub-Signature-256') || '';
      const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
      if (signature !== expected) {
        console.warn('⚠ Instagram webhook: signature mismatch — rejecting a message that did not really come from Meta.');
        return res.sendStatus(403);
      }
    } else if (appSecret && !req.rawBody) {
      console.warn('⚠ Instagram webhook: INSTAGRAM_APP_SECRET is set but req.rawBody is missing — run add-rawbody-capture.js once to enable real signature verification. Accepting this message WITHOUT verification for now.');
    } else {
      console.warn('⚠ Instagram webhook: INSTAGRAM_APP_SECRET not set — incoming messages are NOT signature-verified. Set it for real security.');
    }
    const body = req.body;
    res.sendStatus(200); // ack immediately, per Meta's requirements — process after

    try {
      if (body && body.object === 'instagram' && Array.isArray(body.entry)) {
        body.entry.forEach(entry => {
          (entry.messaging || []).forEach(evt => {
            if (evt.message && evt.message.text) {
              const threadId = evt.sender.id;
              store.saveInstagramMessage(threadId, evt.sender.id, 'in', evt.message.text, evt).catch(() => {});
            }
          });
        });
      }
    } catch (e) { console.error('Instagram webhook processing error:', e.message); }
  });

  app.get('/office/api/instagram/threads', requireOfficeApiKey, async (req, res) => {
    try { res.json(await store.getInstagramThreads()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/office/api/instagram/messages/:threadId', requireOfficeApiKey, async (req, res) => {
    try { res.json(await store.getInstagramMessages(req.params.threadId)); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Real send — Alex's actual reply goes out through this, using your
  // real INSTAGRAM_ACCESS_TOKEN via the Graph API.
  app.post('/office/api/instagram/reply', requireOfficeApiKey, async (req, res) => {
    const { threadId, text } = req.body || {};
    if (!threadId || !text) return res.status(400).json({ error: 'threadId and text are required' });
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!token) return res.status(503).json({ error: 'INSTAGRAM_ACCESS_TOKEN is not set on the server yet.' });
    try {
      const igRes = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: threadId }, message: { text } })
      });
      const data = await igRes.json();
      if (!igRes.ok) return res.status(igRes.status).json({ error: data.error ? data.error.message : 'Instagram API error', raw: data });
      await store.saveInstagramMessage(threadId, 'page', 'out', text, data);
      res.json({ ok: true, data });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // ── Real ad performance — Meta Marketing API (Ads Insights). Needs
  // META_AD_ACCOUNT_ID (found in Meta Ads Manager → Account Overview,
  // looks like "act_1234567890" or just the number) and an access token
  // with the ads_read permission — usually the same token you already
  // set as INSTAGRAM_ACCESS_TOKEN, if that token's app has ads_read too.
  app.get('/office/api/instagram/ads', requireOfficeApiKey, async (req, res) => {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    let acct = process.env.META_AD_ACCOUNT_ID;
    if (!token) return res.status(503).json({ error: 'INSTAGRAM_ACCESS_TOKEN is not set on the server yet.' });
    if (!acct) return res.status(503).json({ error: 'META_AD_ACCOUNT_ID is not set on the server yet.' });
    if (!acct.startsWith('act_')) acct = 'act_' + acct;
    try {
      const fields = 'spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type,date_start,date_stop,campaign_name';
      const [insightsRes, campaignsRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v21.0/${acct}/insights?level=campaign&date_preset=last_30d&time_increment=1&fields=${fields}&limit=200&access_token=${encodeURIComponent(token)}`),
        fetch(`https://graph.facebook.com/v21.0/${acct}/campaigns?fields=name,status,effective_status,daily_budget&limit=100&access_token=${encodeURIComponent(token)}`)
      ]);
      const insights = await insightsRes.json();
      const campaigns = await campaignsRes.json();
      if (!insightsRes.ok) return res.status(insightsRes.status).json({ error: insights.error ? insights.error.message : 'Meta Ads API error', raw: insights });
      res.json({
        insights: insights.data || [],
        campaigns: (campaigns.data || []).filter(c => c.effective_status === 'ACTIVE')
      });
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
  app.get('/office/api/admin/threats', requireAuth, (req, res) => {
    try { res.json(readJSONFile(THREATS_FILE, []).slice(-300).reverse()); } catch (e) { res.status(500).json({ error: e.message }); }
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
