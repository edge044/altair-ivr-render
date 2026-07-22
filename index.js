const express = require('express');
const fs = require('fs');
const path = require('path');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const basicAuth = require('basic-auth');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ======================================================
// AUTHENTICATION
// ======================================================

function requireAuth(req, res, next) {
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
  res.send(`
    <html>
      <head>
        <title>Manet Creative</title>
        <style>
          body {
            font-family: Georgia, serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #f7f3ed;
            margin: 0;
            color: #161616;
          }
          .box {
            text-align: center;
            background: #fff;
            border: 1px solid #e2dcd3;
            padding: 54px;
            max-width: 420px;
            width: 90%;
          }
          h1 {
            font-size: 2rem;
            font-weight: normal;
            margin-bottom: 8px;
          }
          p {
            color: #77716a;
            margin-bottom: 26px;
          }
          a {
            display: inline-block;
            background: #161616;
            color: white;
            padding: 12px 22px;
            text-decoration: none;
            font-size: 0.95rem;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>Manet Creative</h1>
          <p>Phone system is running.</p>
          <div class="cta-row">
            <a href="/admin" class="cta phone">
              <span class="cta-icon">📞</span>
              <span class="cta-label">Phone System</span>
              <span class="cta-sub">Calls, messages, appointments</span>
            </a>
            <a href="/office" class="cta office">
              <span class="cta-icon">🏢</span>
              <span class="cta-label">Our Office</span>
              <span class="cta-sub">Team, projects, budget</span>
            </a>
          </div>
          <style>
            .cta-row { display: flex; gap: 16px; justify-content: center; margin-top: 6px; }
            .cta {
              display: flex; flex-direction: column; align-items: center; gap: 4px;
              padding: 22px 28px; min-width: 150px; background: #fff; border: 1px solid #e2dcd3;
              border-radius: 10px; text-decoration: none; color: #161616;
              transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
            }
            .cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.08); border-color: #161616; }
            .cta-icon { font-size: 26px; }
            .cta-label { font-size: 0.95rem; font-weight: 600; }
            .cta-sub { font-size: 0.72rem; color: #9a9488; }
          </style>
        </div>
      </body>
    </html>
  `);
});

// ======================================================
// START SERVER
// ======================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Manet Creative server running on port ${PORT}`);
  console.log(`📞 Phone: ${process.env.TWILIO_PHONE_NUMBER || 'Not configured'}`);
  console.log(`🌐 Admin: http://localhost:${PORT}/admin`);
  console.log(`📱 Messages: http://localhost:${PORT}/messages`);
  console.log(`📅 Appointments: http://localhost:${PORT}/appointments-admin`);
});