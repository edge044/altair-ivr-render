// ═══════════════════════════════════════════════════════════════
// OFFICE INTEGRATION — mounts the Manet Office dashboard onto your
// existing Express app (index.js) as a completely separate feature from
// the phone/IVR system. Nothing here touches Twilio, OpenAI, or any of
// your call-handling routes.
//
// Usage in index.js (2 lines, added near the top after `const app = ...`
// and `requireAuth` are defined):
//
//   const mountOffice = require('./office-integration');
//   mountOffice(app, requireAuth);
//
// New environment variables this needs (add in Render — separate from
// your phone system's TWILIO_*/OPENAI_API_KEY):
//   ANTHROPIC_API_KEY   — powers real AI replies in the office app
//   OFFICE_API_KEY       — a secret you make up; protects the office's
//                          own /office/api/* endpoints (the office.html
//                          page itself is protected by your existing
//                          admin login instead)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

module.exports = function mountOffice(app, requireAuth) {
  // ── Storage — same pattern as your existing appointments/call logs,
  // just in its own folder so it never collides with phone-system data.
  const OFFICE_DIR = process.env.OFFICE_DATA_DIR || path.join(__dirname, 'office-data');
  if (!fs.existsSync(OFFICE_DIR)) fs.mkdirSync(OFFICE_DIR, { recursive: true });
  const STATE_FILE = path.join(OFFICE_DIR, 'office_state.json');
  const CRASH_FILE = path.join(OFFICE_DIR, 'office_crashes.json');

  function readJSON(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { return fallback; }
  }
  function writeJSON(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
    catch (e) { console.error('office: failed to save', file, e.message); }
  }

  // ── Auth for the office's own API — a header-based key (X-API-Key),
  // separate from your admin basic-auth login and from the phone system's
  // credentials entirely.
  function requireOfficeApiKey(req, res, next) {
    const key = process.env.OFFICE_API_KEY;
    if (!key) return res.status(503).json({ error: 'OFFICE_API_KEY is not set on the server yet — add it in Render, then Settings → Cloud Sync in the office app.' });
    if (req.header('X-API-Key') !== key) return res.status(401).json({ error: 'Invalid or missing X-API-Key header.' });
    next();
  }

  // ── The office dashboard itself — gated behind your EXISTING admin
  // login (same requireAuth as /admin), so it's not publicly reachable.
  app.get('/office', requireAuth, (req, res) => {
    const filePath = path.join(__dirname, 'office.html');
    if (!fs.existsSync(filePath)) {
      return res.status(500).send('office.html not found — make sure it was uploaded next to index.js.');
    }
    res.sendFile(filePath);
  });

  // ── Key-value state sync (daily budget, team chat, IT panel, AI spend,
  // tickets — everything the office app persists) ─────────────────────
  app.get('/office/api/state', requireOfficeApiKey, (req, res) => {
    res.json(readJSON(STATE_FILE, {}));
  });
  app.get('/office/api/state/:key', requireOfficeApiKey, (req, res) => {
    const all = readJSON(STATE_FILE, {});
    const value = Object.prototype.hasOwnProperty.call(all, req.params.key) ? all[req.params.key] : null;
    res.json({ key: req.params.key, value });
  });
  app.post('/office/api/state/:key', requireOfficeApiKey, (req, res) => {
    if (!req.body || !('value' in req.body)) return res.status(400).json({ error: 'Request body must be {"value": ...}' });
    const all = readJSON(STATE_FILE, {});
    all[req.params.key] = req.body.value;
    writeJSON(STATE_FILE, all);
    res.json({ ok: true, key: req.params.key });
  });

  // ── Cross-session crash aggregation — "this bug hit N of M sessions" ──
  app.post('/office/api/crashes', requireOfficeApiKey, (req, res) => {
    const { fingerprint, kind, message, sessionId } = req.body || {};
    if (!fingerprint) return res.status(400).json({ error: 'fingerprint is required' });
    const all = readJSON(CRASH_FILE, []);
    all.push({ fingerprint, kind: kind || '', message: (message || '').slice(0, 500), sessionId: sessionId || 'unknown', reportedAt: new Date().toISOString() });
    writeJSON(CRASH_FILE, all.slice(-5000));
    res.json({ ok: true });
  });
  app.get('/office/api/crashes/summary', requireOfficeApiKey, (req, res) => {
    const all = readJSON(CRASH_FILE, []);
    const byFp = {};
    all.forEach(r => {
      if (!byFp[r.fingerprint]) byFp[r.fingerprint] = { fingerprint: r.fingerprint, message: r.message, kind: r.kind, totalCount: 0, sessions: new Set(), firstSeen: r.reportedAt, lastSeen: r.reportedAt };
      const g = byFp[r.fingerprint];
      g.totalCount++;
      g.sessions.add(r.sessionId);
      g.message = r.message;
      if (r.reportedAt < g.firstSeen) g.firstSeen = r.reportedAt;
      if (r.reportedAt > g.lastSeen) g.lastSeen = r.reportedAt;
    });
    const summary = Object.values(byFp)
      .map(g => ({ fingerprint: g.fingerprint, message: g.message, kind: g.kind, totalCount: g.totalCount, sessionCount: g.sessions.size, firstSeen: g.firstSeen, lastSeen: g.lastSeen }))
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, 50);
    res.json(summary);
  });

  // ── Real AI proxy — uses ANTHROPIC_API_KEY, which is completely
  // separate from OPENAI_API_KEY / TWILIO_* used by the phone system.
  // This is what makes the office app's chat / job planning / bug
  // analysis actually work for real once deployed, instead of only
  // showing the honest "AI unreachable" fallback.
  app.post('/office/api/ai', requireOfficeApiKey, async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set on the server yet.' });
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(req.body)
      });
      const data = await anthropicRes.json();
      res.status(anthropicRes.status).json(data);
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  console.log('🏢 Office app mounted at /office (needs ANTHROPIC_API_KEY + OFFICE_API_KEY env vars)');
};
