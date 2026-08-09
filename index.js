const express = require('express');
const fs = require('fs');
const path = require('path');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const basicAuth = require('basic-auth');
const { hasValidSession, getStore, callRealAI } = require('./office-integration');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// ======================================================
// AUTHENTICATION
// ======================================================

function requireAuth(req, res, next) {
  if (hasValidSession(req)) return next(); // real session cookie from the /login form — no Basic Auth needed
  const AUTH_USERNAME = process.env.ADMIN_USERNAME || 'admin';
  const AUTH_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeThisPassword123!';
  
  const user = basicAuth(req);
  
  if (!user || user.name !== AUTH_USERNAME || user.pass !== AUTH_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Manet Creative"');
    return res.status(401).send(`
      <html>
        <head>
          <title>Manet Creative</title>
          <style>
            body { font-family: Georgia, serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f7f3ed; margin: 0; }
            .auth-box { background: white; padding: 60px; max-width: 420px; width: 100%; }
            h1 { font-size: 1.8rem; font-weight: normal; color: #161616; margin-bottom: 8px; }
            p { color: #77716a; font-size: 0.95rem; margin-bottom: 30px; }
          </style>
        </head>
        <body>
          <div class="auth-box">
            <h1>Manet Creative</h1>
            <p>Please sign in to continue.</p>
          </div>
        </body>
      </html>
    `);
  }
  
  next();
}

const mountOffice = require('./office-integration');
mountOffice(app, requireAuth);

// ======================================================
// LEADS — one card per real contact, auto-aggregating their real
// history across phone/email/Instagram. Two separate spaces: your own
// notes and goals, and Mila's own analysis — never mixed together.
// Plus real reminders.
// ======================================================

function leadsStore() {
  const s = getStore();
  if (!s) throw new Error('Office store not ready yet.');
  return s;
}
const MAX_NOTE_LEN = 2000;
function safeText(raw, maxLen) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen || MAX_NOTE_LEN);
}
// Real cost-abuse guard — a real AI call costs real money every time;
// this stops someone from spamming the analyze button into a real bill.
const _lastAnalyzeAt = {};
function analyzeCooldownOk(key, cooldownMs) {
  const now = Date.now();
  const last = _lastAnalyzeAt[key] || 0;
  if (now - last < (cooldownMs || 30000)) return false;
  _lastAnalyzeAt[key] = now;
  return true;
}

// ======================================================
// BUSINESS PLANS — general business notes, Mila's own business-level
// thinking, and business reminders. Completely separate from any client
// — this is about the business itself, not any one lead.
// ======================================================

app.get('/api/business/notes', requireAuth, async (req, res) => {
  try { const s = leadsStore(); res.json((await s.getState('business_notes')) || []); } catch (e) { res.status(500).json({ error: e.message }); }
});
const NOTE_CATEGORIES = ['General', 'Marketing', 'Finance', 'Ops', 'Hiring', 'Product'];
app.post('/api/business/notes', requireAuth, async (req, res) => {
  const text = safeText(req.body && req.body.text);
  const category = NOTE_CATEGORIES.includes(req.body && req.body.category) ? req.body.category : 'General';
  const priority = ['low', 'normal', 'high'].includes(req.body && req.body.priority) ? req.body.priority : 'normal';
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const s = leadsStore();
    let notes = (await s.getState('business_notes')) || [];
    notes.push({ id: 'BNOTE-' + Date.now(), text, category, priority, pinned: false, at: new Date().toISOString(), editedAt: null });
    await s.setState('business_notes', notes);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/business/notes/:nid/edit', requireAuth, async (req, res) => {
  const text = safeText(req.body && req.body.text);
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const s = leadsStore();
    let notes = (await s.getState('business_notes')) || [];
    const note = notes.find(n => n.id === req.params.nid);
    if (!note) return res.status(404).json({ error: 'Not found.' });
    note.text = text;
    if (NOTE_CATEGORIES.includes(req.body.category)) note.category = req.body.category;
    if (['low','normal','high'].includes(req.body.priority)) note.priority = req.body.priority;
    note.editedAt = new Date().toISOString();
    await s.setState('business_notes', notes);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/business/notes/:nid/pin', requireAuth, async (req, res) => {
  try {
    const s = leadsStore();
    let notes = (await s.getState('business_notes')) || [];
    const note = notes.find(n => n.id === req.params.nid);
    if (!note) return res.status(404).json({ error: 'Not found.' });
    note.pinned = !note.pinned;
    await s.setState('business_notes', notes);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/business/notes/:nid', requireAuth, async (req, res) => {
  try {
    const s = leadsStore();
    let notes = (await s.getState('business_notes')) || [];
    const filtered = notes.filter(n => n.id !== req.params.nid);
    await s.setState('business_notes', filtered);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/business/mila-thoughts', requireAuth, async (req, res) => {
  try { const s = leadsStore(); res.json((await s.getState('business_mila_thoughts')) || []); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/business/mila-analyze', requireAuth, async (req, res) => {
  if (!analyzeCooldownOk('business')) return res.status(429).json({ error: 'Just analyzed recently — wait a bit before asking again (real AI calls cost real money).', retryInMs: 30000 });
  try {
    const s = leadsStore();
    const notes = (await s.getState('business_notes')) || [];
    const leads = (await s.getState('leads')) || [];
    const emailRows = (await s.getState('email_manager_rows')) || [];
    const calls = loadJSON(CALL_LOGS_PATH).filter(c => c.action === 'CALL_RECEIVED');
    const summary = `Real business state: ${leads.length} leads tracked, ${emailRows.length} emails in outreach (${emailRows.filter(r=>r.repliedAt).length} replied), ${calls.length} total calls logged.\nOwner's real business notes:\n${notes.slice(-10).map(n=>'- ['+n.category+'] '+n.text).join('\n') || '(none yet)'}`;
    const sys = `You are Mila, creative director, thinking about the business itself — not any one client. This is your own private space, separate from the owner's notes. Give one genuinely useful, specific thought: a real pattern you notice in the real numbers, or a concrete next move for the business as a whole. Under 80 words. Don't just restate the numbers.`;
    const result = await callRealAI(sys, summary);
    if (!result.ok) return res.status(502).json({ error: result.error });
    let thoughts = (await s.getState('business_mila_thoughts')) || [];
    thoughts.push({ id: 'BMT-' + Date.now(), text: result.text, at: new Date().toISOString(), tokensUsed: result.tokensUsed, cost: result.cost });
    await s.setState('business_mila_thoughts', thoughts);
    res.json({ ok: true, thought: result.text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/business/reminders', requireAuth, async (req, res) => {
  try { const s = leadsStore(); res.json((await s.getState('business_reminders')) || []); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/business/reminders', requireAuth, async (req, res) => {
  const text = safeText(req.body && req.body.text, 500);
  const dueAt = req.body && req.body.dueAt;
  const priority = ['low', 'normal', 'high'].includes(req.body && req.body.priority) ? req.body.priority : 'normal';
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const s = leadsStore();
    let reminders = (await s.getState('business_reminders')) || [];
    reminders.push({ id: 'BREM-' + Date.now(), text, dueAt: dueAt || null, priority, done: false, createdAt: new Date().toISOString() });
    await s.setState('business_reminders', reminders);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/business/reminders/:rid/edit', requireAuth, async (req, res) => {
  const text = safeText(req.body && req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const s = leadsStore();
    let reminders = (await s.getState('business_reminders')) || [];
    const rem = reminders.find(r => r.id === req.params.rid);
    if (!rem) return res.status(404).json({ error: 'Not found.' });
    rem.text = text;
    if (req.body.dueAt !== undefined) rem.dueAt = req.body.dueAt || null;
    await s.setState('business_reminders', reminders);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/business/reminders/:rid/toggle', requireAuth, async (req, res) => {
  try {
    const s = leadsStore();
    let reminders = (await s.getState('business_reminders')) || [];
    const rem = reminders.find(r => r.id === req.params.rid);
    if (!rem) return res.status(404).json({ error: 'Not found.' });
    rem.done = !rem.done;
    await s.setState('business_reminders', reminders);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/business/reminders/:rid', requireAuth, async (req, res) => {
  try {
    const s = leadsStore();
    let reminders = (await s.getState('business_reminders')) || [];
    const filtered = reminders.filter(r => r.id !== req.params.rid);
    await s.setState('business_reminders', filtered);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leads', requireAuth, async (req, res) => {
  const { name, phone, email, instagram } = req.body || {};
  if (!name && !phone && !email && !instagram) return res.status(400).json({ error: 'Give at least a name or one identifier (phone/email/instagram).' });
  try {
    const s = leadsStore();
    let leads = (await s.getState('leads')) || [];
    const lead = {
      id: 'LEAD-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
      createdAt: new Date().toISOString(),
      name: name || '', phone: phone || '', email: email || '', instagram: instagram || '',
      ownerNotes: [], milaThoughts: [], reminders: []
    };
    leads.unshift(lead);
    await s.setState('leads', leads);
    res.json({ ok: true, lead });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const s = leadsStore();
    const leads = (await s.getState('leads')) || [];
    res.json(leads);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Builds the real cross-channel timeline for a lead — pulls from the
// actual call log (by phone), the actual email outreach data (by
// email), and actual Instagram messages (by handle). Nothing here is
// stored twice; it's assembled fresh from the real source each time.
async function buildLeadTimeline(lead) {
  const events = [];
  if (lead.phone) {
    const calls = loadJSON(CALL_LOGS_PATH).filter(c => c.phone === lead.phone);
    calls.forEach(c => events.push({ type: 'call', at: c.timestamp, summary: c.action + (c.details ? ' — ' + JSON.stringify(c.details) : '') }));
    const appts = loadDB().filter(a => a.phone === lead.phone);
    appts.forEach(a => events.push({ type: 'appointment', at: a.createdAt || a.timestamp, summary: (a.serviceType || 'Appointment request') + (a.status ? ' — ' + a.status : '') }));
  }
  if (lead.email) {
    try {
      const s = leadsStore();
      const emailRows = (await s.getState('email_manager_rows')) || [];
      emailRows.filter(r => r.email === lead.email).forEach(r => {
        events.push({ type: 'email_sent', at: r.uploadedAt, summary: r.subject || '(no subject)' });
        if (r.followupSentConfirmedAt) events.push({ type: 'email_followup', at: r.followupSentConfirmedAt, summary: r.followupSubject || 'Follow-up sent' });
        if (r.repliedAt) events.push({ type: 'email_reply', at: r.repliedAt, summary: 'They replied' });
      });
    } catch (e) {}
  }
  if (lead.instagram) {
    try {
      const s = leadsStore();
      const igMessages = await s.getInstagramMessages(lead.instagram);
      igMessages.forEach(m => events.push({ type: 'instagram_' + m.direction, at: m.createdAt, summary: m.text || '' }));
    } catch (e) {}
  }
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

app.get('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    const s = leadsStore();
    const leads = (await s.getState('leads')) || [];
    const lead = leads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Not found.' });
    const timeline = await buildLeadTimeline(lead);
    res.json({ lead, timeline });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leads/:id/notes', requireAuth, async (req, res) => {
  const text = safeText(req.body && req.body.text);
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const s = leadsStore();
    const leads = (await s.getState('leads')) || [];
    const lead = leads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Not found.' });
    lead.ownerNotes.push({ id: 'NOTE-' + Date.now(), text, at: new Date().toISOString() });
    await s.setState('leads', leads);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leads/:id/reminders', requireAuth, async (req, res) => {
  const text = safeText(req.body && req.body.text, 500);
  const dueAt = req.body && req.body.dueAt;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const s = leadsStore();
    const leads = (await s.getState('leads')) || [];
    const lead = leads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Not found.' });
    lead.reminders.push({ id: 'REM-' + Date.now(), text, dueAt: dueAt || null, done: false, createdAt: new Date().toISOString() });
    await s.setState('leads', leads);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leads/:id/reminders/:rid/toggle', requireAuth, async (req, res) => {
  try {
    const s = leadsStore();
    const leads = (await s.getState('leads')) || [];
    const lead = leads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Not found.' });
    const rem = lead.reminders.find(r => r.id === req.params.rid);
    if (!rem) return res.status(404).json({ error: 'Reminder not found.' });
    rem.done = !rem.done;
    await s.setState('leads', leads);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mila's own real analysis — separate from the owner's notes entirely.
// Real AI call grounded in the real cross-channel timeline.
app.post('/api/leads/:id/mila-analyze', requireAuth, async (req, res) => {
  if (!analyzeCooldownOk('lead:' + req.params.id)) return res.status(429).json({ error: 'Just analyzed this lead recently — wait a bit before asking again (real AI calls cost real money).' });
  try {
    const s = leadsStore();
    const leads = (await s.getState('leads')) || [];
    const lead = leads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Not found.' });
    const timeline = await buildLeadTimeline(lead);
    if (!timeline.length) return res.status(400).json({ error: 'No real activity yet for this lead — nothing to analyze.' });
    const timelineText = timeline.map(e => `${e.at}: [${e.type}] ${e.summary}`.slice(0, 200)).join('\n');
    const sys = `You are Mila, creative director, writing your own private analysis of a real lead — this is your own thinking space, separate from the owner's notes. Look at their real activity history and give a genuinely useful, specific read: where they seem to be in their decision, what you'd try next, any risk you notice. Under 90 words. Don't repeat the raw events back — actually interpret them.`;
    const user = `Lead: ${lead.name || lead.email || lead.phone || lead.instagram}\n\nReal activity timeline:\n${timelineText}`;
    const result = await callRealAI(sys, user);
    if (!result.ok) return res.status(502).json({ error: result.error });
    lead.milaThoughts.push({ id: 'MT-' + Date.now(), text: result.text, at: new Date().toISOString(), tokensUsed: result.tokensUsed, cost: result.cost });
    await s.setState('leads', leads);
    res.json({ ok: true, thought: result.text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================================================
// SELF-PING SYSTEM
// ======================================================
if (process.env.NODE_ENV !== 'production' || process.env.FREE_PLAN === 'true') {
  const PING_INTERVAL = 4 * 60 * 1000;
  const selfPing = async () => {
    try {
      await fetch('https://altair-ivr-render-1.onrender.com/health');
    } catch (error) {}
  };
  setInterval(selfPing, PING_INTERVAL);
  setTimeout(selfPing, 5000);
}

// ======================================================
// DATA STORAGE
// ======================================================

const LOGS_DIR = process.env.LOGS_DIR || "./logs";
const CURRENT_LOGS_DIR = `${LOGS_DIR}/current`;
const DAILY_LOGS_DIR = `${LOGS_DIR}/daily`;

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);
if (!fs.existsSync(CURRENT_LOGS_DIR)) fs.mkdirSync(CURRENT_LOGS_DIR);
if (!fs.existsSync(DAILY_LOGS_DIR)) fs.mkdirSync(DAILY_LOGS_DIR);

const DB_PATH = `${CURRENT_LOGS_DIR}/appointments.json`;
const CALL_LOGS_PATH = `${CURRENT_LOGS_DIR}/call_logs.json`;
const MESSAGES_PATH = `${CURRENT_LOGS_DIR}/messages.json`;

function loadJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '[]');
      return [];
    }
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data || '[]');
  } catch (error) {
    return [];
  }
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("ERROR saving:", error);
  }
}

function loadDB() { return loadJSON(DB_PATH); }
function saveDB(data) { saveJSON(DB_PATH, data); }

function saveMessage(msg) {
  const messages = loadJSON(MESSAGES_PATH);
  messages.push({
    id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    ...msg,
    timestamp: new Date().toISOString()
  });
  saveJSON(MESSAGES_PATH, messages.slice(-5000));
}

function getMessages(phone) {
  const messages = loadJSON(MESSAGES_PATH);
  const normalizedSearch = phone.replace(/\D/g, '');
  return messages.filter(m => {
    const normalizedMsg = (m.phone || '').replace(/\D/g, '');
    return normalizedMsg === normalizedSearch;
  });
}

function getAllMessageThreads() {
  const messages = loadJSON(MESSAGES_PATH);
  const threads = {};
  
  messages.forEach(m => {
    const normalized = (m.phone || '').replace(/\D/g, '');
    if (!threads[normalized]) {
      threads[normalized] = {
        phone: m.phone,
        messages: [],
        lastMessage: ''
      };
    }
    threads[normalized].messages.push(m);
    threads[normalized].lastMessage = m.body || '';
  });
  
  return Object.values(threads);
}

function findAppointment(phone) {
  const db = loadDB();
  const normalizedPhone = phone.replace(/\D/g, '');
  return db.find(a => {
    const normalizedApptPhone = (a.phone || '').replace(/\D/g, '');
    return normalizedApptPhone === normalizedPhone;
  });
}

function addAppointment(name, phone, businessType, serviceType, date = "", time = "", status = "pending", reminderMode = "none", reminderAt = "") {
  const db = loadDB();
  const normalizedPhone = phone.replace(/\D/g, '');
  
  const filteredDB = db.filter(a => {
    const normalizedApptPhone = (a.phone || '').replace(/\D/g, '');
    return normalizedApptPhone !== normalizedPhone;
  });
  
  const appointment = { 
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    name, 
    phone,
    businessType,
    serviceType,
    status,
    date, 
    time,
    reminderMode,
    reminderAt,
    reminderSent: false,
    notes: '',
    created: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  filteredDB.push(appointment);
  saveDB(filteredDB);
  
  logCall(phone, 'APPOINTMENT_REQUEST_CREATED', { name, businessType, serviceType, status });
  
  return appointment;
}

function logCall(phone, action, details = {}) {
  try {
    const logs = loadJSON(CALL_LOGS_PATH);
    logs.push({
      phone,
      action,
      details,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    });
    saveJSON(CALL_LOGS_PATH, logs.slice(-5000));
  } catch (error) {
    console.error("ERROR logging call:", error);
  }
}

// ======================================================
// REMINDER SYSTEM
// ======================================================

function shouldSendReminderNow(appointment) {
  if (appointment.status !== "approved") return false;
  if (appointment.reminderSent) return false;
  if (!appointment.reminderMode || appointment.reminderMode === "none") return false;

  const now = new Date();

  if (appointment.reminderMode === "immediate") return true;

  if (appointment.reminderMode === "custom" && appointment.reminderAt) {
    return now >= new Date(appointment.reminderAt);
  }

  if (appointment.reminderMode === "day_before_2pm" && appointment.date) {
    const apptDate = new Date(appointment.date);
    const reminderDate = new Date(apptDate);
    reminderDate.setDate(reminderDate.getDate() - 1);
    reminderDate.setHours(14, 0, 0, 0);
    return now >= reminderDate;
  }

  return false;
}

function sendReminderCall(phone, appointment) {
  console.log(`🔔 SENDING REMINDER to: ${phone}`);
  
  try {
    twilioClient.calls.create({
      twiml: `<Response>
        <Say voice="alice" language="en-US">
          Hello, this is Manet Creative calling to remind you about your confirmed appointment
          scheduled for ${appointment.date} at ${appointment.time}.
          If you need to cancel or reschedule, please call this number again or email mila at meetmanet dot com.
          Thank you.
        </Say>
        <Hangup/>
      </Response>`,
      to: phone,
      from: process.env.TWILIO_PHONE_NUMBER
    });
    
    console.log(`✅ Reminder sent to ${phone}`);
    
  } catch (error) {
    console.error("ERROR sending reminder:", error);
  }
}

function checkAndSendReminders() {
  try {
    let appointments = loadDB();
    let changed = false;

    appointments.forEach(appointment => {
      if (shouldSendReminderNow(appointment)) {
        sendReminderCall(appointment.phone, appointment);
        appointment.reminderSent = true;
        appointment.reminderSentAt = new Date().toISOString();
        changed = true;
      }
    });

    if (changed) saveDB(appointments);
    
  } catch (error) {
    console.error("ERROR checking reminders:", error);
  }
}

setInterval(checkAndSendReminders, 5 * 60 * 1000);

// ======================================================
// ADMIN CSS
// ======================================================

const ADMIN_CSS = `
  :root {
    --bg: #f7f3ed;
    --panel: #ffffff;
    --text: #161616;
    --muted: #77716a;
    --border: #e2dcd3;
    --accent: #1d1d1b;
    --soft: #eee7dd;
    --success: #315c3b;
    --danger: #9b2c2c;
    --warning: #b8860b;
  }
  
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  body {
    font-family: Georgia, 'Times New Roman', serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }
  
  .layout {
    display: flex;
    min-height: 100vh;
  }
  
  .sidebar {
    width: 220px;
    background: var(--panel);
    border-right: 1px solid var(--border);
    padding: 30px 0;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    overflow-y: auto;
  }
  
  .sidebar-logo {
    padding: 0 24px 30px;
    font-size: 1.3rem;
    letter-spacing: -0.3px;
    color: var(--text);
    font-weight: normal;
  }
  
  .sidebar-nav a {
    display: block;
    padding: 12px 24px;
    color: var(--muted);
    text-decoration: none;
    font-size: 0.95rem;
    transition: all 0.15s;
    border-left: 3px solid transparent;
  }
  
  .sidebar-nav a:hover, .sidebar-nav a.active {
    color: var(--text);
    background: var(--soft);
    border-left-color: var(--accent);
  }
  
  .sidebar-nav a .count {
    float: right;
    background: var(--accent);
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.75rem;
  }
  
  .main-content {
    margin-left: 220px;
    flex: 1;
    padding: 40px;
    max-width: 1200px;
  }
  
  .page-title {
    font-size: 2rem;
    font-weight: normal;
    letter-spacing: -0.5px;
    margin-bottom: 8px;
  }
  
  .page-subtitle {
    color: var(--muted);
    font-size: 0.95rem;
    margin-bottom: 30px;
  }
  
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 24px;
    margin-bottom: 20px;
  }
  
  .card-title {
    font-size: 1.1rem;
    margin-bottom: 16px;
    letter-spacing: -0.2px;
  }
  
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 30px;
  }
  
  .stat-item {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 20px;
  }
  
  .stat-number {
    font-size: 2.5rem;
    letter-spacing: -1px;
    margin-bottom: 4px;
  }
  
  .stat-label {
    color: var(--muted);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .btn {
    display: inline-block;
    padding: 10px 20px;
    border: none;
    cursor: pointer;
    font-size: 0.9rem;
    font-family: Georgia, serif;
    text-decoration: none;
    letter-spacing: -0.2px;
    transition: all 0.15s;
  }
  
  .btn-primary { background: var(--accent); color: white; }
  .btn-secondary { background: var(--soft); color: var(--text); }
  .btn-danger { background: var(--danger); color: white; }
  .btn-success { background: var(--success); color: white; }
  .btn-warning { background: var(--warning); color: white; }
  
  .btn:hover { opacity: 0.9; }
  .btn-sm { padding: 6px 14px; font-size: 0.8rem; }
  
  table {
    width: 100%;
    border-collapse: collapse;
  }
  
  th, td {
    padding: 14px 16px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  
  th {
    color: var(--muted);
    font-weight: normal;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.5px;
  }
  
  .badge {
    display: inline-block;
    padding: 4px 10px;
    font-size: 0.75rem;
    letter-spacing: 0.3px;
  }
  
  .badge-pending { background: #fef3c7; color: #92400e; }
  .badge-approved { background: #dcfce7; color: #166534; }
  .badge-rejected { background: #fee2e2; color: #991b1b; }
  .badge-canceled { background: #f3f4f6; color: #6b7280; }
  
  .form-group { margin-bottom: 20px; }
  
  .form-group label {
    display: block;
    font-size: 0.85rem;
    color: var(--muted);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .form-group input, .form-group select, .form-group textarea {
    width: 100%;
    padding: 12px;
    border: 1px solid var(--border);
    font-family: Georgia, serif;
    font-size: 0.95rem;
    background: white;
  }
  
  .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  
  .modal {
    display: none;
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1000;
    align-items: center;
    justify-content: center;
  }
  
  .modal.active { display: flex; }
  
  .modal-content {
    background: var(--panel);
    padding: 30px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
  }
  
  .modal-title {
    font-size: 1.3rem;
    margin-bottom: 20px;
  }
  
  .tabs {
    display: flex;
    gap: 0;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border);
  }
  
  .tab {
    padding: 10px 20px;
    cursor: pointer;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    font-size: 0.9rem;
    text-decoration: none;
  }
  
  .tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  
  .message-thread {
    display: flex;
    height: calc(100vh - 200px);
  }
  
  .message-list {
    width: 300px;
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  
  .message-item {
    padding: 16px;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    display: block;
  }
  
  .message-item:hover { background: var(--soft); }
  .message-item.active { background: var(--soft); }
  
  .message-item .name { font-weight: bold; margin-bottom: 4px; }
  .message-item .preview { color: var(--muted); font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  
  .message-conversation {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px;
  }
  
  .message-bubbles {
    flex: 1;
    overflow-y: auto;
    padding: 20px 0;
  }
  
  .message-bubble {
    max-width: 70%;
    margin-bottom: 16px;
    padding: 12px 16px;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  
  .message-bubble.inbound {
    background: var(--soft);
    margin-right: auto;
  }
  
  .message-bubble.outbound {
    background: var(--accent);
    color: white;
    margin-left: auto;
  }
  
  .message-bubble .time {
    font-size: 0.7rem;
    margin-top: 6px;
    opacity: 0.7;
  }
  
  .message-input {
    display: flex;
    gap: 12px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }
  
  .message-input input {
    flex: 1;
    padding: 12px;
    border: 1px solid var(--border);
    font-family: Georgia, serif;
  }
  
  .template-btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  
  @media (max-width: 768px) {
    .layout { flex-direction: column; }
    .sidebar { width: 100%; position: static; padding: 15px; display: flex; gap: 8px; overflow-x: auto; }
    .sidebar-logo { padding: 0 8px; }
    .sidebar-nav { display: flex; }
    .sidebar-nav a { border-left: none; border-bottom: 2px solid transparent; padding: 8px 12px; white-space: nowrap; }
    .sidebar-nav a.active { border-bottom-color: var(--accent); }
    .main-content { margin-left: 0; padding: 20px; }
    .message-thread { flex-direction: column; height: auto; }
    .message-list { width: 100%; }
  }
`;

// ======================================================
// ADMIN DASHBOARD
// ======================================================

app.get('/admin', requireAuth, (req, res) => {
  const appointments = loadDB();
  const messages = loadJSON(MESSAGES_PATH);
  const calls = loadJSON(CALL_LOGS_PATH);
  
  const pending = appointments.filter(a => a.status === 'pending');
  const approved = appointments.filter(a => a.status === 'approved');
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
  const upcomingApproved = approved.filter(a => a.date && new Date(a.date) >= new Date());
  
  const todayCalls = calls.filter(c => {
    const callDate = new Date(c.timestamp).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
    return callDate === today;
  });
  
  const uniquePhones = new Set(messages.map(m => m.phone));
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Manet Creative</title>
      <style>${ADMIN_CSS}</style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-logo">Manet Creative</div>
          <nav class="sidebar-nav">
            <a href="/admin" class="active">Today</a>
            <a href="/appointments-admin">Appointments <span class="count">${pending.length}</span></a>
            <a href="/messages">Messages <span class="count">${uniquePhones.size}</span></a>
            <a href="/calls">Calls</a>
            <a href="/summary">Summary</a>
            <a href="/archive">Archive</a>
            <a href="/settings">Settings</a>
          </nav>
        </aside>
        
        <main class="main-content">
          <h1 class="page-title">Today</h1>
          <p class="page-subtitle">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          
          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-number">${pending.length}</div>
              <div class="stat-label">Pending Requests</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${uniquePhones.size}</div>
              <div class="stat-label">Message Threads</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${upcomingApproved.length}</div>
              <div class="stat-label">Upcoming Appointments</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${todayCalls.length}</div>
              <div class="stat-label">Calls Today</div>
            </div>
          </div>
          
          ${pending.length > 0 ? `
          <div class="card">
            <div class="card-title">Needs Attention</div>
            <ul style="list-style: none; line-height: 2.2;">
              ${pending.map(p => `
                <li>• ${p.name || 'Unknown'} requested ${p.serviceType || 'appointment'} — <a href="/appointments-admin" style="color: var(--accent);">review</a></li>
              `).join('')}
            </ul>
          </div>
          ` : ''}
          
          ${upcomingApproved.length > 0 ? `
          <div class="card">
            <div class="card-title">Upcoming Appointments</div>
            <table>
              ${upcomingApproved.slice(0, 5).map(a => `
                <tr>
                  <td>${a.name}</td>
                  <td>${a.date}</td>
                  <td>${a.time}</td>
                  <td><span class="badge badge-approved">Approved</span></td>
                </tr>
              `).join('')}
            </table>
          </div>
          ` : ''}
        </main>
      </div>
    </body>
    </html>
  `);
});

// ======================================================
// APPOINTMENTS PAGE
// ======================================================

app.get('/appointments-admin', requireAuth, (req, res) => {
  const appointments = loadDB();
  const filter = req.query.filter || 'active';
  
  let filtered = appointments;
  if (filter === 'pending') filtered = appointments.filter(a => a.status === 'pending');
  else if (filter === 'approved') filtered = appointments.filter(a => a.status === 'approved');
  else if (filter === 'rejected') filtered = appointments.filter(a => a.status === 'rejected');
  else if (filter === 'canceled') filtered = appointments.filter(a => a.status === 'canceled');
  else if (filter === 'active') filtered = appointments.filter(a => a.status === 'pending' || a.status === 'approved');
  
  const pending = appointments.filter(a => a.status === 'pending');
  const approved = appointments.filter(a => a.status === 'approved');
  const rejected = appointments.filter(a => a.status === 'rejected' || a.status === 'canceled');
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Appointments — Manet Creative</title>
      <style>${ADMIN_CSS}</style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-logo">Manet Creative</div>
          <nav class="sidebar-nav">
            <a href="/admin">Today</a>
            <a href="/appointments-admin" class="active">Appointments <span class="count">${pending.length}</span></a>
            <a href="/messages">Messages</a>
            <a href="/calls">Calls</a>
            <a href="/summary">Summary</a>
            <a href="/archive">Archive</a>
            <a href="/settings">Settings</a>
          </nav>
        </aside>
        
        <main class="main-content">
          <h1 class="page-title">Appointments</h1>
          <p class="page-subtitle">Review, approve, and manage client appointment requests.</p>
          
          <div class="tabs">
            <a href="?filter=active" class="tab ${filter === 'active' ? 'active' : ''}">Active (${pending.length + approved.length})</a>
            <a href="?filter=pending" class="tab ${filter === 'pending' ? 'active' : ''}">Pending (${pending.length})</a>
            <a href="?filter=approved" class="tab ${filter === 'approved' ? 'active' : ''}">Approved (${approved.length})</a>
            <a href="?filter=rejected" class="tab ${filter === 'rejected' ? 'active' : ''}">Rejected</a>
            <a href="?filter=canceled" class="tab ${filter === 'canceled' ? 'active' : ''}">Canceled</a>
          </div>
          
          <div style="margin-bottom: 20px;">
            <button class="btn btn-primary" onclick="document.getElementById('createModal').classList.add('active')">Create Appointment</button>
          </div>
          
          ${filtered.length === 0 ? `
            <div class="card">
              <p style="color: var(--muted);">No appointments found.</p>
            </div>
          ` : filtered.map(a => `
            <div class="card">
              <div style="display: flex; justify-content: space-between; align-items: start;">
                <div>
                  <div class="card-title">${a.name || 'Unknown'}</div>
                  <p style="color: var(--muted); font-size: 0.9rem;">${a.phone || ''}</p>
                  <p style="color: var(--muted); font-size: 0.85rem; margin-top: 8px;">
                    Business: ${a.businessType || '—'}<br>
                    Service: ${a.serviceType || '—'}<br>
                    ${a.status === 'approved' ? `Date: ${a.date || '—'} at ${a.time || '—'}<br>Reminder: ${a.reminderMode || 'none'}` : `Requested: ${new Date(a.created).toLocaleString()}`}
                  </p>
                </div>
                <div>
                  <span class="badge badge-${a.status}">${a.status}</span>
                </div>
              </div>
              
              <div style="margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
                ${a.status === 'pending' ? `
                  <button class="btn btn-success btn-sm" onclick="openApproveModal('${a.id}', '${a.name}', '${a.phone}')">Approve</button>
                  <button class="btn btn-danger btn-sm" onclick="rejectAppointment('${a.id}')">Reject</button>
                ` : ''}
                ${a.status === 'approved' ? `
                  <button class="btn btn-secondary btn-sm" onclick="sendReminderNow('${a.id}')">Call Reminder Now</button>
                ` : ''}
                <form method="POST" action="/admin-cancel-appointment" style="display:inline;" onsubmit="return confirm('Cancel this appointment quietly?');">
                  <input type="hidden" name="id" value="${a.id}">
                  <input type="hidden" name="notify" value="false">
                  <button class="btn btn-secondary btn-sm" type="submit">Cancel Quietly</button>
                </form>
                <form method="POST" action="/admin-cancel-appointment" style="display:inline;" onsubmit="return confirm('Cancel and send SMS to client?');">
                  <input type="hidden" name="id" value="${a.id}">
                  <input type="hidden" name="notify" value="true">
                  <button class="btn btn-danger btn-sm" type="submit">Cancel + Text Client</button>
                </form>
              </div>
            </div>
          `).join('')}
        </main>
      </div>
      
      <div class="modal" id="approveModal">
        <div class="modal-content">
          <div class="modal-title">Approve Appointment</div>
          <form method="POST" action="/admin-approve-appointment">
            <input type="hidden" name="id" id="approveId">
            <div class="form-group">
              <label>Date</label>
              <input type="date" name="date" required>
            </div>
            <div class="form-group">
              <label>Time</label>
              <input type="time" name="time" required>
            </div>
            <div class="form-group">
              <label>Reminder</label>
              <select name="reminderMode">
                <option value="none">No reminder</option>
                <option value="immediate">Call immediately</option>
                <option value="day_before_2pm">Call 1 day before at 2 PM</option>
                <option value="custom">Call at custom date/time</option>
              </select>
            </div>
            <div class="form-group" id="customReminderGroup" style="display:none;">
              <label>Custom reminder date/time</label>
              <input type="datetime-local" name="reminderAt">
            </div>
            <div style="display: flex; gap: 12px;">
              <button type="submit" class="btn btn-success">Approve & Text Client</button>
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('approveModal').classList.remove('active')">Cancel</button>
            </div>
          </form>
        </div>
      </div>
      
      <div class="modal" id="createModal">
        <div class="modal-content">
          <div class="modal-title">Create Appointment</div>
          <form method="POST" action="/admin-create-appointment">
            <div class="form-group">
              <label>Client Name</label>
              <input type="text" name="name" required>
            </div>
            <div class="form-group">
              <label>Phone Number</label>
              <input type="tel" name="phone" required>
            </div>
            <div class="form-group">
              <label>Business Type</label>
              <input type="text" name="businessType">
            </div>
            <div class="form-group">
              <label>Service Type</label>
              <input type="text" name="serviceType">
            </div>
            <div class="form-group">
              <label>Date</label>
              <input type="date" name="date" required>
            </div>
            <div class="form-group">
              <label>Time</label>
              <input type="time" name="time" required>
            </div>
            <div class="form-group">
              <label>Status</label>
              <select name="status">
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div class="form-group">
              <label>Reminder</label>
              <select name="reminderMode">
                <option value="none">No reminder</option>
                <option value="immediate">Call immediately</option>
                <option value="day_before_2pm">Call 1 day before at 2 PM</option>
              </select>
            </div>
            <div style="display: flex; gap: 12px;">
              <button type="submit" class="btn btn-success">Create</button>
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('createModal').classList.remove('active')">Cancel</button>
            </div>
          </form>
        </div>
      </div>
      
      <script>
        function openApproveModal(id, name, phone) {
          document.getElementById('approveId').value = id;
          document.getElementById('approveModal').classList.add('active');
        }
        
        document.querySelector('select[name="reminderMode"]').addEventListener('change', function() {
          document.getElementById('customReminderGroup').style.display = this.value === 'custom' ? 'block' : 'none';
        });
        
        function rejectAppointment(id) {
          if (confirm('Reject this appointment request?')) {
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/admin-reject-appointment';
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'id';
            input.value = id;
            form.appendChild(input);
            document.body.appendChild(form);
            form.submit();
          }
        }
        
        function sendReminderNow(id) {
          if (confirm('Send reminder call now?')) {
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/admin-send-reminder-now';
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'id';
            input.value = id;
            form.appendChild(input);
            document.body.appendChild(form);
            form.submit();
          }
        }
      </script>
    </body>
    </html>
  `);
});

// ======================================================
// MESSAGES PAGE
// ======================================================

app.get('/messages', requireAuth, (req, res) => {
  const threads = getAllMessageThreads();
  const selectedPhone = req.query.phone || '';
  const selectedMessages = selectedPhone ? getMessages(selectedPhone) : [];
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Messages — Manet Creative</title>
      <style>${ADMIN_CSS}</style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-logo">Manet Creative</div>
          <nav class="sidebar-nav">
            <a href="/admin">Today</a>
            <a href="/appointments-admin">Appointments</a>
            <a href="/messages" class="active">Messages</a>
            <a href="/calls">Calls</a>
            <a href="/summary">Summary</a>
            <a href="/archive">Archive</a>
            <a href="/settings">Settings</a>
          </nav>
        </aside>
        
        <main class="main-content">
          <h1 class="page-title">Messages</h1>
          <p class="page-subtitle">Text clients directly from this page.</p>
          
          <div class="card">
            <div class="card-title">New Message</div>
            <p style="color: var(--muted); font-size: 0.9rem; margin-bottom: 16px;">
              Send a text to any client by phone number. Use this for appointment-related communication only.
            </p>

            <form method="POST" action="/send-sms" style="display: grid; gap: 12px;">
              <div class="form-group">
                <label>Phone Number</label>
                <input type="tel" name="phone" placeholder="+15035551234" required>
              </div>

              <div class="form-group">
                <label>Message</label>
                <textarea name="message" rows="4" placeholder="Write your message..." required></textarea>
              </div>

              <label style="display:flex; gap:8px; align-items:flex-start; color: var(--muted); font-size: 0.85rem; line-height: 1.4;">
                <input type="checkbox" name="includeOptOut" value="true" checked style="width:auto; margin-top:3px;">
                Add "Reply STOP to opt out." to this message.
              </label>

              <button type="submit" class="btn btn-primary" style="width: fit-content;">Send Message</button>
            </form>
          </div>
          
          <div class="message-thread">
            <div class="message-list">
              ${threads.map(t => `
                <a href="?phone=${encodeURIComponent(t.phone)}" style="text-decoration:none; color:inherit;">
                  <div class="message-item ${selectedPhone.replace(/\\D/g,'') === t.phone.replace(/\\D/g,'') ? 'active' : ''}">
                    <div class="name">${t.phone}</div>
                    <div class="preview">${(t.lastMessage || '').substring(0, 40)}</div>
                  </div>
                </a>
              `).join('')}
              ${threads.length === 0 ? '<p style="padding: 20px; color: var(--muted);">No messages yet.</p>' : ''}
            </div>
            
            <div class="message-conversation">
              ${selectedPhone ? `
                <div class="message-bubbles">
                  ${selectedMessages.map(m => `
                    <div class="message-bubble ${m.direction}">
                      ${m.body}
                      <div class="time">${new Date(m.timestamp).toLocaleString()}</div>
                    </div>
                  `).join('')}
                </div>
                
                <div class="template-btns">
                  <button class="btn btn-sm btn-secondary" onclick="setTemplate('approved')">Approved</button>
                  <button class="btn btn-sm btn-secondary" onclick="setTemplate('rejected')">Rejected</button>
                  <button class="btn btn-sm btn-secondary" onclick="setTemplate('canceled')">Canceled</button>
                  <button class="btn btn-sm btn-secondary" onclick="setTemplate('details')">Need Details</button>
                  <button class="btn btn-sm btn-secondary" onclick="setTemplate('privacy')">Privacy</button>
                </div>
                
                <form method="POST" action="/send-sms" class="message-input">
                  <input type="hidden" name="phone" value="${selectedPhone}">
                  <input type="text" name="message" id="messageInput" placeholder="Write message..." required>
                  <input type="hidden" name="includeOptOut" value="false">
                  <button type="submit" class="btn btn-primary">Send</button>
                </form>
              ` : '<p style="padding: 40px; color: var(--muted); text-align: center;">Select a conversation to start messaging.</p>'}
            </div>
          </div>
        </main>
      </div>
      
      <script>
        function setTemplate(type) {
          const templates = {
            approved: 'Your appointment with Manet Creative has been approved. Date and time have been confirmed. You may receive a reminder call. For our privacy policy, visit https://manet.agency.',
            rejected: 'Thank you for your interest in Manet Creative. At this time, we are unable to confirm your appointment request because the project may not meet our current minimum budget requirement.',
            canceled: 'Your appointment request with Manet Creative has been canceled. For emergencies or general inquiries, please email mila@meetmanet.com.',
            details: 'Hi, this is Manet Creative. Please send us a few more details about your project so our team can review your appointment request.',
            privacy: 'For our privacy policy, please visit https://manet.agency.'
          };
          document.getElementById('messageInput').value = templates[type] || '';
        }
      </script>
    </body>
    </html>
  `);
});

// ======================================================
// CALLS PAGE
// ======================================================

app.get('/calls', requireAuth, (req, res) => {
  const calls = loadJSON(CALL_LOGS_PATH).reverse();
  const appointments = loadDB();
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Calls — Manet Creative</title>
      <style>${ADMIN_CSS}</style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-logo">Manet Creative</div>
          <nav class="sidebar-nav">
            <a href="/admin">Today</a>
            <a href="/appointments-admin">Appointments</a>
            <a href="/messages">Messages</a>
            <a href="/calls" class="active">Calls</a>
            <a href="/summary">Summary</a>
            <a href="/archive">Archive</a>
            <a href="/settings">Settings</a>
          </nav>
        </aside>
        
        <main class="main-content">
          <h1 class="page-title">Calls</h1>
          <p class="page-subtitle">Recent call activity.</p>
          
          ${calls.slice(0, 50).map(c => {
            const appt = appointments.find(a => (a.phone || '').replace(/\\D/g,'') === (c.phone || '').replace(/\\D/g,''));
            return `
              <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                  <div>
                    <strong>${c.phone || 'Unknown'}</strong>
                    <p style="color: var(--muted); font-size: 0.85rem; margin-top: 4px;">
                      ${new Date(c.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <span class="badge badge-approved">${c.action || 'Call'}</span>
                </div>
                ${appt ? `<p style="font-size: 0.85rem; margin-top: 8px; color: var(--muted);">Linked: ${appt.name} — ${appt.serviceType || ''} (${appt.status})</p>` : ''}
                ${c.details && c.details.name ? `<p style="font-size: 0.85rem; margin-top: 4px; color: var(--muted);">Name: ${c.details.name}, Service: ${c.details.serviceType || '—'}</p>` : ''}
              </div>
            `;
          }).join('')}
        </main>
      </div>
    </body>
    </html>
  `);
});

// ======================================================
// SUMMARY PAGE
// ======================================================

app.get('/summary', requireAuth, (req, res) => {
  const appointments = loadDB();
  const calls = loadJSON(CALL_LOGS_PATH);
  const messages = loadJSON(MESSAGES_PATH);
  
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  
  const thisMonthAppointments = appointments.filter(a => {
    const d = new Date(a.created);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  });
  
  const thisMonthCalls = calls.filter(c => {
    const d = new Date(c.timestamp);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  });
  
  const thisMonthMessages = messages.filter(m => {
    const d = new Date(m.timestamp);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  });
  
  const pending = thisMonthAppointments.filter(a => a.status === 'pending');
  const approved = thisMonthAppointments.filter(a => a.status === 'approved');
  const rejected = thisMonthAppointments.filter(a => a.status === 'rejected');
  const canceled = thisMonthAppointments.filter(a => a.status === 'canceled');
  
  const reasons = {};
  thisMonthAppointments.forEach(a => {
    const reason = a.serviceType || 'General inquiry';
    reasons[reason] = (reasons[reason] || 0) + 1;
  });
  
  const topReasons = Object.entries(reasons).sort((a,b) => b[1] - a[1]).slice(0, 5);
  
  const monthName = new Date().toLocaleDateString('en-US', { month: 'long' });
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Summary — Manet Creative</title>
      <style>${ADMIN_CSS}</style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-logo">Manet Creative</div>
          <nav class="sidebar-nav">
            <a href="/admin">Today</a>
            <a href="/appointments-admin">Appointments</a>
            <a href="/messages">Messages</a>
            <a href="/calls">Calls</a>
            <a href="/summary" class="active">Summary</a>
            <a href="/archive">Archive</a>
            <a href="/settings">Settings</a>
          </nav>
        </aside>
        
        <main class="main-content">
          <h1 class="page-title">${monthName} Summary</h1>
          <p class="page-subtitle">Overview of this month's activity.</p>
          
          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-number">${thisMonthCalls.length}</div>
              <div class="stat-label">Total Calls</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${thisMonthAppointments.length}</div>
              <div class="stat-label">Appointment Requests</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${approved.length}</div>
              <div class="stat-label">Approved</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${rejected.length}</div>
              <div class="stat-label">Rejected</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${canceled.length}</div>
              <div class="stat-label">Canceled</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${pending.length}</div>
              <div class="stat-label">Pending</div>
            </div>
          </div>
          
          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-number">${thisMonthMessages.filter(m => m.direction === 'outbound').length}</div>
              <div class="stat-label">SMS Sent</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${thisMonthMessages.filter(m => m.direction === 'inbound').length}</div>
              <div class="stat-label">SMS Received</div>
            </div>
          </div>
          
          <div class="card">
            <div class="card-title">Top Reasons People Contacted Us</div>
            <ol style="line-height: 2.2; padding-left: 20px;">
              ${topReasons.map(([reason, count]) => `<li>${reason} — ${count} request${count > 1 ? 's' : ''}</li>`).join('')}
              ${topReasons.length === 0 ? '<li style="color: var(--muted);">No data this month.</li>' : ''}
            </ol>
          </div>
          
          ${pending.length > 0 ? `
          <div class="card">
            <div class="card-title">People Who Need Follow-up</div>
            <ul style="list-style: none; line-height: 2.2;">
              ${pending.map(p => `<li>• ${p.name || 'Unknown'} — ${p.serviceType || 'Pending request'} — ${p.phone || ''}</li>`).join('')}
            </ul>
          </div>
          ` : ''}
        </main>
      </div>
    </body>
    </html>
  `);
});

// ======================================================
// DASHBOARD STATS — real numbers for the /choose landing page
// ======================================================

app.get('/api/server-health', requireAuth, async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const calls = loadJSON(CALL_LOGS_PATH);
    const callsReceived = calls.filter(c => c.action === 'CALL_RECEIVED');
    const bounced = calls.filter(c => c.action === 'CALL_BOUNCED').length;
    const engaged = calls.filter(c => c.action === 'ENGAGED_APPOINTMENT_FLOW').length;
    const noInput = calls.filter(c => c.action === 'NO_INPUT_TIMEOUT').length;
    const now = Date.now();
    const last24h = callsReceived.filter(c => now - new Date(c.timestamp).getTime() < 24 * 60 * 60 * 1000).length;
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      days.push({ label: dayStr.slice(5), value: callsReceived.filter(c => (c.timestamp || '').slice(0, 10) === dayStr).length });
    }

    let office = { activeProjects: 0, totalTokensUsed: 0 }, email = { total: 0, pending: 0 }, instagram = { activity: 0 };
    try {
      const s = getStore();
      const projects = (await s.getState('projects')) || [];
      office = {
        activeProjects: projects.filter(p => p.status !== 'closed').length,
        stalledProjects: projects.filter(p => (p.aiFailStreak || 0) >= 2).length,
        totalTokensUsed: projects.reduce((sum, p) => sum + (p.tokensUsed || 0), 0)
      };
      const emailRows = (await s.getState('email_manager_rows')) || [];
      email = {
        total: emailRows.length,
        awaitingFollowup: emailRows.filter(r => r.sentConfirmed && !r.followupText).length,
        overdueFollowup: emailRows.filter(r => r.sentConfirmed && !r.followupText && r.followupDueAt && new Date(r.followupDueAt) < new Date()).length
      };
      const igActivity = (await s.getState('instagram_activity')) || [];
      const heldTickets = igActivity.filter(a => a.verdict === 'held').length;
      instagram = { totalActivity: igActivity.length, held: heldTickets };
    } catch (e) {}

    res.json({
      server: { uptimeSeconds: Math.round(process.uptime()), memoryUsedMB: Math.round(mem.heapUsed / 1024 / 1024), memoryTotalMB: Math.round(mem.heapTotal / 1024 / 1024), nodeVersion: process.version },
      phone: { totalCalls: callsReceived.length, last24h, bounced, engaged, noInput, bounceRatePct: callsReceived.length ? Math.round((bounced / callsReceived.length) * 100) : 0, dailyLoad: days },
      office, email, instagram
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dashboard/phone-stats', requireAuth, (req, res) => {
  try {
    const calls = loadJSON(CALL_LOGS_PATH).filter(c => c.action === 'CALL_RECEIVED');
    const appointments = loadDB();
    const now = Date.now();
    const countSince = (days) => calls.filter(c => now - new Date(c.timestamp).getTime() <= days * 24 * 60 * 60 * 1000).length;
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const count = calls.filter(c => (c.timestamp || '').slice(0, 10) === dayStr).length;
      days.push({ label: dayStr.slice(5), value: count });
    }
    res.json({
      last1Day: countSince(1), last7Days: countSince(7), last30Days: countSince(30),
      totalAllTime: calls.length, totalAppointments: appointments.length, dailySeries: days
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================================================
// ARCHIVE PAGE
// ======================================================

app.get('/archive', requireAuth, (req, res) => {
  const appointments = loadDB();
  const calls = loadJSON(CALL_LOGS_PATH);
  const search = req.query.search || '';
  const month = req.query.month || '';
  
  let filteredAppointments = appointments;
  let filteredCalls = calls;
  
  if (search) {
    const lower = search.toLowerCase();
    filteredAppointments = appointments.filter(a => 
      (a.name || '').toLowerCase().includes(lower) || 
      (a.phone || '').includes(search) ||
      (a.serviceType || '').toLowerCase().includes(lower)
    );
    filteredCalls = calls.filter(c => 
      (c.phone || '').includes(search) ||
      (c.action || '').toLowerCase().includes(lower)
    );
  }
  
  if (month) {
    const [y, m] = month.split('-').map(Number);
    filteredAppointments = filteredAppointments.filter(a => {
      const d = new Date(a.created);
      return d.getFullYear() === y && d.getMonth() === (m - 1);
    });
    filteredCalls = filteredCalls.filter(c => {
      const d = new Date(c.timestamp);
      return d.getFullYear() === y && d.getMonth() === (m - 1);
    });
  }
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Archive — Manet Creative</title>
      <style>${ADMIN_CSS}</style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-logo">Manet Creative</div>
          <nav class="sidebar-nav">
            <a href="/admin">Today</a>
            <a href="/appointments-admin">Appointments</a>
            <a href="/messages">Messages</a>
            <a href="/calls">Calls</a>
            <a href="/summary">Summary</a>
            <a href="/archive" class="active">Archive</a>
            <a href="/settings">Settings</a>
          </nav>
        </aside>
        
        <main class="main-content">
          <h1 class="page-title">Archive</h1>
          <p class="page-subtitle">Search all records. Nothing is deleted — just organized.</p>
          
          <div class="card" style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
            <form method="GET" action="/archive" style="display: flex; gap: 12px; flex-wrap: wrap;">
              <input type="text" name="search" placeholder="Search name or phone..." value="${search}" style="padding: 10px; border: 1px solid var(--border); font-family: Georgia, serif; min-width: 200px;">
              <input type="month" name="month" value="${month}" style="padding: 10px; border: 1px solid var(--border); font-family: Georgia, serif;">
              <button type="submit" class="btn btn-primary">Search</button>
              ${search || month ? '<a href="/archive" class="btn btn-secondary">Clear</a>' : ''}
            </form>
          </div>
          
          <div class="card">
            <div class="card-title">Appointments (${filteredAppointments.length})</div>
            <table>
              <tr><th>Name</th><th>Phone</th><th>Service</th><th>Status</th><th>Date</th></tr>
              ${filteredAppointments.slice(-100).reverse().map(a => `
                <tr>
                  <td>${a.name || '—'}</td>
                  <td>${a.phone || '—'}</td>
                  <td>${a.serviceType || '—'}</td>
                  <td><span class="badge badge-${a.status}">${a.status}</span></td>
                  <td>${a.date || '—'}</td>
                </tr>
              `).join('')}
            </table>
          </div>
          
          <div class="card">
            <div class="card-title">Calls (${filteredCalls.length})</div>
            <table>
              <tr><th>Phone</th><th>Action</th><th>Time</th></tr>
              ${filteredCalls.slice(-100).reverse().map(c => `
                <tr>
                  <td>${c.phone || '—'}</td>
                  <td>${c.action || '—'}</td>
                  <td>${new Date(c.timestamp).toLocaleString()}</td>
                </tr>
              `).join('')}
            </table>
          </div>
        </main>
      </div>
    </body>
    </html>
  `);
});

// ======================================================
// SETTINGS PAGE
// ======================================================

app.get('/settings', requireAuth, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Settings — Manet Creative</title>
      <style>${ADMIN_CSS}</style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-logo">Manet Creative</div>
          <nav class="sidebar-nav">
            <a href="/admin">Today</a>
            <a href="/appointments-admin">Appointments</a>
            <a href="/messages">Messages</a>
            <a href="/calls">Calls</a>
            <a href="/summary">Summary</a>
            <a href="/archive">Archive</a>
            <a href="/settings" class="active">Settings</a>
          </nav>
        </aside>
        
        <main class="main-content">
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Business information and preferences.</p>
          
          <div class="card">
            <div class="card-title">Business Information</div>
            <table style="line-height: 2.5;">
              <tr><td style="color: var(--muted); width: 150px;">Name</td><td>Manet Creative</td></tr>
              <tr><td style="color: var(--muted);">Email</td><td>mila@meetmanet.com</td></tr>
              <tr><td style="color: var(--muted);">Website</td><td><a href="https://manet.agency" style="color: var(--accent);">manet.agency</a></td></tr>
              <tr><td style="color: var(--muted);">Privacy Policy</td><td><a href="https://manet.agency" style="color: var(--accent);">https://manet.agency</a></td></tr>
              <tr><td style="color: var(--muted);">Phone</td><td>${process.env.TWILIO_PHONE_NUMBER || '—'}</td></tr>
              <tr><td style="color: var(--muted);">Hours</td><td>Monday–Friday, 10 AM–5 PM PT</td></tr>
            </table>
          </div>
          
          <div class="card">
            <div class="card-title">Privacy & Records</div>
            <p style="color: var(--muted); font-size: 0.9rem; line-height: 1.6;">
              Call recordings and appointment records are stored for appointment management, 
              client communication, and internal review. For our full privacy policy, visit 
              <a href="https://manet.agency" style="color: var(--accent);">manet.agency</a>.
            </p>
          </div>
        </main>
      </div>
    </body>
    </html>
  `);
});

// ======================================================
// ADMIN ACTIONS
// ======================================================

app.post('/admin-approve-appointment', requireAuth, (req, res) => {
  const { id, date, time, reminderMode, reminderAt } = req.body;
  let db = loadDB();
  const index = db.findIndex(a => a.id === id);
  
  if (index === -1) return res.redirect('/appointments-admin');
  
  db[index].status = 'approved';
  db[index].date = date;
  db[index].time = time;
  db[index].reminderMode = reminderMode || 'none';
  db[index].reminderAt = reminderAt || '';
  db[index].updatedAt = new Date().toISOString();
  
  saveDB(db);
  
  try {
    twilioClient.messages.create({
      body: `Your appointment with Manet Creative has been approved.\n\nDate: ${date}\nTime: ${time}\n\nYou may receive a reminder call based on your appointment settings.\n\nFor our privacy policy, visit https://manet.agency.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: db[index].phone
    });
    saveMessage({ phone: db[index].phone, direction: 'outbound', body: `Appointment approved for ${date} at ${time}.` });
  } catch (err) {}
  
  if (reminderMode === 'immediate') {
    sendReminderCall(db[index].phone, db[index]);
    db[index].reminderSent = true;
    saveDB(db);
  }
  
  res.redirect('/appointments-admin');
});

app.post('/admin-reject-appointment', requireAuth, (req, res) => {
  const { id } = req.body;
  let db = loadDB();
  const index = db.findIndex(a => a.id === id);
  
  if (index === -1) return res.redirect('/appointments-admin');
  
  db[index].status = 'rejected';
  db[index].updatedAt = new Date().toISOString();
  saveDB(db);
  
  try {
    twilioClient.messages.create({
      body: `Thank you for your interest in Manet Creative. At this time, we are unable to confirm your appointment request because the project may not meet our current minimum budget requirement.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: db[index].phone
    });
    saveMessage({ phone: db[index].phone, direction: 'outbound', body: 'Appointment request could not be confirmed.' });
  } catch (err) {}
  
  res.redirect('/appointments-admin');
});

app.post('/admin-cancel-appointment', requireAuth, (req, res) => {
  const { id, notify } = req.body;
  let db = loadDB();
  const index = db.findIndex(a => a.id === id);
  
  if (index === -1) return res.redirect('/appointments-admin');
  
  const appointment = db[index];
  db.splice(index, 1);
  saveDB(db);
  
  if (notify === 'true') {
    try {
      twilioClient.messages.create({
        body: `Your appointment request with Manet Creative has been canceled.\n\nFor emergencies or general inquiries, please email mila@meetmanet.com.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: appointment.phone
      });
      saveMessage({ phone: appointment.phone, direction: 'outbound', body: 'Appointment request has been canceled.' });
    } catch (err) {}
  }
  
  res.redirect('/appointments-admin');
});

app.post('/admin-create-appointment', requireAuth, (req, res) => {
  const { name, phone, businessType, serviceType, date, time, status, reminderMode } = req.body;
  
  addAppointment(name, phone, businessType || '', serviceType || '', date, time, status || 'approved', reminderMode || 'none');
  
  if (status === 'approved') {
    try {
      twilioClient.messages.create({
        body: `Your appointment with Manet Creative has been scheduled.\n\nDate: ${date}\nTime: ${time}\n\nFor our privacy policy, visit https://manet.agency.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone
      });
      saveMessage({ phone, direction: 'outbound', body: `Appointment scheduled for ${date} at ${time}.` });
    } catch (err) {}
  }
  
  res.redirect('/appointments-admin');
});

app.post('/admin-send-reminder-now', requireAuth, (req, res) => {
  const { id } = req.body;
  let db = loadDB();
  const index = db.findIndex(a => a.id === id);
  
  if (index !== -1) {
    sendReminderCall(db[index].phone, db[index]);
    db[index].reminderSent = true;
    db[index].reminderSentAt = new Date().toISOString();
    saveDB(db);
  }
  
  res.redirect('/appointments-admin');
});

// ======================================================
// SMS ENDPOINTS
// ======================================================

app.post('/send-sms', requireAuth, async (req, res) => {
  const { phone, message, includeOptOut } = req.body;
  
  if (!phone || !message) {
    return res.redirect('/messages');
  }

  const cleanedPhone = phone.trim();
  let cleanedMessage = message.trim();

  if (includeOptOut === 'true' && !cleanedMessage.toLowerCase().includes('stop')) {
    cleanedMessage += '\n\nReply STOP to opt out.';
  }

  try {
    await twilioClient.messages.create({
      body: cleanedMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: cleanedPhone
    });

    saveMessage({
      phone: cleanedPhone,
      direction: 'outbound',
      body: cleanedMessage
    });

    console.log(`📱 SMS sent to ${cleanedPhone}`);
    
  } catch (err) {
    console.error("ERROR sending SMS:", err);
  }
  
  res.redirect(`/messages?phone=${encodeURIComponent(cleanedPhone)}`);
});

app.post('/sms', (req, res) => {
  const phone = req.body.From || '';
  const message = req.body.Body || '';
  
  console.log(`📱 SMS received from ${phone}: ${message}`);
  
  if (phone && message) {
    saveMessage({
      phone,
      direction: 'inbound',
      body: message
    });
  }
  
  res.type('text/xml');
  res.send('<Response></Response>');
});

// ======================================================
// PHONE SYSTEM
// ======================================================

app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  logCall(phone, 'CALL_RECEIVED');
  
  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST',
    timeout: 10
  });

  gather.say(
    "Thank you for calling Manet Creative. " +
    "This call may be recorded and stored for appointment records and quality purposes. " +
    "For emergencies or general inquiries, please email us at mila at meetmanet dot com. " +
    "This phone number is provided for your convenience to get information about your appointments, and to schedule, reschedule, or cancel appointments only. " +
    "Please press 1 for appointment assistance.",
    { voice: 'alice', language: 'en-US' }
  );

  twiml.say("No selection was made. This phone number is for appointments only. Goodbye.", { voice: 'alice', language: 'en-US' });
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/handle-key', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.body.From;

  if (digit === '1') {
    const appt = findAppointment(phone);

    if (appt) {
      const gather = twiml.gather({
        numDigits: 1,
        action: `/appointment-manage?phone=${encodeURIComponent(phone)}`,
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I see you have an appointment request on file. ` +
        "Press 1 to cancel this request. Press 2 to submit a new request.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();

    } else {
      twiml.say(
        "I don't see you in our appointment database. Let me ask you a few questions to submit an appointment request. " +
        "For our privacy policy, please visit our website at manet dot agency.",
        { voice: 'alice', language: 'en-US' }
      );
      twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    }
  } else {
    twiml.say(
      "This phone number is only for appointment information, scheduling, rescheduling, or canceling appointments. For emergencies or general inquiries, please email mila at meetmanet dot com. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/appointment-manage', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.query.phone;

  if (digit === '1') {
    let db = loadDB();
    const normalizedPhone = phone.replace(/\D/g, '');
    db = db.filter(a => (a.phone || '').replace(/\D/g, '') !== normalizedPhone);
    saveDB(db);
    
    twiml.say("Your appointment request has been canceled. Goodbye.", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
  } else if (digit === '2') {
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  } else {
    twiml.say("Invalid option. Goodbye.", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/get-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;

  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-name?phone=${encodeURIComponent(phone)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("What is your full name?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your name. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-name', (req, res) => {
  const twiml = new VoiceResponse();
  const name = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  
  if (!name || name.trim() === '') {
    twiml.say("Sorry, I didn't catch your name.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${name}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/get-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`Thanks ${name}. What type of business do you have?`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your business type.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const businessType = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  if (!businessType || businessType.trim() === '') {
    twiml.say("I didn't catch that.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${businessType}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/get-service-type', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say("What type of service are you looking for?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your service type.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-service-type', (req, res) => {
  const twiml = new VoiceResponse();
  const serviceType = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  
  if (!serviceType || serviceType.trim() === '') {
    twiml.say("I didn't catch that.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/submit-request?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${serviceType}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/submit-request', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  const serviceType = decodeURIComponent(req.query.serviceType || '');
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const appointmentSaved = addAppointment(name, phone, businessType, serviceType);
  
  if (appointmentSaved) {
    try {
      twilioClient.messages.create({
        body:
          `Thank you for requesting an appointment with Manet Creative.\n\n` +
          `Your request has been received and is pending review. ` +
          `A member of our team will contact you by text message if your appointment is approved and will provide the confirmed date and time.\n\n` +
          `Please note: this is not a guaranteed appointment. Approval depends on whether your project meets our minimum budget requirement.\n\n` +
          `For our privacy policy, please visit https://manet.agency.\n` +
          `For emergencies or general inquiries, please email mila@meetmanet.com.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone
      });
      saveMessage({ phone, direction: 'outbound', body: 'Appointment request received and pending review.' });
    } catch (err) {}
    
    try {
      twilioClient.messages.create({
        body: `New Manet appointment request:\n\nName: ${name}\nPhone: ${phone}\nBusiness: ${businessType}\nService: ${serviceType}\n\nReview it in the admin dashboard.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.MY_PERSONAL_NUMBER
      });
    } catch (err) {}
  }
  
  twiml.say(
    "Thank you. Your appointment request has been received and is pending review. " +
    "A member of our team will text you if your request is approved and will provide the confirmed date and time. " +
    "This request is not a guaranteed appointment. Approval depends on whether your project meets our minimum budget requirement. " +
    "For our privacy policy, please visit manet dot agency. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// PUBLIC ENDPOINTS
// ======================================================

app.get('/health', (req, res) => {
  res.send('OK');
});

app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(`<!-- MANET_LANDING_V3 -->
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manet Creative — AI-run creative studio</title>
<style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; background: #f2f1ec; color: #161616; -webkit-font-smoothing: antialiased; }
      a { color: inherit; }
      /* Navbar */
      .navbar { background: #fbfaf7; border-bottom: 1px solid #e2ded2; }
      .navbar-inner { max-width: 1180px; margin: 0 auto; padding: 16px 32px; display: flex; align-items: center; justify-content: space-between; }
      .nav-logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.9rem; }
      .nav-logo svg { display: block; }
      .nav-links { display: flex; gap: 30px; font-size: 0.8rem; color: #4a4a44; }
      .nav-links a { text-decoration: none; }
      .nav-links a:hover { color: #161616; }
      .nav-right { display: flex; gap: 10px; align-items: center; }
      /* Buttons */
      .btn { display: inline-block; padding: 9px 18px; border-radius: 3px; font-size: 0.78rem; font-weight: 700; text-decoration: none; border: 1.3px solid transparent; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; cursor: pointer; }
      .btn.primary { background: #14140f; color: #fff; }
      .btn.primary:hover { opacity: 0.85; }
      .btn.outline { border-color: #d6d2c4; color: #14140f; background: #fff; }
      .btn.outline:hover { border-color: #14140f; }
      /* Hero sections */
      .wrap { max-width: 1180px; margin: 0 auto; padding: 0 32px; }
      .announce { max-width: 1180px; margin: 0 auto; padding: 26px 32px 0; font-size: 0.76rem; color: #6b6b64; display: flex; align-items: center; gap: 7px; }
      .announce .dot3 { width: 6px; height: 6px; border-radius: 50%; background: #14140f; display: inline-block; }
      .announce a { color: #e8623d; text-decoration: none; font-weight: 700; }
      .announce a:hover { text-decoration: underline; }
      .hero-row { display: flex; align-items: flex-start; gap: 60px; padding: 22px 0 70px; flex-wrap: wrap; }
      .hero-left { flex: 1 1 420px; min-width: 300px; padding-top: 10px; }
      .hero-right { flex: 1 1 440px; min-width: 320px; position: relative; padding-bottom: 60px; }
      h1.headline { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 2.5rem; line-height: 1.14; font-weight: 700; letter-spacing: -0.8px; margin: 0 0 20px; color: #14140f; }
      .sub { font-size: 0.86rem; color: #6b6b64; line-height: 1.65; margin: 0 0 16px; max-width: 460px; }
      .cta-row2 { display: flex; gap: 10px; margin-top: 26px; }
      /* Light-theme IDE mockup */
      .ide-mock { background: #ffffff; border: 1px solid #e2ded2; border-radius: 8px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.08); }
      .ide-bar { display: flex; align-items: center; gap: 6px; padding: 9px 12px; background: #f5f4ef; border-bottom: 1px solid #e2ded2; }
      .ide-dot { width: 9px; height: 9px; border-radius: 50%; }
      .ide-body { display: flex; }
      .ide-tree { width: 130px; background: #fafaf7; padding: 10px 8px; font-size: 0.62rem; color: #8a877a; border-right: 1px solid #eeece4; line-height: 2; }
      .ide-tree .t1 { color: #4a4a44; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.4px; font-size: 0.6rem; }
      .ide-tree .f { padding-left: 6px; }
      .ide-tree .f.on { color: #14140f; background: #eeece4; margin-left: -8px; padding-left: 14px; font-weight: 600; }
      .ide-code { flex: 1; padding: 12px 14px; font-size: 0.66rem; line-height: 1.75; color: #3a3a34; overflow-x: auto; background: #fff; }
      .ide-code .k { color: #c2185b; } .ide-code .s { color: #2e7d32; } .ide-code .c { color: #9a9488; } .ide-code .f2 { color: #1565c0; }
      /* Layered terminal box — light theme too */
      .term-mock { position: absolute; right: -14px; bottom: 0; width: 76%; background: #ffffff; border: 1px solid #e2ded2; border-radius: 7px; box-shadow: 0 20px 50px rgba(0,0,0,0.1); }
      .term-tabs { display: flex; gap: 0; border-bottom: 1px solid #eeece4; padding: 6px 10px; }
      .term-tab { padding: 4px 10px; font-size: 0.6rem; color: #9a9488; border-radius: 3px; }
      .term-tab.on { color: #14140f; background: #f0efe8; font-weight: 700; }
      .term-line { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 0.68rem; color: #3a3a34; }
      .term-copy { color: #9a9488; cursor: pointer; }
      /* Bordered grid strip (feature/role grid, honest — not fake client logos) */
      .grid-strip { border-top: 1px solid #e2ded2; border-bottom: 1px solid #e2ded2; background: #fbfaf7; }
      .grid-row { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); }
      .grid-cell { padding: 34px 20px; text-align: center; border-right: 1px solid #e2ded2; font-size: 0.8rem; color: #4a4a44; font-weight: 700; }
      .grid-cell:last-child { border-right: none; }
      .grid-cell .gi { font-size: 22px; display: block; margin-bottom: 8px; }
      /* Footer */
      footer { border-top: 1px solid #e2ded2; padding: 40px 32px 50px; text-align: center; color: #9a9488; font-size: 0.76rem; background: #fbfaf7; }
      footer a { color: #14140f; text-decoration: none; font-weight: 700; }
      footer a:hover { text-decoration: underline; }
      footer .foot-brand { font-weight: 700; font-size: 0.95rem; color: #14140f; margin-bottom: 8px; }
      @media (max-width: 760px) {
        h1.headline { font-size: 1.9rem; }
        .term-mock { display: none; }
        .nav-links { display: none; }
        .grid-row { grid-template-columns: repeat(2, 1fr); }
      }
    </style>
</head>
<body>
  <div class="navbar">
    <div class="navbar-inner">
      <div class="nav-logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14140f" stroke-width="1.6"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>Manet Creative</div>
      <div class="nav-links">
        <a href="/office">Office</a>
        <a href="/admin">Phone</a>
        <a href="https://manet.agency">Pricing</a>
        <a href="https://manet.agency">Company</a>
        <a href="https://manet.agency">Docs</a>
      </div>
      <div class="nav-right">
        <a href="https://manet.agency" class="btn outline">Contact Sales</a>
        <a href="/login" class="btn primary">Login</a>
      </div>
    </div>
  </div>
  <div class="announce"><span class="dot3"></span>New — the real AI office is live internally<a href="https://manet.agency">Read more →</a></div>
  <div class="wrap">
    <div class="hero-row">
      <div class="hero-left">
        <h1 class="headline">An AI-run creative studio, built for real client work.</h1>
        <p class="sub">Phone, team, and Instagram — one real system behind Manet Creative, watched by an actual person, not a black box.</p>
        <p class="sub">Real calls get answered. Real work gets distributed to a real AI team with a real budget. Real messages get real replies, reviewed before they send.</p>
        <div class="cta-row2">
          <a href="/login" class="btn primary">Member Login</a>
          <a href="https://manet.agency" class="btn outline">Manet for Clients</a>
        </div>
      </div>
      <div class="hero-right">
        <div class="ide-mock">
          <div class="ide-bar"><span class="ide-dot" style="background:#ff5f57;"></span><span class="ide-dot" style="background:#febc2e;"></span><span class="ide-dot" style="background:#28c840;"></span></div>
          <div class="ide-body">
            <div class="ide-tree">
              <div class="t1">manet-office</div>
              <div class="f">📁 routes</div>
              <div class="f">📁 store</div>
              <div class="f on">📄 office-integration.js</div>
              <div class="f">📄 index.js</div>
              <div class="f">📄 package.json</div>
            </div>
            <div class="ide-code"><pre style="margin:0;"><span class="c">// real scanner traps — these paths don't</span>
<span class="c">// exist here, so hitting one is a bot</span>
<span class="k">const</span> HONEYPOT_PATHS = <span class="k">new</span> <span class="f2">Set</span>([
  <span class="s">'/wp-admin'</span>, <span class="s">'/.env'</span>,
  <span class="s">'/phpmyadmin'</span>, <span class="s">'/.git/config'</span>
]);

app.<span class="f2">use</span>((req, res, next) => {
  <span class="k">if</span> (HONEYPOT_PATHS.<span class="f2">has</span>(req.path)) {
    store.<span class="f2">banIp</span>(ip, <span class="s">'probed honeypot'</span>);
    <span class="k">return</span> res.<span class="f2">status</span>(404).<span class="f2">send</span>(<span class="s">'Not found.'</span>);
  }
  <span class="f2">next</span>();
});</pre></div>
          </div>
        </div>
        <div class="term-mock">
          <div class="term-tabs"><div class="term-tab on">MACOS</div><div class="term-tab">LINUX</div></div>
          <div class="term-line"><span>&gt; open https://manet.agency</span><span class="term-copy">⧉</span></div>
        </div>
      </div>
    </div>
  </div>
  <div class="grid-strip">
    <div class="grid-row">
      <div class="grid-cell"><span class="gi">📞</span>Phone, answered</div>
      <div class="grid-cell"><span class="gi">🏢</span>A studio that thinks</div>
      <div class="grid-cell"><span class="gi">📷</span>Instagram, covered</div>
      <div class="grid-cell"><span class="gi">🔒</span>Actually secured</div>
    </div>
  </div>
  <div style="background:#ffffff;">
  <div class="wrap">
    <div class="hero-row" style="padding-top:70px;">
      <div class="hero-left">
        <div class="announce" style="padding:0 0 14px;"><span class="dot3"></span>New feature<a href="https://manet.agency">Read more →</a></div>
        <h1 class="headline" style="font-size:2.1rem;">Your studio, staffed and running.</h1>
        <p class="sub">Six real AI teammates, a real day-rate budget, a real archive of every project — Mila directs, the team executes, you approve.</p>
        <p class="sub">🚧 This system isn't open to every client yet — we're still finishing the last pieces internally. The full AI-run office will be available to all Manet clients soon.</p>
        <div class="cta-row2">
          <a href="/login" class="btn primary">Member Login</a>
          <a href="https://manet.agency" class="btn outline">Manet for Clients</a>
        </div>
      </div>
      <div class="hero-right">
        <div class="ide-mock">
          <div class="ide-bar"><span class="ide-dot" style="background:#ff5f57;"></span><span class="ide-dot" style="background:#febc2e;"></span><span class="ide-dot" style="background:#28c840;"></span></div>
          <div class="ide-body">
            <div class="ide-tree">
              <div class="t1">manet-office</div>
              <div class="f">📁 routes</div>
              <div class="f on">📄 office.html</div>
              <div class="f">📄 projects.js</div>
              <div class="f">📄 team.js</div>
            </div>
            <div class="ide-code"><pre style="margin:0;"><span class="c">// every real job becomes a project</span>
<span class="c">// with a real, permanent archive</span>
<span class="k">function</span> <span class="f2">createProject</span>(text, importance, budget) {
  <span class="k">const</span> project = {
    id, title: text, importance, budget,
    status: <span class="s">'active'</span>,
    distribution: [],
    chatHistory: [],
  };
  s.projectsList.<span class="f2">unshift</span>(project);
  <span class="f2">syncProjectsToCloud</span>();
  <span class="k">return</span> project;
}</pre></div>
          </div>
        </div>
        <div class="term-mock">
          <div class="term-tabs"><div class="term-tab on">MACOS</div><div class="term-tab">LINUX</div></div>
          <div class="term-line"><span>&gt; open https://manet.agency/office</span><span class="term-copy">⧉</span></div>
        </div>
      </div>
    </div>
  </div>
  </div>
  <footer>
    <div class="foot-brand">Manet Creative</div>
    <div>Built to run itself, watched by someone who still cares.</div>
    <div style="margin-top:10px;"><a href="https://manet.agency">manet.agency</a> · <a href="/login">Member Login</a></div>
  </footer>
</body>
</html>`);
});

app.get('/login', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  try { if (typeof hasValidSession === 'function' && hasValidSession(req)) return res.redirect('/choose'); } catch (e) {}
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Member Login — Manet Creative</title>
<style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; background: #f2f1ec; color: #161616; -webkit-font-smoothing: antialiased; }
      a { color: inherit; }
      /* Navbar */
      .navbar { background: #fbfaf7; border-bottom: 1px solid #e2ded2; }
      .navbar-inner { max-width: 1180px; margin: 0 auto; padding: 16px 32px; display: flex; align-items: center; justify-content: space-between; }
      .nav-logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.9rem; }
      .nav-logo svg { display: block; }
      .nav-links { display: flex; gap: 30px; font-size: 0.8rem; color: #4a4a44; }
      .nav-links a { text-decoration: none; }
      .nav-links a:hover { color: #161616; }
      .nav-right { display: flex; gap: 10px; align-items: center; }
      /* Buttons */
      .btn { display: inline-block; padding: 9px 18px; border-radius: 3px; font-size: 0.78rem; font-weight: 700; text-decoration: none; border: 1.3px solid transparent; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; cursor: pointer; }
      .btn.primary { background: #14140f; color: #fff; }
      .btn.primary:hover { opacity: 0.85; }
      .btn.outline { border-color: #d6d2c4; color: #14140f; background: #fff; }
      .btn.outline:hover { border-color: #14140f; }
      /* Hero sections */
      .wrap { max-width: 1180px; margin: 0 auto; padding: 0 32px; }
      .announce { max-width: 1180px; margin: 0 auto; padding: 26px 32px 0; font-size: 0.76rem; color: #6b6b64; display: flex; align-items: center; gap: 7px; }
      .announce .dot3 { width: 6px; height: 6px; border-radius: 50%; background: #14140f; display: inline-block; }
      .announce a { color: #e8623d; text-decoration: none; font-weight: 700; }
      .announce a:hover { text-decoration: underline; }
      .hero-row { display: flex; align-items: flex-start; gap: 60px; padding: 22px 0 70px; flex-wrap: wrap; }
      .hero-left { flex: 1 1 420px; min-width: 300px; padding-top: 10px; }
      .hero-right { flex: 1 1 440px; min-width: 320px; position: relative; padding-bottom: 60px; }
      h1.headline { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 2.5rem; line-height: 1.14; font-weight: 700; letter-spacing: -0.8px; margin: 0 0 20px; color: #14140f; }
      .sub { font-size: 0.86rem; color: #6b6b64; line-height: 1.65; margin: 0 0 16px; max-width: 460px; }
      .cta-row2 { display: flex; gap: 10px; margin-top: 26px; }
      /* Light-theme IDE mockup */
      .ide-mock { background: #ffffff; border: 1px solid #e2ded2; border-radius: 8px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.08); }
      .ide-bar { display: flex; align-items: center; gap: 6px; padding: 9px 12px; background: #f5f4ef; border-bottom: 1px solid #e2ded2; }
      .ide-dot { width: 9px; height: 9px; border-radius: 50%; }
      .ide-body { display: flex; }
      .ide-tree { width: 130px; background: #fafaf7; padding: 10px 8px; font-size: 0.62rem; color: #8a877a; border-right: 1px solid #eeece4; line-height: 2; }
      .ide-tree .t1 { color: #4a4a44; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.4px; font-size: 0.6rem; }
      .ide-tree .f { padding-left: 6px; }
      .ide-tree .f.on { color: #14140f; background: #eeece4; margin-left: -8px; padding-left: 14px; font-weight: 600; }
      .ide-code { flex: 1; padding: 12px 14px; font-size: 0.66rem; line-height: 1.75; color: #3a3a34; overflow-x: auto; background: #fff; }
      .ide-code .k { color: #c2185b; } .ide-code .s { color: #2e7d32; } .ide-code .c { color: #9a9488; } .ide-code .f2 { color: #1565c0; }
      /* Layered terminal box — light theme too */
      .term-mock { position: absolute; right: -14px; bottom: 0; width: 76%; background: #ffffff; border: 1px solid #e2ded2; border-radius: 7px; box-shadow: 0 20px 50px rgba(0,0,0,0.1); }
      .term-tabs { display: flex; gap: 0; border-bottom: 1px solid #eeece4; padding: 6px 10px; }
      .term-tab { padding: 4px 10px; font-size: 0.6rem; color: #9a9488; border-radius: 3px; }
      .term-tab.on { color: #14140f; background: #f0efe8; font-weight: 700; }
      .term-line { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 0.68rem; color: #3a3a34; }
      .term-copy { color: #9a9488; cursor: pointer; }
      /* Bordered grid strip (feature/role grid, honest — not fake client logos) */
      .grid-strip { border-top: 1px solid #e2ded2; border-bottom: 1px solid #e2ded2; background: #fbfaf7; }
      .grid-row { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); }
      .grid-cell { padding: 34px 20px; text-align: center; border-right: 1px solid #e2ded2; font-size: 0.8rem; color: #4a4a44; font-weight: 700; }
      .grid-cell:last-child { border-right: none; }
      .grid-cell .gi { font-size: 22px; display: block; margin-bottom: 8px; }
      /* Footer */
      footer { border-top: 1px solid #e2ded2; padding: 40px 32px 50px; text-align: center; color: #9a9488; font-size: 0.76rem; background: #fbfaf7; }
      footer a { color: #14140f; text-decoration: none; font-weight: 700; }
      footer a:hover { text-decoration: underline; }
      footer .foot-brand { font-weight: 700; font-size: 0.95rem; color: #14140f; margin-bottom: 8px; }
      @media (max-width: 760px) {
        h1.headline { font-size: 1.9rem; }
        .term-mock { display: none; }
        .nav-links { display: none; }
        .grid-row { grid-template-columns: repeat(2, 1fr); }
      }
    </style>
<style>
  .login-wrap { max-width: 380px; margin: 70px auto; padding: 0 24px; }
  .login-card { background: #fff; border: 1px solid #e2ded2; border-radius: 8px; padding: 36px 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.06); }
  .login-card h1 { font-size: 1.15rem; margin: 0 0 6px; font-weight: 700; font-family: -apple-system, sans-serif; }
  .login-card .sub2 { font-size: 0.78rem; color: #9a9488; margin: 0 0 24px; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 0.72rem; font-weight: 700; color: #55534d; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.3px; }
  .field input { width: 100%; padding: 10px 12px; border: 1.4px solid #e0dcd0; border-radius: 4px; font-size: 0.85rem; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; }
  .field input:focus { outline: none; border-color: #14140f; }
  .login-btn { width: 100%; padding: 11px; background: #14140f; color: #fff; border: none; border-radius: 4px; font-size: 0.82rem; font-weight: 700; cursor: pointer; margin-top: 6px; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; }
  .login-btn:hover { opacity: 0.9; }
  .login-err { color: #b8433a; font-size: 0.76rem; margin-top: 10px; display: none; }
  .login-back { text-align: center; margin-top: 18px; font-size: 0.74rem; }
  .login-back a { color: #9a9488; text-decoration: none; }
</style>
</head>
<body>
  <div class="navbar">
    <div class="navbar-inner">
      <div class="nav-logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14140f" stroke-width="1.6"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>Manet Creative</div>
      <div class="nav-links">
        <a href="/office">Office</a>
        <a href="/admin">Phone</a>
        <a href="https://manet.agency">Pricing</a>
        <a href="https://manet.agency">Company</a>
        <a href="https://manet.agency">Docs</a>
      </div>
      <div class="nav-right">
        <a href="https://manet.agency" class="btn outline">Contact Sales</a>
        <a href="/login" class="btn primary">Login</a>
      </div>
    </div>
  </div>
  <div class="announce"><span class="dot3"></span>Protected area — real credentials required<a href="https://manet.agency">Manet Agency →</a></div>
  <div class="login-wrap">
    <div class="login-card">
      <h1>Member Login</h1>
      <p class="sub2">Same login as always — this just makes it less ugly.</p>
      <form id="loginForm" onsubmit="return false;">
        <div class="field"><label>Username</label><input type="text" id="loginUser" autocomplete="username"></div>
        <div class="field"><label>Password</label><input type="password" id="loginPass" autocomplete="current-password"></div>
        <button class="login-btn" onclick="doLogin()">Sign in</button>
        <div class="login-err" id="loginErr">Wrong username or password.</div>
      </form>
      <div class="login-back"><a href="/">← Back</a></div>
    </div>
  </div>
  <script>
    async function doLogin() {
      const u = document.getElementById('loginUser').value;
      const p = document.getElementById('loginPass').value;
      if (!u || !p) return;
      const btn = document.querySelector('.login-btn');
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const r = await fetch('/office/api/session-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        });
        if (r.ok) {
          window.location.href = '/choose';
        } else {
          document.getElementById('loginErr').style.display = 'block';
          btn.disabled = false; btn.textContent = 'Sign in';
        }
      } catch (e) {
        document.getElementById('loginErr').style.display = 'block';
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    }
    document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  </script>
</body>
</html>`);
});

app.get('/choose', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manet Creative — Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; background: #f4f2ec; color: #1a1a16; -webkit-font-smoothing: antialiased; }
  .navbar { background: #fbfaf7; border-bottom: 1px solid #e6e1d4; padding: 18px 36px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; }
  .nav-logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.92rem; }
  .nav-buttons { display: flex; gap: 10px; }
  .nav-btn { display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 8px; text-decoration: none; color: #1a1a16; background: #fff; border: 1.5px solid #e6e1d4; font-size: 0.78rem; font-weight: 700; transition: all 0.15s; }
  .nav-btn:hover { border-color: #1a1a16; transform: translateY(-1px); }
  .nav-btn .ic { font-size: 15px; }
  .logout-link { font-size: 0.74rem; color: #9a9488; text-decoration: none; }
  .wrap { max-width: 1400px; margin: 0 auto; padding: 40px 36px 100px; }
  h1 { font-size: 1.7rem; margin: 0 0 6px; letter-spacing: -0.4px; }
  .sub { color: #8a8272; font-size: 0.82rem; margin-bottom: 36px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
  .stat-card { background: #fff; border: 1px solid #e6e1d4; border-radius: 12px; padding: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.03); }
  .stat-card .stat-label { font-size: 0.68rem; color: #8a8272; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700; margin-bottom: 6px; }
  .stat-card .stat-num { font-size: 1.8rem; font-weight: 700; letter-spacing: -0.5px; }
  .section-card { background: #fff; border: 1px solid #e6e1d4; border-radius: 12px; padding: 26px; margin-bottom: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.03); }
  .section-title { font-size: 0.95rem; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  .section-sub { font-size: 0.74rem; color: #8a8272; margin-bottom: 18px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } .nav-buttons { flex-wrap: wrap; } }
  .mila-note { background: linear-gradient(135deg, #fff8ee, #fbfaf7); border: 1.5px solid #f0e4cc; border-radius: 12px; padding: 24px 26px; display: flex; gap: 16px; align-items: flex-start; }
  .mila-avatar { width: 40px; height: 40px; border-radius: 50%; background: #1a1a16; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
  .mila-note-text { font-size: 0.86rem; line-height: 1.6; }
  .mila-note-date { font-size: 0.68rem; color: #b0a992; margin-top: 8px; }
  .loading-text { color: #b0a992; font-size: 0.78rem; }
</style>
</head>
<body>
  <div class="navbar">
    <div class="nav-logo">✳️ Manet Creative</div>
    <div class="nav-buttons">
      <a href="/admin" class="nav-btn"><span class="ic">📞</span> Phone System</a>
      <a href="/office" class="nav-btn"><span class="ic">🏢</span> Our Office</a>
      <a href="/email-manager" class="nav-btn"><span class="ic">✉️</span> Email Manager</a>
      <a href="/leads" class="nav-btn"><span class="ic">👥</span> Leads</a>
      <a href="/business" class="nav-btn"><span class="ic">📋</span> Business</a>
    </div>
    <a href="/login" class="logout-link">Switch account</a>
  </div>

  <div class="wrap">
    <h1>Dashboard</h1>
    <div class="sub">Real numbers, pulled live from the phone system, email outreach, and office — nothing here is simulated.</div>

    <div class="stats-grid" id="topStats">
      <div class="stat-card"><div class="stat-label">Calls (30d)</div><div class="stat-num loading-text">…</div></div>
      <div class="stat-card"><div class="stat-label">Appointments</div><div class="stat-num loading-text">…</div></div>
      <div class="stat-card"><div class="stat-label">Emails replied</div><div class="stat-num loading-text">…</div></div>
      <div class="stat-card"><div class="stat-label">Active projects</div><div class="stat-num loading-text">…</div></div>
      <div class="stat-card"><div class="stat-label">Total AI tokens used</div><div class="stat-num loading-text">…</div></div>
    </div>

    <div class="section-card">
      <div class="section-title">📞 Call volume</div>
      <div class="section-sub" id="callRangeLabels">Loading real call data…</div>
      <div id="callChart"></div>
    </div>

    <div class="two-col">
      <div class="section-card">
        <div class="section-title">✉️ Email outreach</div>
        <div class="section-sub">Real state of the outreach spreadsheet</div>
        <div id="emailStats" class="loading-text">Loading…</div>
      </div>
      <div class="section-card">
        <div class="section-title">🏢 Office</div>
        <div class="section-sub">Real project and AI spend state</div>
        <div id="officeStats" class="loading-text">Loading…</div>
      </div>
    </div>

    <div class="two-col">
      <div class="section-card">
        <div class="section-title">📋 Business notes</div>
        <div class="section-sub">Latest — <a href="/business" style="color:#8a8272;">see all →</a></div>
        <div id="bizNotesPreview" class="loading-text">Loading…</div>
      </div>
      <div class="section-card">
        <div class="section-title">⏰ Open business reminders</div>
        <div class="section-sub"><a href="/business" style="color:#8a8272;">see all →</a></div>
        <div id="bizRemindersPreview" class="loading-text">Loading…</div>
      </div>
    </div>

    <div class="mila-note" id="milaNoteBox" style="display:none;">
      <div class="mila-avatar">M</div>
      <div>
        <div class="mila-note-text" id="milaNoteText"></div>
        <div class="mila-note-date" id="milaNoteDate"></div>
      </div>
    </div>
  </div>

<script>
function barChart(data, color) {
  if (!data || !data.length) return '<div class="loading-text">No data yet.</div>';
  const max = Math.max(...data.map(d => d.value), 1);
  const barW = Math.max(8, Math.min(24, 1200 / data.length - 4)), gap = 4, h = 110;
  const totalW = Math.max(600, data.length * (barW + gap));
  const bars = data.map((d, i) => {
    const bh = (d.value / max) * h;
    const x = i * (barW + gap);
    return '<rect x="' + x + '" y="' + (h - bh) + '" width="' + barW + '" height="' + Math.max(bh, 1) + '" rx="2" fill="' + color + '" opacity="0.85"><title>' + d.label + ': ' + d.value + '</title></rect>' +
      (d.value > 0 ? '<text x="' + (x + barW/2) + '" y="' + (h - bh - 4) + '" text-anchor="middle" font-size="8" fill="#8a8272">' + d.value + '</text>' : '') +
      '<text x="' + (x + barW/2) + '" y="' + (h + 14) + '" text-anchor="middle" font-size="7" fill="#b0a992" transform="rotate(45,' + (x+barW/2) + ',' + (h+14) + ')">' + d.label + '</text>';
  }).join('');
  return '<svg viewBox="0 0 ' + totalW + ' ' + (h + 30) + '" width="100%" height="' + (h + 40) + '" preserveAspectRatio="xMinYMid meet">' + bars + '</svg>';
}

async function loadDashboard() {
  try {
    const [phoneRes, emailRes] = await Promise.all([
      fetch('/api/dashboard/phone-stats', { credentials: 'include' }),
      fetch('/office/api/dashboard-stats', { credentials: 'include' }).catch(() => null)
    ]);
    const phone = phoneRes.ok ? await phoneRes.json() : null;
    const officeData = emailRes && emailRes.ok ? await emailRes.json() : null;

    const stats = document.querySelectorAll('#topStats .stat-num');
    if (phone) {
      stats[0].textContent = phone.last30Days;
      stats[0].classList.remove('loading-text');
      stats[1].textContent = phone.totalAppointments;
      stats[1].classList.remove('loading-text');
      document.getElementById('callRangeLabels').textContent = phone.last1Day + ' today · ' + phone.last7Days + ' this week · ' + phone.last30Days + ' this month · ' + phone.totalAllTime + ' all-time';
      document.getElementById('callChart').innerHTML = barChart(phone.dailySeries, '#1a1a16');
    } else {
      document.getElementById('callChart').innerHTML = '<div class="loading-text">Could not load call data.</div>';
    }

    if (officeData) {
      stats[2].textContent = officeData.email.replied;
      stats[2].classList.remove('loading-text');
      stats[3].textContent = officeData.office.activeProjects;
      stats[3].classList.remove('loading-text');
      if (officeData.grandTotal) {
        stats[4].textContent = officeData.grandTotal.tokens.toLocaleString();
        stats[4].classList.remove('loading-text');
        stats[4].title = 'Office: ' + officeData.grandTotal.breakdown.office.toLocaleString() + ' · Email: ' + officeData.grandTotal.breakdown.email.toLocaleString() + ' · Instagram: ' + officeData.grandTotal.breakdown.instagram.toLocaleString() + ' · Total cost: $' + officeData.grandTotal.cost.toFixed(4);
      }
      document.getElementById('emailStats').innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:0.8rem;">' +
        '<div><b>' + officeData.email.totalRows + '</b><div style="color:#8a8272;font-size:0.7rem;">total tracked</div></div>' +
        '<div><b>' + officeData.email.sent + '</b><div style="color:#8a8272;font-size:0.7rem;">confirmed sent</div></div>' +
        '<div><b>' + officeData.email.replied + '</b><div style="color:#8a8272;font-size:0.7rem;">replied</div></div>' +
        '<div><b>' + officeData.email.awaitingFollowup + '</b><div style="color:#8a8272;font-size:0.7rem;">awaiting follow-up</div></div>' +
        '</div>';
      document.getElementById('officeStats').innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:0.8rem;">' +
        '<div><b>' + officeData.office.activeProjects + '</b><div style="color:#8a8272;font-size:0.7rem;">active projects</div></div>' +
        '<div><b>' + officeData.office.closedProjects + '</b><div style="color:#8a8272;font-size:0.7rem;">closed</div></div>' +
        '<div><b>' + officeData.office.totalTokensUsed.toLocaleString() + '</b><div style="color:#8a8272;font-size:0.7rem;">real tokens used</div></div>' +
        '<div><b>$' + officeData.office.totalCost.toFixed(4) + '</b><div style="color:#8a8272;font-size:0.7rem;">real AI spend</div></div>' +
        '</div>';
    } else {
      document.getElementById('emailStats').innerHTML = '<div class="loading-text">Connect the office system to see this.</div>';
      document.getElementById('officeStats').innerHTML = '<div class="loading-text">Connect the office system to see this.</div>';
    }
  } catch (e) {
    document.getElementById('callChart').innerHTML = '<div class="loading-text">Error: ' + e.message + '</div>';
  }
}

async function loadMilaNote() {
  try {
    const res = await fetch('/office/api/daily-mila-note', { credentials: 'include' });
    if (!res.ok) return;
    const note = await res.json();
    if (!note || !note.text) return;
    document.getElementById('milaNoteText').textContent = note.text;
    document.getElementById('milaNoteDate').textContent = 'Mila · ' + note.date;
    document.getElementById('milaNoteBox').style.display = 'flex';
  } catch (e) {}
}

function escDash(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
async function loadBusinessPreview() {
  try {
    const [notesRes, remRes] = await Promise.all([
      fetch('/api/business/notes', { credentials: 'include' }),
      fetch('/api/business/reminders', { credentials: 'include' })
    ]);
    const notes = notesRes.ok ? await notesRes.json() : [];
    const reminders = remRes.ok ? await remRes.json() : [];
    const notesEl = document.getElementById('bizNotesPreview');
    notesEl.classList.remove('loading-text');
    notesEl.innerHTML = notes.length ? notes.slice(-3).reverse().map(n => '<div style="font-size:0.78rem;padding:6px 0;border-bottom:1px solid #f0ede3;">' + escDash(n.text) + '</div>').join('') : '<div style="color:#b0a992;font-size:0.78rem;">No business notes yet.</div>';
    const remEl = document.getElementById('bizRemindersPreview');
    remEl.classList.remove('loading-text');
    const openRem = reminders.filter(r => !r.done);
    remEl.innerHTML = openRem.length ? openRem.slice(0, 4).map(r => '<div style="font-size:0.78rem;padding:6px 0;border-bottom:1px solid #f0ede3;">⏰ ' + escDash(r.text) + (r.dueAt ? ' <span style="color:#b0a992;">— ' + r.dueAt + '</span>' : '') + '</div>').join('') : '<div style="color:#b0a992;font-size:0.78rem;">Nothing pending.</div>';
  } catch (e) {}
}

loadDashboard();
loadMilaNote();
loadBusinessPreview();
</script>
</body>
</html>`);
});




app.get('/business', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Business — Manet Creative</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; background: #f4f2ec; color: #1a1a16; -webkit-font-smoothing: antialiased; }
  .navbar { background: #fbfaf7; border-bottom: 1px solid #e6e1d4; padding: 18px 36px; display: flex; align-items: center; justify-content: space-between; }
  .navbar a { color: #6b6558; text-decoration: none; font-size: 0.76rem; font-weight: 700; padding: 6px 12px; border-radius: 6px; }
  .navbar a:hover { background: #eeece2; color: #1a1a16; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 30px 36px 100px; }
  h1 { font-size: 1.6rem; margin: 0 0 6px; }
  .sub { color: #8a8272; font-size: 0.82rem; margin-bottom: 24px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 24px; }
  .tab-btn { padding: 9px 18px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; background: #fff; border: 1.5px solid #e6e1d4; color: #6b6558; cursor: pointer; }
  .tab-btn.active { background: #1a1a16; color: #fff; border-color: #1a1a16; }
  .btn { display: inline-block; padding: 8px 16px; border-radius: 7px; font-size: 0.74rem; font-weight: 700; border: 1.5px solid transparent; cursor: pointer; font-family: inherit; }
  .btn.primary { background: #1a1a16; color: #fff; }
  .btn.outline { background: #fff; border-color: #d8d2c0; color: #1a1a16; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 860px) { .two-col { grid-template-columns: 1fr; } }
  .panel { background: #fff; border: 1px solid #e6e1d4; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .panel-title { font-size: 0.86rem; font-weight: 700; margin-bottom: 12px; }
  .panel-item { font-size: 0.78rem; padding: 10px 0; border-bottom: 1px solid #f0ede3; line-height: 1.5; }
  .panel-item:last-child { border-bottom: none; }
  .panel-item .pdate { font-size: 0.64rem; color: #b0a992; margin-top: 4px; }
  .panel textarea, .panel input { width: 100%; padding: 8px 11px; border: 1.5px solid #e6e1d4; border-radius: 7px; font-size: 0.76rem; font-family: inherit; margin-bottom: 8px; }
  .reminder-row { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; padding: 8px 0; border-bottom: 1px solid #f0ede3; }
  .reminder-row.done { opacity: 0.5; text-decoration: line-through; }
  .empty { color: #b0a992; font-size: 0.76rem; padding: 16px 0; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 20px; }
  .stat-card { background: #fff; border: 1px solid #e6e1d4; border-radius: 12px; padding: 16px; }
  .stat-card .l { font-size: 0.64rem; color: #8a8272; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700; margin-bottom: 4px; }
  .stat-card .n { font-size: 1.5rem; font-weight: 700; }
  .stat-card.warn .n { color: #b45309; }
  .stat-card.ok .n { color: #166534; }
</style>
</head>
<body>
  <div class="navbar">
    <div>📋 Business</div>
    <a href="/choose">← Back</a>
  </div>
  <div class="wrap">
    <h1>Business</h1>
    <div class="sub">General plans and whole-server health — not tied to any one client.</div>

    <div class="tabs">
      <div class="tab-btn active" data-tab="plans" onclick="switchTab('plans')">📋 Plans & Notes</div>
      <div class="tab-btn" data-tab="health" onclick="switchTab('health')">🖥️ Server Health (Sasha)</div>
    </div>

    <div id="tabPlans">
      <div class="two-col">
        <div class="panel">
          <div class="panel-title">📝 My business notes — goals, next moves</div>
          <div id="notesList"></div>
          <textarea id="newNoteText" rows="2" placeholder="What's the plan?"></textarea>
          <button class="btn primary" onclick="addBusinessNote()">Add note</button>
        </div>
        <div class="panel">
          <div class="panel-title">Mila's thoughts — her own read on the business</div>
          <div id="milaThoughtsList"></div>
          <button class="btn primary" onclick="askMilaBusiness()">Ask Mila to think about it</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">Business reminders</div>
        <div id="remindersList"></div>
        <input id="newRemText" placeholder="e.g. Renew domain, update pricing page">
        <input id="newRemDate" type="date" style="width:auto;">
        <button class="btn outline" onclick="addBusinessReminder()">Add reminder</button>
      </div>
    </div>

    <div id="tabHealth" style="display:none;">
      <div class="stats-grid" id="healthStats"><div class="empty">Loading real server data…</div></div>
      <div class="panel">
        <div class="panel-title">Call load — last 30 days</div>
        <div id="loadChart"></div>
      </div>
      <div class="two-col">
        <div class="panel">
          <div class="panel-title">Office</div>
          <div id="officeHealth" class="empty">Loading…</div>
        </div>
        <div class="panel">
          <div class="panel-title">Email & Instagram</div>
          <div id="channelHealth" class="empty">Loading…</div>
        </div>
      </div>
    </div>
  </div>

<script>
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('tabPlans').style.display = tab === 'plans' ? 'block' : 'none';
  document.getElementById('tabHealth').style.display = tab === 'health' ? 'block' : 'none';
  if (tab === 'health') loadHealth();
}
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

async function loadPlans() {
  const [notesRes, thoughtsRes, remRes] = await Promise.all([
    fetch('/api/business/notes', { credentials: 'include' }),
    fetch('/api/business/mila-thoughts', { credentials: 'include' }),
    fetch('/api/business/reminders', { credentials: 'include' })
  ]);
  const notes = notesRes.ok ? await notesRes.json() : [];
  const thoughts = thoughtsRes.ok ? await thoughtsRes.json() : [];
  const reminders = remRes.ok ? await remRes.json() : [];
  document.getElementById('notesList').innerHTML = notes.length ? notes.slice().reverse().map(n => '<div class="panel-item">' + esc(n.text) + '<div class="pdate">' + new Date(n.at).toLocaleString('en-US',{timeZone:'America/Los_Angeles'}) + '</div></div>').join('') : '<div class="empty">Nothing yet.</div>';
  document.getElementById('milaThoughtsList').innerHTML = thoughts.length ? thoughts.slice().reverse().map(n => '<div class="panel-item">' + esc(n.text) + '<div class="pdate">' + new Date(n.at).toLocaleString('en-US',{timeZone:'America/Los_Angeles'}) + '</div></div>').join('') : '<div class="empty">Nothing yet — ask her to think about it.</div>';
  document.getElementById('remindersList').innerHTML = reminders.length ? reminders.map(r => '<div class="reminder-row' + (r.done?' done':'') + '"><input type="checkbox" ' + (r.done?'checked':'') + ' data-rem="' + r.id + '" onchange="toggleBusinessReminder(this)"> ' + esc(r.text) + (r.dueAt ? ' <span style="color:#b0a992;">— due ' + r.dueAt + '</span>' : '') + '</div>').join('') : '<div class="empty">No reminders yet.</div>';
}
async function addBusinessNote() {
  const text = document.getElementById('newNoteText').value.trim();
  if (!text) return;
  await fetch('/api/business/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ text }) });
  document.getElementById('newNoteText').value = '';
  loadPlans();
}
async function askMilaBusiness() {
  const btn = event.target;
  btn.disabled = true; btn.textContent = 'Mila is thinking…';
  const res = await fetch('/api/business/mila-analyze', { method: 'POST', credentials: 'include' });
  if (!res.ok) { const err = await res.json(); alert(err.error || 'Could not analyze.'); }
  btn.disabled = false; btn.textContent = 'Ask Mila to think about it';
  loadPlans();
}
async function addBusinessReminder() {
  const text = document.getElementById('newRemText').value.trim();
  const dueAt = document.getElementById('newRemDate').value;
  if (!text) return;
  await fetch('/api/business/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ text, dueAt }) });
  document.getElementById('newRemText').value = '';
  loadPlans();
}
async function toggleBusinessReminder(cb) {
  await fetch('/api/business/reminders/' + cb.dataset.rem + '/toggle', { method: 'POST', credentials: 'include' });
  loadPlans();
}

function barChart(data, color) {
  if (!data || !data.length) return '<div class="empty">No data yet.</div>';
  const max = Math.max(...data.map(d => d.value), 1);
  const barW = Math.max(8, Math.min(24, 1200 / data.length - 4)), gap = 4, h = 100;
  const totalW = Math.max(600, data.length * (barW + gap));
  const bars = data.map((d, i) => {
    const bh = (d.value / max) * h;
    const x = i * (barW + gap);
    return '<rect x="' + x + '" y="' + (h - bh) + '" width="' + barW + '" height="' + Math.max(bh,1) + '" rx="2" fill="' + color + '" opacity="0.85"><title>' + d.label + ': ' + d.value + '</title></rect>';
  }).join('');
  return '<svg viewBox="0 0 ' + totalW + ' ' + (h+10) + '" width="100%" height="' + (h+20) + '" preserveAspectRatio="xMinYMid meet">' + bars + '</svg>';
}

async function loadHealth() {
  try {
    const res = await fetch('/api/server-health', { credentials: 'include' });
    if (!res.ok) { document.getElementById('healthStats').innerHTML = '<div class="empty">Could not load.</div>'; return; }
    const h = await res.json();
    const uptimeH = Math.floor(h.server.uptimeSeconds / 3600), uptimeM = Math.floor((h.server.uptimeSeconds % 3600) / 60);
    document.getElementById('healthStats').innerHTML =
      '<div class="stat-card ok"><div class="l">Server uptime</div><div class="n">' + uptimeH + 'h ' + uptimeM + 'm</div></div>' +
      '<div class="stat-card"><div class="l">Memory used</div><div class="n">' + h.server.memoryUsedMB + ' MB</div></div>' +
      '<div class="stat-card"><div class="l">Calls (24h)</div><div class="n">' + h.phone.last24h + '</div></div>' +
      '<div class="stat-card ' + (h.phone.bounceRatePct > 50 ? 'warn' : '') + '"><div class="l">Call bounce rate</div><div class="n">' + h.phone.bounceRatePct + '%</div></div>' +
      '<div class="stat-card ' + (h.office.stalledProjects > 0 ? 'warn' : '') + '"><div class="l">Stalled projects</div><div class="n">' + h.office.stalledProjects + '</div></div>' +
      '<div class="stat-card ' + (h.email.overdueFollowup > 0 ? 'warn' : '') + '"><div class="l">Overdue follow-ups</div><div class="n">' + h.email.overdueFollowup + '</div></div>';
    document.getElementById('loadChart').innerHTML = barChart(h.phone.dailyLoad, '#1a1a16');
    document.getElementById('officeHealth').innerHTML =
      '<div class="panel-item">Active projects: <b>' + h.office.activeProjects + '</b></div>' +
      '<div class="panel-item">Real tokens used: <b>' + h.office.totalTokensUsed.toLocaleString() + '</b></div>' +
      '<div class="panel-item">Stalled (AI failing 2+ times): <b>' + h.office.stalledProjects + '</b></div>';
    document.getElementById('channelHealth').innerHTML =
      '<div class="panel-item">Email rows tracked: <b>' + h.email.total + '</b></div>' +
      '<div class="panel-item">Overdue follow-ups: <b>' + h.email.overdueFollowup + '</b></div>' +
      '<div class="panel-item">Instagram real activity: <b>' + h.instagram.totalActivity + '</b> (' + h.instagram.held + ' held for review)</div>' +
      '<div class="panel-item">Calls: <b>' + h.phone.totalCalls + '</b> total — <b>' + h.phone.engaged + '</b> engaged, <b>' + h.phone.bounced + '</b> bounced, <b>' + h.phone.noInput + '</b> no input</div>';
  } catch (e) { document.getElementById('healthStats').innerHTML = '<div class="empty">' + e.message + '</div>'; }
}

loadPlans();
</script>
</body>
</html>`);
});

app.get('/leads', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leads — Manet Creative</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; background: #f4f2ec; color: #1a1a16; -webkit-font-smoothing: antialiased; }
  .navbar { background: #fbfaf7; border-bottom: 1px solid #e6e1d4; padding: 18px 36px; display: flex; align-items: center; justify-content: space-between; }
  .navbar a { color: #6b6558; text-decoration: none; font-size: 0.76rem; font-weight: 700; padding: 6px 12px; border-radius: 6px; }
  .navbar a:hover { background: #eeece2; color: #1a1a16; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 40px 36px 100px; }
  h1 { font-size: 1.6rem; margin: 0 0 6px; }
  .sub { color: #8a8272; font-size: 0.82rem; margin-bottom: 28px; }
  .btn { display: inline-block; padding: 10px 20px; border-radius: 7px; font-size: 0.78rem; font-weight: 700; border: 1.5px solid transparent; cursor: pointer; font-family: inherit; }
  .btn.primary { background: #1a1a16; color: #fff; }
  .btn.outline { background: #fff; border-color: #d8d2c0; color: #1a1a16; }
  .add-box { background: #fff; border: 1px solid #e6e1d4; border-radius: 12px; padding: 20px; margin-bottom: 28px; }
  .add-box input { padding: 9px 12px; border: 1.5px solid #e6e1d4; border-radius: 7px; font-size: 0.78rem; font-family: inherit; margin-right: 8px; margin-bottom: 8px; }
  .lead-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .lead-card { background: #fff; border: 1px solid #e6e1d4; border-radius: 12px; padding: 18px; cursor: pointer; transition: all 0.15s; }
  .lead-card:hover { border-color: #1a1a16; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.06); }
  .lead-card .lname { font-weight: 700; font-size: 0.9rem; margin-bottom: 6px; }
  .lead-card .lid { font-size: 0.7rem; color: #8a8272; margin-bottom: 2px; }
  .lead-card .lmeta { font-size: 0.68rem; color: #b0a992; margin-top: 8px; }
  .detail-overlay { position: fixed; inset: 0; background: rgba(20,18,12,0.4); display: none; align-items: flex-start; justify-content: center; z-index: 1000; overflow-y: auto; padding: 40px 20px; }
  .detail-overlay.open { display: flex; }
  .detail-box { background: #fff; border-radius: 14px; max-width: 780px; width: 100%; padding: 30px; }
  .detail-close { float: right; cursor: pointer; font-size: 1.2rem; color: #8a8272; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
  .panel { background: #fbfaf7; border: 1px solid #e6e1d4; border-radius: 10px; padding: 16px; }
  .panel-title { font-size: 0.78rem; font-weight: 700; margin-bottom: 10px; }
  .panel-item { font-size: 0.76rem; padding: 8px 0; border-bottom: 1px solid #eeece4; line-height: 1.5; }
  .panel-item:last-child { border-bottom: none; }
  .panel-item .pdate { font-size: 0.64rem; color: #b0a992; margin-top: 3px; }
  .panel input, .panel textarea { width: 100%; padding: 7px 9px; border: 1.5px solid #e6e1d4; border-radius: 6px; font-size: 0.74rem; font-family: inherit; margin-bottom: 6px; }
  .timeline-item { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0ede3; font-size: 0.76rem; }
  .timeline-icon { flex-shrink: 0; }
  .timeline-date { font-size: 0.64rem; color: #b0a992; }
  .reminder-row { display: flex; align-items: center; gap: 8px; font-size: 0.76rem; padding: 6px 0; }
  .reminder-row.done { opacity: 0.5; text-decoration: line-through; }
  .empty { color: #b0a992; font-size: 0.78rem; padding: 30px; text-align: center; }
</style>
</head>
<body>
  <div class="navbar">
    <div>👥 Leads</div>
    <a href="/choose">← Back</a>
  </div>
  <div class="wrap">
    <h1>Leads</h1>
    <div class="sub">One card per real contact — pulls in their real calls, emails, and Instagram messages automatically.</div>

    <div class="add-box">
      <input id="newName" placeholder="Name (optional)">
      <input id="newPhone" placeholder="Phone">
      <input id="newEmail" placeholder="Email">
      <input id="newInstagram" placeholder="Instagram handle">
      <button class="btn primary" onclick="addLead()">+ Add lead</button>
    </div>

    <div id="leadsArea" class="lead-grid"><div class="empty">Loading…</div></div>
  </div>

  <div class="detail-overlay" id="detailOverlay" onmousedown="if(event.target===this)closeDetail();">
    <div class="detail-box" id="detailBox"></div>
  </div>

<script>
let leadsCache = [];

async function loadLeads() {
  try {
    const res = await fetch('/api/leads', { credentials: 'include' });
    if (!res.ok) { document.getElementById('leadsArea').innerHTML = '<div class="empty">Not logged in.</div>'; return; }
    leadsCache = await res.json();
    renderLeads();
  } catch (e) { document.getElementById('leadsArea').innerHTML = '<div class="empty">' + e.message + '</div>'; }
}

function renderLeads() {
  const area = document.getElementById('leadsArea');
  if (!leadsCache.length) { area.innerHTML = '<div class="empty">No leads yet — add your first one above.</div>'; return; }
  area.innerHTML = leadsCache.map(l => {
    const openReminders = (l.reminders || []).filter(r => !r.done).length;
    return '<div class="lead-card" data-id="' + l.id + '" onclick="openDetail(this.dataset.id)">' +
      '<div class="lname">' + esc(l.name || l.email || l.phone || l.instagram || 'Unnamed') + '</div>' +
      (l.phone ? '<div class="lid">📞 ' + esc(l.phone) + '</div>' : '') +
      (l.email ? '<div class="lid">✉️ ' + esc(l.email) + '</div>' : '') +
      (l.instagram ? '<div class="lid">📷 @' + esc(l.instagram) + '</div>' : '') +
      '<div class="lmeta">' + (l.ownerNotes||[]).length + ' notes · ' + (l.milaThoughts||[]).length + ' Mila thoughts' + (openReminders ? ' · ' + openReminders + ' reminder' + (openReminders===1?'':'s') : '') + '</div>' +
      '</div>';
  }).join('');
}

async function addLead() {
  const name = document.getElementById('newName').value.trim();
  const phone = document.getElementById('newPhone').value.trim();
  const email = document.getElementById('newEmail').value.trim();
  const instagram = document.getElementById('newInstagram').value.trim();
  if (!name && !phone && !email && !instagram) { alert('Give at least a name or one identifier.'); return; }
  const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name, phone, email, instagram }) });
  if (res.ok) {
    document.getElementById('newName').value = '';
    document.getElementById('newPhone').value = '';
    document.getElementById('newEmail').value = '';
    document.getElementById('newInstagram').value = '';
    loadLeads();
  }
}

const TIMELINE_ICONS = { call: '📞', appointment: '📅', email_sent: '✉️', email_followup: '↩️', email_reply: '✅', instagram_in: '📷', instagram_out: '📷' };

async function openDetail(id) {
  const overlay = document.getElementById('detailOverlay');
  const box = document.getElementById('detailBox');
  box.innerHTML = '<div class="empty">Loading real data…</div>';
  overlay.classList.add('open');
  const res = await fetch('/api/leads/' + encodeURIComponent(id), { credentials: 'include' });
  if (!res.ok) { box.innerHTML = '<div class="empty">Could not load.</div>'; return; }
  const { lead, timeline } = await res.json();
  renderDetail(lead, timeline);
}
function closeDetail() { document.getElementById('detailOverlay').classList.remove('open'); }

function renderDetail(lead, timeline) {
  const box = document.getElementById('detailBox');
  box.innerHTML =
    '<span class="detail-close" onclick="closeDetail()">✕</span>' +
    '<h2 style="margin:0 0 4px;">' + esc(lead.name || lead.email || lead.phone || lead.instagram || 'Unnamed') + '</h2>' +
    '<div style="font-size:0.76rem;color:#8a8272;margin-bottom:16px;">' + [lead.phone, lead.email, lead.instagram ? '@'+lead.instagram : ''].filter(Boolean).map(esc).join(' · ') + '</div>' +

    '<div class="panel-title">📋 Real timeline (auto — calls, emails, Instagram)</div>' +
    '<div class="panel" style="max-height:200px;overflow-y:auto;margin-bottom:16px;">' +
      (timeline.length ? timeline.map(e => '<div class="timeline-item"><span class="timeline-icon">' + (TIMELINE_ICONS[e.type]||'•') + '</span><div><div>' + esc(e.summary) + '</div><div class="timeline-date">' + new Date(e.at).toLocaleString('en-US',{timeZone:'America/Los_Angeles'}) + '</div></div></div>').join('') : '<div class="empty">No real activity yet on any channel.</div>') +
    '</div>' +

    '<div class="two-col">' +
      '<div class="panel">' +
        '<div class="panel-title">📝 My notes — goals, next moves</div>' +
        '<div id="notesList">' + renderNotesOrThoughts(lead.ownerNotes) + '</div>' +
        '<textarea id="newNoteText" rows="2" placeholder="What are you thinking for this one?"></textarea>' +
        '<button class="btn outline" data-id="' + lead.id + '" onclick="addNote(this.dataset.id)" style="font-size:0.7rem;padding:6px 12px;">Add note</button>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-title">💭 Mila\\'s thoughts — her own analysis</div>' +
        '<div id="milaList">' + renderNotesOrThoughts(lead.milaThoughts) + '</div>' +
        '<button class="btn primary" data-id="' + lead.id + '" onclick="askMilaAnalyze(this.dataset.id)" style="font-size:0.7rem;padding:6px 12px;">✨ Ask Mila to analyze</button>' +
      '</div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-title">⏰ Reminders</div>' +
      '<div id="remindersList">' + renderReminders(lead) + '</div>' +
      '<input id="newRemText" placeholder="e.g. Call back Friday">' +
      '<input id="newRemDate" type="date" style="width:auto;">' +
      '<button class="btn outline" data-id="' + lead.id + '" onclick="addReminder(this.dataset.id)" style="font-size:0.7rem;padding:6px 12px;">Add reminder</button>' +
    '</div>';
}
function renderNotesOrThoughts(items) {
  if (!items || !items.length) return '<div style="color:#b0a992;font-size:0.72rem;margin-bottom:8px;">Nothing yet.</div>';
  return items.slice().reverse().map(n => '<div class="panel-item">' + esc(n.text) + '<div class="pdate">' + new Date(n.at).toLocaleString('en-US',{timeZone:'America/Los_Angeles'}) + '</div></div>').join('');
}
function renderReminders(lead) {
  if (!lead.reminders || !lead.reminders.length) return '<div style="color:#b0a992;font-size:0.72rem;margin-bottom:8px;">No reminders yet.</div>';
  return lead.reminders.map(r => '<div class="reminder-row' + (r.done?' done':'') + '"><input type="checkbox" ' + (r.done?'checked':'') + ' data-lead="' + lead.id + '" data-rem="' + r.id + '" onchange="toggleReminder(this)"> ' + esc(r.text) + (r.dueAt ? ' <span style="color:#b0a992;">— due ' + r.dueAt + '</span>' : '') + '</div>').join('');
}

async function addNote(leadId) {
  const text = document.getElementById('newNoteText').value.trim();
  if (!text) return;
  await fetch('/api/leads/' + leadId + '/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ text }) });
  openDetail(leadId);
  loadLeads();
}
async function askMilaAnalyze(leadId) {
  const btn = event.target;
  btn.disabled = true; btn.textContent = 'Mila is thinking…';
  const res = await fetch('/api/leads/' + leadId + '/mila-analyze', { method: 'POST', credentials: 'include' });
  if (!res.ok) { const err = await res.json(); alert(err.error || 'Could not analyze.'); }
  openDetail(leadId);
  loadLeads();
}
async function addReminder(leadId) {
  const text = document.getElementById('newRemText').value.trim();
  const dueAt = document.getElementById('newRemDate').value;
  if (!text) return;
  await fetch('/api/leads/' + leadId + '/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ text, dueAt }) });
  openDetail(leadId);
  loadLeads();
}
async function toggleReminder(checkbox) {
  await fetch('/api/leads/' + checkbox.dataset.lead + '/reminders/' + checkbox.dataset.rem + '/toggle', { method: 'POST', credentials: 'include' });
  loadLeads();
}
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

loadLeads();
</script>
</body>
</html>`);
});

app.get('/email-manager', requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Email Manager — Manet Creative</title>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace; background: #f4f2ec; color: #1a1a16; -webkit-font-smoothing: antialiased; }
  .navbar { background: #fbfaf7; border-bottom: 1px solid #e6e1d4; padding: 18px 36px; display: flex; align-items: center; justify-content: space-between; }
  .navbar > div:first-child { font-size: 0.92rem; font-weight: 700; letter-spacing: -0.2px; }
  .navbar a { color: #6b6558; text-decoration: none; font-size: 0.76rem; font-weight: 700; padding: 6px 12px; border-radius: 6px; transition: background 0.15s; }
  .navbar a:hover { background: #eeece2; color: #1a1a16; }
  .wrap { max-width: 1320px; margin: 0 auto; padding: 40px 36px 100px; }
  h1 { font-size: 1.6rem; margin: 0 0 6px; letter-spacing: -0.4px; font-weight: 700; }
  .sub { color: #8a8272; font-size: 0.82rem; margin-bottom: 32px; line-height: 1.5; }
  .upload-box { background: #fff; border: 1.5px dashed #d8d2c0; border-radius: 12px; padding: 40px 24px; text-align: center; margin-bottom: 32px; transition: all 0.15s; }
  .upload-box.drag { border-color: #1a1a16; background: #f9f7f0; transform: scale(1.005); }
  .upload-icon { font-size: 28px; margin-bottom: 12px; opacity: 0.6; }
  .btn { display: inline-block; padding: 10px 20px; border-radius: 7px; font-size: 0.78rem; font-weight: 700; border: 1.5px solid transparent; cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .btn.primary { background: #1a1a16; color: #fff; }
  .btn.primary:hover { opacity: 0.85; transform: translateY(-1px); }
  .btn.outline { background: #fff; border-color: #d8d2c0; color: #1a1a16; }
  .btn.outline:hover { border-color: #1a1a16; }
  .btn:disabled { opacity: 0.4; cursor: default; transform: none; }
  .batch { background: #fff; border: 1px solid #e6e1d4; border-radius: 12px; margin-bottom: 28px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.03); }
  .batch-head { padding: 18px 22px; background: #fbfaf7; border-bottom: 1px solid #e6e1d4; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
  .batch-head b { font-size: 0.86rem; }
  .batch-head .meta { font-size: 0.72rem; color: #9a9488; margin-left: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.76rem; }
  th { text-align: left; padding: 12px 18px; background: #f9f7f0; color: #8a8272; font-weight: 700; border-bottom: 1px solid #e6e1d4; white-space: nowrap; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.4px; }
  td { padding: 14px 18px; border-bottom: 1px solid #f0ede3; vertical-align: top; line-height: 1.5; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fbfaf7; }
  td.wrap-cell { max-width: 320px; white-space: pre-wrap; }
  .status-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 10px; font-size: 0.68rem; font-weight: 700; white-space: nowrap; }
  .status-pending { background: #fef3c7; color: #92400e; }
  .status-waiting { background: #e0e7ff; color: #3730a3; }
  .status-writing { background: #dbeafe; color: #1e3a8a; }
  .status-ready { background: #dcfce7; color: #166534; }
  .status-sent { background: #f3f4f6; color: #6b7280; }
  .status-replied { background: #d1fae5; color: #065f46; }
  .pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  .live-cursor::after { content: '▍'; animation: blink 0.8s step-end infinite; color: #1e3a8a; }
  @keyframes blink { 50% { opacity: 0; } }
  .chat-box { position: fixed; bottom: 0; right: 28px; width: 360px; max-height: 460px; background: #fff; border: 1px solid #e6e1d4; border-radius: 12px 12px 0 0; box-shadow: 0 -10px 40px rgba(0,0,0,0.12); display: flex; flex-direction: column; }
  .chat-head { padding: 14px 18px; border-bottom: 1px solid #e6e1d4; font-size: 0.8rem; font-weight: 700; background: #fbfaf7; border-radius: 12px 12px 0 0; }
  .chat-msgs { flex: 1; overflow-y: auto; padding: 14px 18px; max-height: 280px; font-size: 0.76rem; }
  .chat-msg { margin-bottom: 14px; line-height: 1.5; }
  .chat-msg b { display: block; font-size: 0.68rem; color: #9a9488; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
  .chat-input-row { display: flex; gap: 8px; padding: 14px; border-top: 1px solid #e6e1d4; }
  .chat-input-row input { flex: 1; padding: 9px 11px; border: 1.5px solid #e6e1d4; border-radius: 7px; font-size: 0.76rem; font-family: inherit; }
  .chat-input-row input:focus { outline: none; border-color: #1a1a16; }
  .empty { color: #9a9488; font-size: 0.8rem; padding: 40px; text-align: center; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(20,18,12,0.4); display: none; align-items: center; justify-content: center; z-index: 1000; }
  .modal-overlay.open { display: flex; }
  .modal-box { background: #fff; border-radius: 14px; padding: 28px; max-width: 380px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
  .modal-box h3 { margin: 0 0 10px; font-size: 1rem; }
  .modal-box p { margin: 0 0 22px; font-size: 0.8rem; color: #6b6558; line-height: 1.55; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
  .filter-row { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }
  .filter-row #searchInput { flex: 1; min-width: 220px; padding: 10px 14px; border: 1.5px solid #e6e1d4; border-radius: 8px; font-size: 0.78rem; font-family: inherit; background: #fff; }
  .filter-row #searchInput:focus { outline: none; border-color: #1a1a16; }
  .filter-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .filter-tab { padding: 8px 14px; border-radius: 8px; font-size: 0.72rem; font-weight: 700; background: #fff; border: 1.5px solid #e6e1d4; color: #6b6558; cursor: pointer; }
  .filter-tab.active { background: #1a1a16; color: #fff; border-color: #1a1a16; }
  tr.new-reply-row { background: #f0fdf4 !important; }
  tr.new-reply-row td { position: relative; }
  .new-reply-badge { display: inline-flex; align-items: center; gap: 4px; background: #166534; color: #fff; font-size: 0.62rem; font-weight: 700; padding: 2px 7px; border-radius: 8px; margin-left: 6px; animation: newReplyPop 0.4s ease; }
  @keyframes newReplyPop { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }
</style>
</head>
<body>
  <div class="navbar">
    <div>✉️ Email Manager</div>
    <a href="/choose">← Back</a>
  </div>
  <div class="wrap">
    <h1>Outreach Spreadsheet</h1>
    <div class="sub">Real, growing database — new uploads add rows below, nothing here ever gets deleted or overwritten.</div>

    <div class="upload-box" id="uploadBox">
      <div class="upload-icon">📥</div>
      <div style="margin-bottom:14px;font-size:0.84rem;">Drop an Excel file here, or</div>
      <input type="file" id="fileInput" accept=".xlsx,.xls" style="display:none;">
      <button class="btn primary" onclick="document.getElementById('fileInput').click()">Choose Excel file</button>
      <div style="margin-top:12px;font-size:0.68rem;color:#9a9488;">Any real sheet works — email column is found automatically by checking the actual addresses, not the column name.</div>
    </div>

    <div class="filter-row">
      <input id="searchInput" placeholder="🔍 Search by email or subject…" oninput="applyFilters()">
      <div class="filter-tabs" id="filterTabs"></div>
    </div>

    <div id="batchesArea"><div class="empty">Loading real data…</div></div>
  </div>

  <div class="chat-box">
    <div class="chat-head">💬 Mila</div>
    <div class="chat-msgs" id="chatMsgs"></div>
    <div class="chat-input-row">
      <input id="chatInput" placeholder="Ask Mila about this data…" onkeydown="if(event.key==='Enter')sendChat();">
      <button class="btn primary" onclick="sendChat()">Send</button>
    </div>
  </div>

  <div class="modal-overlay" id="modalOverlay">
    <div class="modal-box">
      <h3 id="modalTitle"></h3>
      <p id="modalMsg"></p>
      <div class="modal-actions">
        <button class="btn outline" id="modalCancelBtn">Cancel</button>
        <button class="btn primary" id="modalOkBtn">OK</button>
      </div>
    </div>
  </div>

<script>
const activelyStreaming = {}; // rowId -> true while real tokens are arriving live

function statusFor(r) {
  if (r.repliedAt) return { cls: 'status-replied', label: '✅ Replied' };
  if (r.followupSentConfirmed) return { cls: 'status-sent', label: '📤 Follow-up sent — watching' };
  if (activelyStreaming[r.id]) return { cls: 'status-writing', label: '✍️ Mila is writing…' };
  if (r.followupText) return { cls: 'status-ready', label: '✍️ Follow-up ready' };
  if (r.sentConfirmed) return { cls: 'status-waiting', label: '⏳ Waiting (4-day timer)' };
  return { cls: 'status-pending', label: '❓ Confirm sent?' };
}

// ── Custom modal — replaces the native browser confirm() popup with
// something that actually matches the app, on every browser.
function customConfirm(title, message) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMsg').textContent = message;
    overlay.classList.add('open');
    const okBtn = document.getElementById('modalOkBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const cleanup = (result) => { overlay.classList.remove('open'); okBtn.onclick = null; cancelBtn.onclick = null; resolve(result); };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
  });
}

let allRowsCache = [];
let activeFilterTab = 'all';
const LAST_VIEWED_REPLIES_KEY = 'email_manager_last_viewed_replies';

function isNewReply(r) {
  if (!r.repliedAt) return false;
  const lastViewed = localStorage.getItem(LAST_VIEWED_REPLIES_KEY);
  return !lastViewed || new Date(r.repliedAt) > new Date(lastViewed);
}

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Confirm sent?' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'ready', label: 'Ready' },
  { id: 'sent', label: 'Sent' },
  { id: 'replied', label: 'Replied' }
];
function rowMatchesTab(r, tab) {
  if (tab === 'all') return true;
  if (tab === 'replied') return !!r.repliedAt;
  if (tab === 'sent') return r.followupSentConfirmed;
  if (tab === 'ready') return r.followupText && !r.followupSentConfirmed;
  if (tab === 'waiting') return r.sentConfirmed && !r.followupText;
  if (tab === 'pending') return !r.sentConfirmed;
  return true;
}
function renderFilterTabs() {
  const el = document.getElementById('filterTabs');
  if (!el) return;
  el.innerHTML = FILTER_TABS.map(t => {
    const count = allRowsCache.filter(r => rowMatchesTab(r, t.id)).length;
    return '<div class="filter-tab' + (activeFilterTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '" onclick="setFilterTab(this.dataset.tab)">' + t.label + ' (' + count + ')</div>';
  }).join('');
}
function setFilterTab(tab) { activeFilterTab = tab; renderFilterTabs(); applyFilters(); }
function applyFilters() {
  const search = (document.getElementById('searchInput').value || '').toLowerCase().trim();
  const filtered = allRowsCache.filter(r => {
    if (!rowMatchesTab(r, activeFilterTab)) return false;
    if (!search) return true;
    return (r.email || '').toLowerCase().includes(search) || (r.subject || '').toLowerCase().includes(search) || (r.followupSubject || '').toLowerCase().includes(search);
  });
  renderBatches(filtered);
}

async function loadRows() {
  try {
    const res = await fetch('/office/api/email-manager/rows', { credentials: 'include' });
    if (!res.ok) { document.getElementById('batchesArea').innerHTML = '<div class="empty">Not logged in — refresh the page.</div>'; return; }
    const rows = await res.json();
    allRowsCache = rows;
    renderFilterTabs();
    applyFilters();
  } catch (e) {
    document.getElementById('batchesArea').innerHTML = '<div class="empty">Could not load: ' + e.message + '</div>';
  }
}

function renderBatches(rows) {
  const area = document.getElementById('batchesArea');
  if (!allRowsCache.length) { area.innerHTML = '<div class="empty">Nothing uploaded yet.</div>'; return; }
  if (!rows.length) { area.innerHTML = '<div class="empty">No rows match your search/filter.</div>'; return; }
  const batchIds = [...new Set(rows.map(r => r.batchId))];
  area.innerHTML = batchIds.map(bid => {
    const batchRows = rows.filter(r => r.batchId === bid);
    const allBatchRows = allRowsCache.filter(r => r.batchId === bid); // use unfiltered set for batch-level action logic
    const allSentConfirmed = allBatchRows.every(r => r.sentConfirmed);
    const allFollowupsReady = allBatchRows.every(r => r.followupText);
    const allFollowupsSent = allBatchRows.every(r => r.followupSentConfirmed || !r.followupText);
    let actionHtml = '';
    if (!allSentConfirmed) {
      actionHtml = '<button class="btn primary" data-batch="' + bid + '" onclick="confirmSent(this.dataset.batch)">Are all these sent? — Confirm</button>';
    } else if (allFollowupsReady && !allFollowupsSent) {
      actionHtml = '<button class="btn primary" data-batch="' + bid + '" onclick="downloadBatch(this.dataset.batch)">⬇ Download follow-ups Excel</button> <button class="btn outline" data-batch="' + bid + '" onclick="confirmFollowupSent(this.dataset.batch)">Mark follow-ups sent</button>';
    } else if (!allFollowupsReady) {
      const dueDates = allBatchRows.filter(r => r.followupDueAt && !r.followupText).map(r => new Date(r.followupDueAt));
      const earliestDue = dueDates.length ? new Date(Math.min(...dueDates)) : null;
      const dueLabel = earliestDue ? earliestDue.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      actionHtml = '<span style="font-size:0.72rem;color:#9a9488;">' + (dueLabel ? 'Real 4-day timer — next one writes ' + dueLabel + ' PT' : 'Waiting on the 4-day timer') + '</span> <button class="btn outline" data-batch="' + bid + '" onclick="generateNow(this.dataset.batch)" style="margin-left:8px;">✍️ Write now instead (skip the wait)</button>';
    }
    return '<div class="batch"><div class="batch-head"><div><b>Batch — ' + batchRows.length + ' email' + (batchRows.length===1?'':'s') + '</b> <span class="meta">uploaded ' + new Date(batchRows[0].uploadedAt).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric'}) + '</span></div><div>' + actionHtml + '</div></div>' +
      '<table><thead><tr><th>Email</th><th>Subject</th><th>Original email</th><th>Status</th><th>Follow-up subject</th><th>Follow-up</th></tr></thead><tbody>' +
      batchRows.map(r => {
        const st = statusFor(r);
        const statusIcon = activelyStreaming[r.id] ? '<span class="pulse-dot"></span>' : '';
        const newReply = isNewReply(r);
        let waitingLabel = 'waiting for its turn…';
        if (r.followupDueAt && !r.followupText) {
          const due = new Date(r.followupDueAt);
          waitingLabel = due.getTime() <= Date.now() ? 'due now — writing shortly…' : ('writes ' + due.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT');
        }
        const cellContent = activelyStreaming[r.id] ? (r._liveText || '') : (r.followupText ? escapeHtmlJs(r.followupText) : (r.sentConfirmed ? '<span style="color:#9a9488;">' + waitingLabel + '</span>' : '—'));
        return '<tr class="' + (newReply ? 'new-reply-row' : '') + '"><td>' + escapeHtmlJs(r.email) + '</td><td class="wrap-cell">' + escapeHtmlJs(r.subject) + '</td><td class="wrap-cell orig-cell">' + originalEmailCell(r) + '</td><td><span class="status-pill ' + st.cls + '">' + statusIcon + st.label + '</span>' + (newReply ? '<span class="new-reply-badge">✨ NEW</span>' : '') + '</td><td class="wrap-cell">' + escapeHtmlJs(r.followupSubject || '') + '</td><td class="wrap-cell' + (activelyStreaming[r.id] ? ' live-cursor' : '') + '" id="fu-' + r.id + '">' + cellContent + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }).join('');
}

async function generateNow(batchId) {
  const ok = await customConfirm('Skip the wait?', 'This writes real follow-ups right now instead of waiting for the real 4-day timer. Real AI, real cost — just earlier than usual.');
  if (!ok) return;
  await fetch('/office/api/email-manager/generate-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ batchId }) });
}

// ── Real live streaming — connects once, stays open, shows real tokens
// the instant the server actually generates them (not a fake animation).
function connectLiveStream() {
  const es = new EventSource('/office/api/email-manager/stream');
  es.addEventListener('writing-start', (e) => {
    const { rowId } = JSON.parse(e.data);
    activelyStreaming[rowId] = true;
    const el = document.getElementById('fu-' + rowId);
    if (el) { el.textContent = ''; el.classList.add('live-cursor'); }
    loadRows();
  });
  es.addEventListener('chunk', (e) => {
    const { rowId, delta } = JSON.parse(e.data);
    const el = document.getElementById('fu-' + rowId);
    if (el) el.textContent += delta; // real text, arriving in real time, appended live
  });
  es.addEventListener('writing-done', (e) => {
    const { rowId } = JSON.parse(e.data);
    delete activelyStreaming[rowId];
    loadRows();
  });
  es.addEventListener('writing-error', (e) => {
    const { rowId } = JSON.parse(e.data);
    delete activelyStreaming[rowId];
    loadRows();
  });
  es.onerror = () => { setTimeout(connectLiveStream, 4000); };
}

function originalEmailCell(r) {
  const full = r.body || '';
  if (!full) return '<span style="color:#c4bfae;">—</span>';
  if (full.length <= 140) return escapeHtmlJs(full);
  const preview = escapeHtmlJs(full.slice(0, 140)) + '…';
  return '<span class="orig-preview">' + preview + '</span>' +
    '<span class="orig-full" style="display:none;">' + escapeHtmlJs(full) + '</span>' +
    ' <a href="#" onclick="event.preventDefault();toggleOriginal(this)" style="font-size:0.68rem;color:#6b6558;text-decoration:underline;">show full</a>';
}
function toggleOriginal(link) {
  const cell = link.closest('td');
  const preview = cell.querySelector('.orig-preview');
  const full = cell.querySelector('.orig-full');
  const showingFull = full.style.display !== 'none';
  full.style.display = showingFull ? 'none' : 'inline';
  preview.style.display = showingFull ? 'inline' : 'none';
  link.textContent = showingFull ? 'show full' : 'show less';
}
function escapeHtmlJs(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

document.getElementById('fileInput').addEventListener('change', e => handleFile(e.target.files[0]));
const uploadBox = document.getElementById('uploadBox');
uploadBox.addEventListener('dragover', e => { e.preventDefault(); uploadBox.classList.add('drag'); });
uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('drag'));
uploadBox.addEventListener('drop', e => { e.preventDefault(); uploadBox.classList.remove('drag'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function findHeaderRowAndData(sheet) {
  // Real spreadsheets often have a title row, a description row, then the
  // real headers — not always row 1. Scan the first 10 rows for the one
  // most likely to be real column headers (short text cells, several of
  // them, at least one mentioning "email").
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  let headerRowIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const row = raw[i];
    const nonEmpty = row.filter(c => String(c).trim() !== '');
    if (nonEmpty.length < 2) continue;
    const hasEmailish = nonEmpty.some(c => /email/i.test(String(c)));
    const avgLen = nonEmpty.reduce((s, c) => s + String(c).length, 0) / nonEmpty.length;
    const score = nonEmpty.length + (hasEmailish ? 10 : 0) - (avgLen > 60 ? 20 : 0);
    if (score > bestScore) { bestScore = score; headerRowIdx = i; }
  }
  const headers = raw[headerRowIdx].map(h => String(h || '').trim());
  const dataRows = raw.slice(headerRowIdx + 1).filter(r => r.some(c => String(c).trim() !== ''));
  return { headers, dataRows };
}

function classifyColumns(headers, dataRows) {
  const lower = headers.map(h => h.toLowerCase());
  // Find the REAL email column by checking actual values, not just the
  // header name — real sheets often have several columns with "email"
  // in the name (the address, the outreach email body, the follow-up
  // email body). Only one of them actually contains real addresses.
  let emailIdx = -1, bestEmailScore = 0;
  headers.forEach((h, i) => {
    const sample = dataRows.slice(0, 8).map(r => String(r[i] || '').trim()).filter(Boolean);
    if (!sample.length) return;
    const matchCount = sample.filter(v => EMAIL_RE.test(v)).length;
    const score = matchCount / sample.length;
    if (score > bestEmailScore) { bestEmailScore = score; emailIdx = i; }
  });

  const findIdx = (mustInclude, mustExclude) => {
    for (let i = 0; i < lower.length; i++) {
      if (i === emailIdx) continue;
      if (mustInclude.some(k => lower[i].includes(k)) && !mustExclude.some(k => lower[i].includes(k))) return i;
    }
    return -1;
  };
  return {
    emailIdx,
    subjectIdx: findIdx(['subject'], ['follow']),
    bodyIdx: findIdx(['email', 'outreach', 'message', 'body'], ['follow']),
    followupSubjectIdx: findIdx(['follow'], []) !== -1 && lower.some((h,i)=>h.includes('follow')&&h.includes('subject')) ? lower.findIndex(h=>h.includes('follow')&&h.includes('subject')) : -1,
    followupBodyIdx: lower.findIndex(h => h.includes('follow') && (h.includes('email') || h.includes('body') || h.includes('message')))
  };
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const wb = XLSX.read(e.target.result, { type: 'array' });
    let rows = [];
    let usedSheet = null;
    // Try every sheet, keep the one with the most real, usable rows —
    // a file can have several sheets that technically contain an email
    // address somewhere; the right one is the most complete.
    for (const sheetName of wb.SheetNames) {
      const { headers, dataRows } = findHeaderRowAndData(wb.Sheets[sheetName]);
      if (!headers.length || !dataRows.length) continue;
      const cols = classifyColumns(headers, dataRows);
      if (cols.emailIdx === -1) continue;
      const candidateRows = dataRows.map(r => ({
        email: String(r[cols.emailIdx] || '').trim(),
        subject: cols.subjectIdx !== -1 ? String(r[cols.subjectIdx] || '').trim() : '',
        body: cols.bodyIdx !== -1 ? String(r[cols.bodyIdx] || '').trim() : '',
        followupSubject: cols.followupSubjectIdx !== -1 ? String(r[cols.followupSubjectIdx] || '').trim() : '',
        followupBody: cols.followupBodyIdx !== -1 ? String(r[cols.followupBodyIdx] || '').trim() : ''
      })).filter(r => EMAIL_RE.test(r.email));
      if (candidateRows.length > rows.length) { rows = candidateRows; usedSheet = sheetName; }
    }
    if (!rows.length) { alert('Could not find a column with real email addresses in any sheet. Check the file has at least one column of actual email addresses.'); return; }
    const res = await fetch('/office/api/email-manager/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ rows })
    });
    if (res.ok) { document.getElementById('fileInput').value = ''; loadRows(); }
    else alert('Upload failed.');
  };
  reader.readAsArrayBuffer(file);
}

async function confirmSent(batchId) {
  const ok = await customConfirm('Confirm sent?', 'Confirm all emails in this batch were really sent? This starts the real 4-day follow-up timer.');
  if (!ok) return;
  await fetch('/office/api/email-manager/confirm-sent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ batchId }) });
  loadRows();
}
async function confirmFollowupSent(batchId) {
  const ok = await customConfirm('Confirm sent?', 'Confirm all these follow-ups were really sent?');
  if (!ok) return;
  await fetch('/office/api/email-manager/confirm-followup-sent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ batchId }) });
  loadRows();
}
function downloadBatch(batchId) {
  window.location.href = '/office/api/email-manager/download/' + encodeURIComponent(batchId);
  setTimeout(async () => { if (await customConfirm('Downloaded', 'Confirm these follow-ups are sent now?')) confirmFollowupSent(batchId); }, 1500);
}

async function loadChat() {
  try {
    const res = await fetch('/office/api/email-manager/chat', { credentials: 'include' });
    if (!res.ok) return;
    const chat = await res.json();
    const el = document.getElementById('chatMsgs');
    el.innerHTML = chat.map(m => '<div class="chat-msg"><b>' + (m.from === 'owner' ? 'You' : 'Mila') + '</b>' + escapeHtmlJs(m.text) + '</div>').join('') || '<div style="color:#9a9488;">No messages yet.</div>';
    el.scrollTop = el.scrollHeight;
  } catch (e) {}
}
async function sendChat() {
  const input = document.getElementById('chatInput');
  if (!input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';
  await fetch('/office/api/email-manager/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ text }) });
  loadChat();
}

loadRows();
loadChat();
connectLiveStream();
setInterval(loadRows, 8000);
setInterval(loadChat, 15000);
// Give the owner a few real seconds to actually see the "new reply"
// highlights before marking them seen for next time.
setTimeout(() => { localStorage.setItem(LAST_VIEWED_REPLIES_KEY, new Date().toISOString()); }, 6000);
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Manet Creative server running on port ${PORT}`);
  console.log(`📞 Phone: ${process.env.TWILIO_PHONE_NUMBER || 'Not configured'}`);
  console.log(`🌐 Admin: http://localhost:${PORT}/admin`);
  console.log(`📱 Messages: http://localhost:${PORT}/messages`);
  console.log(`📅 Appointments: http://localhost:${PORT}/appointments-admin`);
});