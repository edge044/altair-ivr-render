const express = require('express');
const fs = require('fs');
const path = require('path');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const { OpenAI } = require('openai');
const basicAuth = require('basic-auth');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ======================================================
// SECURITY: PASSWORD PROTECTION FOR ALL DASHBOARDS
// ======================================================

function requireAuth(req, res, next) {
  const AUTH_USERNAME = process.env.ARCHIVE_USERNAME || 'altair_admin';
  const AUTH_PASSWORD = process.env.ARCHIVE_PASSWORD || 'AltairSecure2024!@#$';
  
  const user = basicAuth(req);
  
  if (!user || user.name !== AUTH_USERNAME || user.pass !== AUTH_PASSWORD) {
    console.log(`🔒 Unauthorized access attempt from IP: ${req.ip} - User: ${user ? user.name : 'none'}`);
    
    res.set('WWW-Authenticate', 'Basic realm="Altair Partners - Secure Dashboard Access"');
    return res.status(401).send(`
      <html>
        <head>
          <title>🔒 401 - Secure Dashboard Access</title>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
              padding: 40px; 
              text-align: center;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .auth-box {
              background: white;
              padding: 40px;
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 500px;
              width: 100%;
            }
            .lock-icon {
              font-size: 4rem;
              color: #4f46e5;
              margin-bottom: 20px;
            }
            h1 { 
              color: #1e293b; 
              margin-bottom: 10px;
              font-size: 2rem;
            }
            .subtitle {
              color: #64748b;
              margin-bottom: 30px;
              font-size: 1.1rem;
            }
            .credentials {
              background: #f8fafc;
              padding: 20px;
              border-radius: 10px;
              margin: 20px 0;
              text-align: left;
            }
            .cred-item {
              display: flex;
              justify-content: space-between;
              padding: 10px 0;
              border-bottom: 1px solid #e2e8f0;
            }
            .cred-item:last-child {
              border-bottom: none;
            }
            .label {
              color: #475569;
              font-weight: 600;
            }
            .value {
              font-family: 'SF Mono', Monaco, monospace;
              background: #f1f5f9;
              padding: 4px 12px;
              border-radius: 6px;
              color: #1e293b;
            }
            .warning {
              background: #fef3c7;
              border: 2px solid #f59e0b;
              padding: 15px;
              border-radius: 10px;
              margin: 20px 0;
              color: #92400e;
              font-size: 0.9rem;
            }
            .note {
              color: #64748b;
              font-size: 0.9rem;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="auth-box">
            <div class="lock-icon">🔒</div>
            <h1>Secure Dashboard Access</h1>
            <p class="subtitle">All dashboards are password protected for security</p>
            
            <div class="warning">
              ⚠️ <strong>SECURITY NOTICE:</strong> Change default credentials in .env file!
              Unauthorized access is strictly prohibited.
            </div>
            
            <p class="note">Access restricted to Altair Partners authorized personnel only.</p>
            <p class="note">Contact system administrator for credentials.</p>
          </div>
        </body>
      </html>
    `);
  }
  
  console.log(`🔓 Authorized dashboard access from ${req.ip} - User: ${user.name}`);
  next();
}

// ======================================================
// ЕДИНЫЙ SECURE DASHBOARD (ВСЕ В ОДНОМ ОКНЕ)
// ======================================================

app.get('/dashboard', requireAuth, (req, res) => {
  const dashboardHTML = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>📊 Altair Partners - Secure Dashboard</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
          * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
              font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
          }

          body {
              background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
              min-height: 100vh;
              padding: 20px;
              color: white;
          }

          .container {
              max-width: 1400px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.5);
              overflow: hidden;
              color: #333;
          }

          .header {
              background: linear-gradient(to right, #4f46e5, #7c3aed);
              color: white;
              padding: 30px 40px;
              border-bottom: 1px solid rgba(255,255,255,0.1);
          }

          .header h1 {
              font-size: 2.5rem;
              margin-bottom: 10px;
              display: flex;
              align-items: center;
              gap: 15px;
          }

          .security-banner {
              background: #fee2e2;
              color: #991b1b;
              padding: 15px;
              border-radius: 10px;
              margin: 20px 0;
              border: 2px solid #ef4444;
              text-align: center;
              font-weight: 600;
          }

          .dashboard-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
              gap: 25px;
              padding: 30px;
          }

          .dashboard-card {
              background: white;
              padding: 30px;
              border-radius: 15px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.1);
              transition: all 0.3s ease;
              border: 2px solid #e2e8f0;
              text-align: center;
          }

          .dashboard-card:hover {
              transform: translateY(-10px);
              box-shadow: 0 20px 40px rgba(0,0,0,0.2);
          }

          .card-icon {
              font-size: 3.5rem;
              margin-bottom: 20px;
              height: 80px;
              display: flex;
              align-items: center;
              justify-content: center;
          }

          .card-title {
              font-size: 1.8rem;
              font-weight: 700;
              margin-bottom: 15px;
              color: #1e293b;
          }

          .card-description {
              color: #64748b;
              margin-bottom: 25px;
              line-height: 1.6;
          }

          .card-btn {
              display: inline-block;
              padding: 12px 30px;
              background: linear-gradient(to right, #4f46e5, #7c3aed);
              color: white;
              text-decoration: none;
              border-radius: 10px;
              font-weight: 600;
              font-size: 1.1rem;
              transition: all 0.3s ease;
              border: none;
              cursor: pointer;
              width: 100%;
          }

          .card-btn:hover {
              background: linear-gradient(to right, #4338ca, #6d28d9);
              transform: translateY(-2px);
              box-shadow: 0 5px 15px rgba(79, 70, 229, 0.4);
          }

          .system-status {
              background: #f8fafc;
              padding: 25px;
              border-radius: 15px;
              margin: 30px;
              border-left: 5px solid #10b981;
          }

          .status-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 15px;
              margin-top: 15px;
          }

          .status-item {
              background: white;
              padding: 15px;
              border-radius: 10px;
              text-align: center;
              border: 1px solid #e2e8f0;
          }

          .status-label {
              color: #64748b;
              font-size: 0.9rem;
              margin-bottom: 5px;
          }

          .status-value {
              color: #1e293b;
              font-size: 1.3rem;
              font-weight: 700;
          }

          .active {
              color: #10b981;
          }

          .inactive {
              color: #ef4444;
          }

          .logout-btn {
              display: block;
              width: 200px;
              margin: 30px auto;
              padding: 12px;
              background: #64748b;
              color: white;
              text-align: center;
              border-radius: 10px;
              text-decoration: none;
              font-weight: 600;
              transition: all 0.3s ease;
          }

          .logout-btn:hover {
              background: #475569;
          }

          .iframe-container {
              display: none;
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: rgba(0,0,0,0.9);
              z-index: 1000;
              padding: 20px;
          }

          .iframe-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              background: #1e293b;
              color: white;
              padding: 15px 20px;
              border-radius: 10px 10px 0 0;
          }

          .close-btn {
              background: #ef4444;
              color: white;
              border: none;
              padding: 8px 15px;
              border-radius: 5px;
              cursor: pointer;
              font-weight: 600;
          }

          .iframe-content {
              background: white;
              height: calc(100vh - 100px);
              border-radius: 0 0 10px 10px;
              overflow: hidden;
          }

          iframe {
              width: 100%;
              height: 100%;
              border: none;
          }

          @media (max-width: 768px) {
              .dashboard-grid {
                  grid-template-columns: 1fr;
                  padding: 15px;
              }
              
              .header h1 {
                  font-size: 2rem;
              }
              
              .card-title {
                  font-size: 1.5rem;
              }
          }
      </style>
  </head>
  <body>
      <div class="container">
          <!-- Header -->
          <div class="header">
              <h1>
                  <i class="fas fa-shield-alt"></i>
                  Altair Partners - Secure Dashboard
              </h1>
              <p>All systems in one secure location</p>
          </div>

          <!-- Security Banner -->
          <div class="security-banner">
              🔒 SECURE ACCESS | Username: altair_admin | Password: AltairSecure2024!@#$ | Change in .env file
          </div>

          <!-- Dashboard Grid -->
          <div class="dashboard-grid">
              <!-- Analytics Card -->
              <div class="dashboard-card">
                  <div class="card-icon" style="color: #4f46e5;">
                      <i class="fas fa-chart-line"></i>
                  </div>
                  <div class="card-title">📈 Analytics Dashboard</div>
                  <div class="card-description">
                      Real-time call analytics, charts, and statistics. Track conversions, sentiment, and performance.
                  </div>
                  <button class="card-btn" onclick="openDashboard('analytics')">
                      <i class="fas fa-external-link-alt"></i> Open Analytics
                  </button>
              </div>

              <!-- Callbacks Card -->
              <div class="dashboard-card">
                  <div class="card-icon" style="color: #10b981;">
                      <i class="fas fa-phone"></i>
                  </div>
                  <div class="card-title">📞 Callback Requests</div>
                  <div class="card-description">
                      View and manage all callback requests from customers. Mark as completed, call back, or delete.
                  </div>
                  <button class="card-btn" onclick="openDashboard('callbacks')">
                      <i class="fas fa-external-link-alt"></i> View Callbacks
                  </button>
              </div>

              <!-- Voicemails Card -->
              <div class="dashboard-card">
                  <div class="card-icon" style="color: #0d9488;">
                      <i class="fas fa-microphone"></i>
                  </div>
                  <div class="card-title">🎤 Voicemail Dashboard</div>
                  <div class="card-description">
                      Listen to voicemail recordings from customers. Play audio, read transcripts, manage messages.
                  </div>
                  <button class="card-btn" onclick="openDashboard('voicemails')">
                      <i class="fas fa-external-link-alt"></i> View Voicemails
                  </button>
              </div>

              <!-- Archive Card -->
              <div class="dashboard-card">
                  <div class="card-icon" style="color: #8b5cf6;">
                      <i class="fas fa-archive"></i>
                  </div>
                  <div class="card-title">🗂️ Archive Viewer</div>
                  <div class="card-description">
                      Browse all call logs, appointments, and system archives. Search and filter historical data.
                  </div>
                  <button class="card-btn" onclick="openDashboard('archive')">
                      <i class="fas fa-external-link-alt"></i> Open Archive
                  </button>
              </div>

              <!-- Debug Card -->
              <div class="dashboard-card">
                  <div class="card-icon" style="color: #f59e0b;">
                      <i class="fas fa-cogs"></i>
                  </div>
                  <div class="card-title">🔧 System Debug</div>
                  <div class="card-description">
                      Technical dashboard for system monitoring, logs, and debugging. Check server status and errors.
                  </div>
                  <button class="card-btn" onclick="openDashboard('debug')">
                      <i class="fas fa-external-link-alt"></i> Open Debug
                  </button>
              </div>

              <!-- Appointments Card -->
              <div class="dashboard-card">
                  <div class="card-icon" style="color: #ef4444;">
                      <i class="fas fa-calendar-check"></i>
                  </div>
                  <div class="card-title">📅 Appointments</div>
                  <div class="card-description">
                      View all scheduled appointments. See upcoming meetings, dates, times, and client information.
                  </div>
                  <button class="card-btn" onclick="openDashboard('appointments')">
                      <i class="fas fa-external-link-alt"></i> View Appointments
                  </button>
              </div>
          </div>

          <!-- System Status -->
          <div class="system-status">
              <h3 style="color: #1e293b; margin-bottom: 15px;"><i class="fas fa-server"></i> System Status</h3>
              <div class="status-grid" id="systemStatus">
                  <div class="status-item">
                      <div class="status-label">Server</div>
                      <div class="status-value active">ONLINE</div>
                  </div>
                  <div class="status-item">
                      <div class="status-label">IVR System</div>
                      <div class="status-value active">RUNNING</div>
                  </div>
                  <div class="status-item">
                      <div class="status-label">Database</div>
                      <div class="status-value active">ACTIVE</div>
                  </div>
                  <div class="status-item">
                      <div class="status-label">SMS Alerts</div>
                      <div class="status-value active">ENABLED</div>
                  </div>
              </div>
          </div>

          <!-- Logout -->
          <a href="/" class="logout-btn">
              <i class="fas fa-sign-out-alt"></i> Back to Main Page
          </a>
      </div>

      <!-- Dashboard Container (Hidden until clicked) -->
      <div class="iframe-container" id="dashboardContainer">
          <div class="iframe-header">
              <div id="dashboardTitle">Dashboard</div>
              <button class="close-btn" onclick="closeDashboard()">
                  <i class="fas fa-times"></i> Close
              </button>
          </div>
          <div class="iframe-content">
              <iframe id="dashboardFrame" src=""></iframe>
          </div>
      </div>

      <script>
          // Dashboard URLs mapping
          const dashboardUrls = {
              'analytics': '/analytics-dashboard',
              'callbacks': '/callbacks-dashboard',
              'voicemails': '/voicemails-dashboard',
              'archive': '/archive-viewer',
              'debug': '/debug',
              'appointments': '/appointments-viewer'
          };

          const dashboardTitles = {
              'analytics': '📈 Analytics Dashboard',
              'callbacks': '📞 Callback Requests',
              'voicemails': '🎤 Voicemail Dashboard',
              'archive': '🗂️ Archive Viewer',
              'debug': '🔧 System Debug',
              'appointments': '📅 Appointments'
          };

          function openDashboard(type) {
              const url = dashboardUrls[type];
              const title = dashboardTitles[type];
              
              if (!url) {
                  alert('Dashboard not available');
                  return;
              }

              document.getElementById('dashboardTitle').textContent = title;
              document.getElementById('dashboardFrame').src = url;
              document.getElementById('dashboardContainer').style.display = 'block';
              document.body.style.overflow = 'hidden';
          }

          function closeDashboard() {
              document.getElementById('dashboardContainer').style.display = 'none';
              document.getElementById('dashboardFrame').src = '';
              document.body.style.overflow = 'auto';
          }

          // Close with ESC key
          document.addEventListener('keydown', function(event) {
              if (event.key === 'Escape') {
                  closeDashboard();
              }
          });

          // Check system status on load
          window.addEventListener('load', function() {
              fetch('/health')
                  .then(response => {
                      if (!response.ok) {
                          document.querySelectorAll('.status-value')[0].textContent = 'OFFLINE';
                          document.querySelectorAll('.status-value')[0].className = 'status-value inactive';
                      }
                  })
                  .catch(error => {
                      document.querySelectorAll('.status-value')[0].textContent = 'OFFLINE';
                      document.querySelectorAll('.status-value')[0].className = 'status-value inactive';
                  });
          });
      </script>
  </body>
  </html>
  `;
  
  res.send(dashboardHTML);
});

// ======================================================
// ARCHIVE VIEWER (РАБОТАЮЩИЙ)
// ======================================================

app.get('/archive-viewer', requireAuth, (req, res) => {
  const archiveHTML = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🗂️ Archive Viewer - Altair Partners</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
          * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
              font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
          }

          body {
              background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%);
              min-height: 100vh;
              padding: 20px;
              color: white;
          }

          .container {
              max-width: 1400px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.5);
              overflow: hidden;
              color: #333;
          }

          .header {
              background: linear-gradient(to right, #8b5cf6, #a78bfa);
              color: white;
              padding: 30px 40px;
              border-bottom: 1px solid rgba(255,255,255,0.1);
          }

          .header h1 {
              font-size: 2.5rem;
              margin-bottom: 10px;
              display: flex;
              align-items: center;
              gap: 15px;
          }

          .back-btn {
              position: absolute;
              top: 30px;
              right: 40px;
              padding: 10px 20px;
              background: white;
              color: #8b5cf6;
              border-radius: 10px;
              text-decoration: none;
              font-weight: 600;
              transition: all 0.3s ease;
          }

          .back-btn:hover {
              background: #f8fafc;
              transform: translateY(-2px);
          }

          .archive-tabs {
              display: flex;
              background: #f1f5f9;
              padding: 0;
              border-bottom: 1px solid #e2e8f0;
              flex-wrap: wrap;
          }

          .tab {
              padding: 15px 30px;
              background: transparent;
              border: none;
              font-size: 1rem;
              font-weight: 600;
              color: #64748b;
              cursor: pointer;
              transition: all 0.3s ease;
              border-bottom: 3px solid transparent;
          }

          .tab:hover {
              background: #e2e8f0;
              color: #475569;
          }

          .tab.active {
              background: white;
              color: #8b5cf6;
              border-bottom: 3px solid #8b5cf6;
          }

          .content-area {
              padding: 30px;
              min-height: 500px;
          }

          .loading {
              text-align: center;
              padding: 60px;
              color: #64748b;
              font-size: 1.2rem;
          }

          .loader {
              width: 50px;
              height: 50px;
              border: 4px solid #e2e8f0;
              border-top: 4px solid #8b5cf6;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin: 0 auto 20px;
          }

          @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
          }

          .data-table {
              width: 100%;
              border-collapse: collapse;
              background: white;
              border-radius: 10px;
              overflow: hidden;
              box-shadow: 0 5px 20px rgba(0,0,0,0.1);
          }

          .data-table th {
              background: #8b5cf6;
              color: white;
              padding: 15px;
              text-align: left;
              font-weight: 600;
          }

          .data-table td {
              padding: 12px 15px;
              border-bottom: 1px solid #e2e8f0;
          }

          .data-table tr:hover {
              background: #f8fafc;
          }

          .no-data {
              text-align: center;
              padding: 60px;
              color: #64748b;
              font-size: 1.2rem;
          }

          .date-picker {
              padding: 10px 15px;
              border: 2px solid #cbd5e1;
              border-radius: 10px;
              margin: 0 10px;
              font-size: 1rem;
          }

          .search-box {
              padding: 10px 15px;
              border: 2px solid #cbd5e1;
              border-radius: 10px;
              font-size: 1rem;
              min-width: 300px;
              margin: 0 10px;
          }

          .controls {
              padding: 20px;
              background: white;
              border-bottom: 1px solid #e2e8f0;
              display: flex;
              gap: 10px;
              align-items: center;
              flex-wrap: wrap;
          }

          .action-btn {
              padding: 10px 20px;
              background: #8b5cf6;
              color: white;
              border: none;
              border-radius: 10px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 8px;
              transition: all 0.3s ease;
          }

          .action-btn:hover {
              background: #7c3aed;
              transform: translateY(-2px);
          }

          @media (max-width: 768px) {
              .header h1 {
                  font-size: 2rem;
              }
              
              .archive-tabs {
                  flex-direction: column;
              }
              
              .tab {
                  width: 100%;
                  text-align: left;
              }
              
              .search-box {
                  min-width: 200px;
              }
          }
      </style>
  </head>
  <body>
      <div class="container">
          <!-- Header -->
          <div class="header">
              <h1>
                  <i class="fas fa-archive"></i>
                  Archive Viewer
              </h1>
              <p>Browse all call logs, appointments, and system archives</p>
              <a href="/dashboard" class="back-btn">
                  <i class="fas fa-arrow-left"></i> Back to Dashboard
              </a>
          </div>

          <!-- Tabs -->
          <div class="archive-tabs">
              <button class="tab active" onclick="loadArchive('calls')">
                  <i class="fas fa-phone"></i> Call Logs
              </button>
              <button class="tab" onclick="loadArchive('appointments')">
                  <i class="fas fa-calendar"></i> Appointments
              </button>
              <button class="tab" onclick="loadArchive('ai')">
                  <i class="fas fa-robot"></i> AI Conversations
              </button>
              <button class="tab" onclick="loadArchive('reminders')">
                  <i class="fas fa-bell"></i> Reminders
              </button>
          </div>

          <!-- Controls -->
          <div class="controls">
              <input type="date" class="date-picker" id="datePicker">
              <input type="text" class="search-box" id="searchBox" placeholder="🔍 Search...">
              <button class="action-btn" onclick="loadCurrentArchive()">
                  <i class="fas fa-sync-alt"></i> Refresh
              </button>
              <button class="action-btn" onclick="exportArchive()">
                  <i class="fas fa-download"></i> Export CSV
              </button>
          </div>

          <!-- Content Area -->
          <div class="content-area" id="contentArea">
              <div class="loading">
                  <div class="loader"></div>
                  Loading archive data...
              </div>
          </div>
      </div>

      <script>
          let currentArchiveType = 'calls';
          let archiveData = [];

          // Load on page load
          document.addEventListener('DOMContentLoaded', () => {
              loadArchive('calls');
          });

          function loadArchive(type) {
              currentArchiveType = type;
              
              // Update tabs
              document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
              event.target.classList.add('active');
              
              // Show loading
              document.getElementById('contentArea').innerHTML = \`
                  <div class="loading">
                      <div class="loader"></div>
                      Loading \${type} archive...
                  </div>
              \`;
              
              // Load data
              fetch(\`/api/archive/\${type}\`)
                  .then(response => response.json())
                  .then(data => {
                      if (data.success) {
                          archiveData = data.data || [];
                          renderArchive(archiveData);
                      } else {
                          throw new Error(data.error || 'Failed to load archive');
                      }
                  })
                  .catch(error => {
                      console.error('Error loading archive:', error);
                      document.getElementById('contentArea').innerHTML = \`
                          <div class="no-data">
                              <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 20px;"></i>
                              <h3>Error Loading Archive</h3>
                              <p>\${error.message}</p>
                          </div>
                      \`;
                  });
          }

          function loadCurrentArchive() {
              loadArchive(currentArchiveType);
          }

          function renderArchive(data) {
              if (!data || data.length === 0) {
                  document.getElementById('contentArea').innerHTML = \`
                      <div class="no-data">
                          <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 20px;"></i>
                          <h3>No Data Found</h3>
                          <p>No \${currentArchiveType} records available</p>
                      </div>
                  \`;
                  return;
              }

              let html = '';
              
              switch(currentArchiveType) {
                  case 'calls':
                      html = renderCallsTable(data);
                      break;
                  case 'appointments':
                      html = renderAppointmentsTable(data);
                      break;
                  case 'ai':
                      html = renderAITable(data);
                      break;
                  case 'reminders':
                      html = renderRemindersTable(data);
                      break;
                  default:
                      html = renderGenericTable(data);
              }
              
              document.getElementById('contentArea').innerHTML = html;
          }

          function renderCallsTable(calls) {
              return \`
                  <table class="data-table">
                      <thead>
                          <tr>
                              <th>Phone</th>
                              <th>Action</th>
                              <th>Time</th>
                              <th>Duration</th>
                              <th>Sentiment</th>
                              <th>Result</th>
                          </tr>
                      </thead>
                      <tbody>
                          \${calls.map(call => \`
                              <tr>
                                  <td>\${call.phone || 'N/A'}</td>
                                  <td>\${call.action || 'N/A'}</td>
                                  <td>\${call.time || 'N/A'}</td>
                                  <td>\${call.duration || 0}s</td>
                                  <td>\${call.sentiment || 'neutral'}</td>
                                  <td>\${call.result || 'N/A'}</td>
                              </tr>
                          \`).join('')}
                      </tbody>
                  </table>
              \`;
          }

          function renderAppointmentsTable(appointments) {
              return \`
                  <table class="data-table">
                      <thead>
                          <tr>
                              <th>Name</th>
                              <th>Phone</th>
                              <th>Business</th>
                              <th>Service</th>
                              <th>Date</th>
                              <th>Time</th>
                              <th>Created</th>
                          </tr>
                      </thead>
                      <tbody>
                          \${appointments.map(apt => \`
                              <tr>
                                  <td>\${apt.name || 'N/A'}</td>
                                  <td>\${apt.phone || 'N/A'}</td>
                                  <td>\${apt.businessType || 'N/A'}</td>
                                  <td>\${apt.serviceType || 'N/A'}</td>
                                  <td>\${apt.date || 'N/A'}</td>
                                  <td>\${apt.time || 'N/A'}</td>
                                  <td>\${apt.timestamp || 'N/A'}</td>
                              </tr>
                          \`).join('')}
                      </tbody>
                  </table>
              \`;
          }

          function renderAITable(conversations) {
              return \`
                  <table class="data-table">
                      <thead>
                          <tr>
                              <th>Phone</th>
                              <th>Question</th>
                              <th>Response</th>
                              <th>Time</th>
                          </tr>
                      </thead>
                      <tbody>
                          \${conversations.map(conv => \`
                              <tr>
                                  <td>\${conv.phone || 'N/A'}</td>
                                  <td>\${conv.question ? (conv.question.length > 50 ? conv.question.substring(0, 50) + '...' : conv.question) : 'N/A'}</td>
                                  <td>\${conv.response ? (conv.response.length > 50 ? conv.response.substring(0, 50) + '...' : conv.response) : 'N/A'}</td>
                                  <td>\${conv.time || 'N/A'}</td>
                              </tr>
                          \`).join('')}
                      </tbody>
                  </table>
              \`;
          }

          function renderRemindersTable(reminders) {
              return \`
                  <table class="data-table">
                      <thead>
                          <tr>
                              <th>Phone</th>
                              <th>Appointment</th>
                              <th>Action</th>
                              <th>Time</th>
                          </tr>
                      </thead>
                      <tbody>
                          \${reminders.map(rem => \`
                              <tr>
                                  <td>\${rem.phone || 'N/A'}</td>
                                  <td>\${rem.appointment ? \`\${rem.appointment.date} at \${rem.appointment.time}\` : 'N/A'}</td>
                                  <td>\${rem.action || 'N/A'}</td>
                                  <td>\${rem.time || 'N/A'}</td>
                              </tr>
                          \`).join('')}
                      </tbody>
                  </table>
              \`;
          }

          function renderGenericTable(data) {
              return \`
                  <table class="data-table">
                      <thead>
                          <tr>
                              \${Object.keys(data[0] || {}).map(key => \`<th>\${key}</th>\`).join('')}
                          </tr>
                      </thead>
                      <tbody>
                          \${data.map(item => \`
                              <tr>
                                  \${Object.values(item).map(val => \`<td>\${val}</td>\`).join('')}
                              </tr>
                          \`).join('')}
                      </tbody>
                  </table>
              \`;
          }

          function exportArchive() {
              if (archiveData.length === 0) {
                  alert('No data to export');
                  return;
              }

              const headers = Object.keys(archiveData[0]);
              const csvContent = [
                  headers.join(','),
                  ...archiveData.map(row => headers.map(header => JSON.stringify(row[header] || '')).join(','))
              ].join('\\n');

              const blob = new Blob([csvContent], { type: 'text/csv' });
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = \`altair-\${currentArchiveType}-\${new Date().toISOString().split('T')[0]}.csv\`;
              a.click();
          }

          // Search functionality
          document.getElementById('searchBox').addEventListener('input', function() {
              const searchTerm = this.value.toLowerCase();
              if (!searchTerm) {
                  renderArchive(archiveData);
                  return;
              }

              const filtered = archiveData.filter(item => {
                  return JSON.stringify(item).toLowerCase().includes(searchTerm);
              });

              renderArchive(filtered);
          });

          // Date filter
          document.getElementById('datePicker').addEventListener('change', function() {
              const selectedDate = this.value;
              if (!selectedDate) {
                  renderArchive(archiveData);
                  return;
              }

              const filtered = archiveData.filter(item => {
                  const itemDate = new Date(item.timestamp || item.time || item.created);
                  return itemDate.toISOString().split('T')[0] === selectedDate;
              });

              renderArchive(filtered);
          });
      </script>
  </body>
  </html>
  `;
  
  res.send(archiveHTML);
});

// ======================================================
// APPOINTMENTS VIEWER
// ======================================================

app.get('/appointments-viewer', requireAuth, (req, res) => {
  const appointmentsHTML = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>📅 Appointments - Altair Partners</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
          * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
              font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
          }

          body {
              background: linear-gradient(135deg, #ef4444 0%, #f97316 100%);
              min-height: 100vh;
              padding: 20px;
              color: white;
          }

          .container {
              max-width: 1400px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.5);
              overflow: hidden;
              color: #333;
          }

          .header {
              background: linear-gradient(to right, #ef4444, #f97316);
              color: white;
              padding: 30px 40px;
              border-bottom: 1px solid rgba(255,255,255,0.1);
          }

          .header h1 {
              font-size: 2.5rem;
              margin-bottom: 10px;
              display: flex;
              align-items: center;
              gap: 15px;
          }

          .back-btn {
              position: absolute;
              top: 30px;
              right: 40px;
              padding: 10px 20px;
              background: white;
              color: #ef4444;
              border-radius: 10px;
              text-decoration: none;
              font-weight: 600;
              transition: all 0.3s ease;
          }

          .back-btn:hover {
              background: #f8fafc;
              transform: translateY(-2px);
          }

          .stats-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
              padding: 30px;
              background: #f8fafc;
          }

          .stat-card {
              background: white;
              padding: 25px;
              border-radius: 15px;
              box-shadow: 0 5px 20px rgba(0,0,0,0.1);
              text-align: center;
              transition: transform 0.3s ease;
              border-left: 5px solid #ef4444;
          }

          .stat-card:hover {
              transform: translateY(-5px);
          }

          .stat-number {
              font-size: 2.5rem;
              font-weight: 800;
              color: #ef4444;
              margin-bottom: 10px;
          }

          .controls {
              padding: 20px 30px;
              background: white;
              border-bottom: 1px solid #e2e8f0;
              display: flex;
              gap: 15px;
              align-items: center;
              flex-wrap: wrap;
          }

          .filter-btn {
              padding: 10px 20px;
              background: #f1f5f9;
              border: 2px solid #cbd5e1;
              border-radius: 10px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.3s ease;
          }

          .filter-btn.active {
              background: #ef4444;
              color: white;
              border-color: #ef4444;
          }

          .search-box {
              flex: 1;
              min-width: 300px;
              padding: 10px 15px;
              border: 2px solid #cbd5e1;
              border-radius: 10px;
              font-size: 1rem;
          }

          .action-btn {
              padding: 10px 20px;
              background: #10b981;
              color: white;
              border: none;
              border-radius: 10px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 8px;
              transition: all 0.3s ease;
          }

          .action-btn:hover {
              background: #059669;
              transform: translateY(-2px);
          }

          .appointments-list {
              padding: 30px;
          }

          .appointment-item {
              background: white;
              margin-bottom: 15px;
              padding: 25px;
              border-radius: 10px;
              border-left: 4px solid #ef4444;
              box-shadow: 0 3px 10px rgba(0,0,0,0.1);
              transition: all 0.3s ease;
          }

          .appointment-item:hover {
              transform: translateX(5px);
              box-shadow: 0 5px 15px rgba(239, 68, 68, 0.2);
          }

          .appointment-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 15px;
          }

          .client-name {
              font-size: 1.3rem;
              font-weight: 700;
              color: #1e293b;
          }

          .phone-number {
              font-family: monospace;
              background: #fee2e2;
              padding: 5px 10px;
              border-radius: 5px;
              font-weight: 600;
              color: #991b1b;
          }

          .appointment-date {
              background: #f0f9ff;
              color: #0369a1;
              padding: 5px 15px;
              border-radius: 20px;
              font-weight: 600;
              display: inline-flex;
              align-items: center;
              gap: 8px;
          }

          .business-info {
              margin: 10px 0;
              padding: 15px;
              background: #f8fafc;
              border-radius: 10px;
          }

          .info-row {
              display: flex;
              margin-bottom: 8px;
          }

          .info-label {
              font-weight: 600;
              color: #475569;
              min-width: 120px;
          }

          .info-value {
              color: #1e293b;
          }

          .actions {
              display: flex;
              gap: 10px;
              margin-top: 20px;
              flex-wrap: wrap;
          }

          .call-btn {
              padding: 8px 15px;
              background: #10b981;
              color: white;
              border: none;
              border-radius: 8px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 5px;
              text-decoration: none;
          }

          .sms-btn {
              padding: 8px 15px;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 8px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 5px;
          }

          .cancel-btn {
              padding: 8px 15px;
              background: #ef4444;
              color: white;
              border: none;
              border-radius: 8px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 5px;
          }

          .loading {
              text-align: center;
              padding: 60px;
              color: #64748b;
              font-size: 1.2rem;
          }

          .loader {
              width: 50px;
              height: 50px;
              border: 4px solid #e2e8f0;
              border-top: 4px solid #ef4444;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin: 0 auto 20px;
          }

          @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
          }

          .no-data {
              text-align: center;
              padding: 60px;
              color: #64748b;
              font-size: 1.2rem;
          }

          @media (max-width: 768px) {
              .header h1 {
                  font-size: 2rem;
              }
              
              .appointment-header {
                  flex-direction: column;
                  align-items: flex-start;
                  gap: 10px;
              }
              
              .search-box {
                  min-width: 200px;
              }
              
              .actions {
                  flex-direction: column;
              }
          }
      </style>
  </head>
  <body>
      <div class="container">
          <!-- Header -->
          <div class="header">
              <h1>
                  <i class="fas fa-calendar-check"></i>
                  Appointments Dashboard
              </h1>
              <p>View and manage all scheduled appointments</p>
              <a href="/dashboard" class="back-btn">
                  <i class="fas fa-arrow-left"></i> Back to Dashboard
              </a>
          </div>

          <!-- Stats -->
          <div class="stats-grid" id="statsGrid">
              <!-- Stats will be loaded here -->
          </div>

          <!-- Controls -->
          <div class="controls">
              <button class="filter-btn active" onclick="filterAppointments('all')">All</button>
              <button class="filter-btn" onclick="filterAppointments('today')">Today</button>
              <button class="filter-btn" onclick="filterAppointments('tomorrow')">Tomorrow</button>
              <button class="filter-btn" onclick="filterAppointments('upcoming')">Upcoming</button>
              
              <input type="text" class="search-box" id="searchBox" placeholder="🔍 Search by name, phone, or business..." oninput="searchAppointments()">
              
              <button class="action-btn" onclick="loadAppointments()">
                  <i class="fas fa-sync-alt"></i> Refresh
              </button>
          </div>

          <!-- Loading -->
          <div class="loading" id="loading">
              <div class="loader"></div>
              Loading appointments...
          </div>

          <!-- Appointments List -->
          <div class="appointments-list" id="appointmentsList">
              <!-- Appointments will be loaded here -->
          </div>

          <!-- No Data -->
          <div class="no-data" id="noData" style="display: none;">
              <i class="fas fa-calendar-times" style="font-size: 3rem; margin-bottom: 20px;"></i>
              <h3>No Appointments Found</h3>
              <p>When appointments are scheduled, they will appear here.</p>
          </div>
      </div>

      <script>
          let allAppointments = [];
          let currentFilter = 'all';
          let searchTerm = '';

          // Load on page load
          document.addEventListener('DOMContentLoaded', () => {
              loadAppointments();
          });

          // Load appointments data
          async function loadAppointments() {
              showLoading();
              
              try {
                  const response = await fetch('/api/appointments');
                  const data = await response.json();
                  
                  if (data.success) {
                      allAppointments = data.appointments || [];
                      updateStats(allAppointments);
                      renderAppointments(allAppointments);
                      hideLoading();
                  } else {
                      throw new Error(data.error || 'Failed to load appointments');
                  }
              } catch (error) {
                  console.error('Error loading appointments:', error);
                  showError('Failed to load appointments');
                  hideLoading();
              }
          }

          // Update statistics
          function updateStats(appointments) {
              const total = appointments.length;
              
              const today = new Date().toISOString().split('T')[0];
              const todayCount = appointments.filter(apt => apt.date === today).length;
              
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const tomorrowStr = tomorrow.toISOString().split('T')[0];
              const tomorrowCount = appointments.filter(apt => apt.date === tomorrowStr).length;
              
              const upcoming = appointments.filter(apt => new Date(apt.date) >= new Date()).length;
              
              document.getElementById('statsGrid').innerHTML = \`
                  <div class="stat-card">
                      <div class="stat-number">\${total}</div>
                      <div>Total Appointments</div>
                  </div>
                  <div class="stat-card">
                      <div class="stat-number">\${todayCount}</div>
                      <div>Today</div>
                  </div>
                  <div class="stat-card">
                      <div class="stat-number">\${tomorrowCount}</div>
                      <div>Tomorrow</div>
                  </div>
                  <div class="stat-card">
                      <div class="stat-number">\${upcoming}</div>
                      <div>Upcoming</div>
                  </div>
              \`;
              
              // Animate numbers
              animateStats();
          }

          // Animate stats numbers
          function animateStats() {
              const statNumbers = document.querySelectorAll('.stat-number');
              statNumbers.forEach(stat => {
                  const target = parseInt(stat.textContent);
                  let current = 0;
                  const increment = target / 20;
                  
                  const timer = setInterval(() => {
                      current += increment;
                      if (current >= target) {
                          current = target;
                          clearInterval(timer);
                      }
                      stat.textContent = Math.floor(current);
                  }, 50);
              });
          }

          // Filter appointments
          function filterAppointments(filter) {
              currentFilter = filter;
              document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
              event.target.classList.add('active');
              renderAppointments(allAppointments);
          }

          // Search appointments
          function searchAppointments() {
              searchTerm = document.getElementById('searchBox').value.toLowerCase();
              renderAppointments(allAppointments);
          }

          // Render appointments
          function renderAppointments(appointments) {
              let filtered = [...appointments];
              
              // Apply filter
              const today = new Date().toISOString().split('T')[0];
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const tomorrowStr = tomorrow.toISOString().split('T')[0];
              
              if (currentFilter === 'today') {
                  filtered = filtered.filter(apt => apt.date === today);
              } else if (currentFilter === 'tomorrow') {
                  filtered = filtered.filter(apt => apt.date === tomorrowStr);
              } else if (currentFilter === 'upcoming') {
                  filtered = filtered.filter(apt => new Date(apt.date) >= new Date());
              }
              
              // Apply search
              if (searchTerm) {
                  filtered = filtered.filter(apt => 
                      (apt.name && apt.name.toLowerCase().includes(searchTerm)) ||
                      (apt.phone && apt.phone.includes(searchTerm)) ||
                      (apt.businessType && apt.businessType.toLowerCase().includes(searchTerm)) ||
                      (apt.serviceType && apt.serviceType.toLowerCase().includes(searchTerm))
                  );
              }
              
              // Sort by date (soonest first)
              filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
              
              const appointmentsList = document.getElementById('appointmentsList');
              
              if (filtered.length === 0) {
                  document.getElementById('noData').style.display = 'block';
                  appointmentsList.innerHTML = '';
                  return;
              }
              
              document.getElementById('noData').style.display = 'none';
              
              let html = '';
              
              filtered.forEach(appointment => {
                  const isToday = appointment.date === today;
                  const isTomorrow = appointment.date === tomorrowStr;
                  
                  html += \`
                      <div class="appointment-item">
                          <div class="appointment-header">
                              <div>
                                  <span class="client-name">\${appointment.name || 'No Name'}</span>
                                  <span class="phone-number" style="margin-left: 10px;">\${appointment.phone || 'No Phone'}</span>
                              </div>
                              <div class="appointment-date">
                                  <i class="fas fa-calendar-alt"></i>
                                  \${appointment.date} at \${appointment.time}
                                  \${isToday ? ' (TODAY)' : isTomorrow ? ' (TOMORROW)' : ''}
                              </div>
                          </div>
                          
                          <div class="business-info">
                              <div class="info-row">
                                  <span class="info-label">Business Type:</span>
                                  <span class="info-value">\${appointment.businessType || 'Not specified'}</span>
                              </div>
                              <div class="info-row">
                                  <span class="info-label">Service Needed:</span>
                                  <span class="info-value">\${appointment.serviceType || 'Not specified'}</span>
                              </div>
                              <div class="info-row">
                                  <span class="info-label">Scheduled:</span>
                                  <span class="info-value">\${appointment.timestamp || 'Unknown'}</span>
                              </div>
                          </div>
                          
                          <div class="actions">
                              <a href="tel:\${appointment.phone}" class="call-btn">
                                  <i class="fas fa-phone"></i> Call Client
                              </a>
                              
                              <button class="sms-btn" onclick="sendSMS('\${appointment.phone}', '\${appointment.name}')">
                                  <i class="fas fa-comment-sms"></i> Send SMS
                              </button>
                              
                              <button class="cancel-btn" onclick="cancelAppointment('\${appointment.phone}')">
                                  <i class="fas fa-times"></i> Cancel
                              </button>
                              
                              <button class="sms-btn" style="background: #8b5cf6;" onclick="sendReminder('\${appointment.phone}')">
                                  <i class="fas fa-bell"></i> Send Reminder
                              </button>
                          </div>
                      </div>
                  \`;
              });
              
              appointmentsList.innerHTML = html;
          }

          // Send SMS to client
          function sendSMS(phone, name) {
              const message = prompt(\`Enter SMS message for \${name} (\${phone}):\`, "Hello from Altair Partners! This is a reminder about your upcoming appointment.");
              
              if (message) {
                  fetch('/api/send-sms', {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ phone, message })
                  })
                  .then(response => response.json())
                  .then(data => {
                      if (data.success) {
                          alert('SMS sent successfully!');
                      } else {
                          alert('Failed to send SMS: ' + data.error);
                      }
                  })
                  .catch(error => {
                      alert('Error sending SMS: ' + error.message);
                  });
              }
          }

          // Cancel appointment
          async function cancelAppointment(phone) {
              if (!confirm('Cancel this appointment?')) return;
              
              try {
                  const response = await fetch(\`/api/appointments/\${phone}\`, {
                      method: 'DELETE'
                  });
                  
                  const data = await response.json();
                  
                  if (data.success) {
                      alert('Appointment cancelled!');
                      loadAppointments(); // Reload the list
                  } else {
                      throw new Error(data.error || 'Failed to cancel appointment');
                  }
              } catch (error) {
                  console.error('Error cancelling appointment:', error);
                  alert('Failed to cancel: ' + error.message);
              }
          }

          // Send reminder
          function sendReminder(phone) {
              if (!confirm('Send reminder call to this client?')) return;
              
              fetch(\`/test-reminder?phone=\${phone}\`, { method: 'POST' })
                  .then(response => response.json())
                  .then(data => {
                      if (data.status === 'test_triggered') {
                          alert('Reminder call initiated!');
                      } else {
                          alert('Failed to send reminder');
                      }
                  })
                  .catch(error => {
                      alert('Error sending reminder: ' + error.message);
                  });
          }

          // Utility functions
          function showLoading() {
              document.getElementById('loading').style.display = 'block';
              document.getElementById('appointmentsList').style.display = 'none';
          }

          function hideLoading() {
              document.getElementById('loading').style.display = 'none';
              document.getElementById('appointmentsList').style.display = 'block';
          }

          function showError(message) {
              alert('Error: ' + message);
          }
      </script>
  </body>
  </html>
  `;
  
  res.send(appointmentsHTML);
});

// ======================================================
// API ENDPOINTS FOR ARCHIVE DATA
// ======================================================

app.get('/api/archive/:type', requireAuth, (req, res) => {
  try {
    const type = req.params.type;
    let data = [];
    
    switch(type) {
      case 'calls':
        // Load call analytics
        if (fs.existsSync(ANALYTICS_PATH)) {
          const analyticsData = fs.readFileSync(ANALYTICS_PATH, "utf8");
          const analytics = JSON.parse(analyticsData || '[]');
          data = analytics.map(a => ({
            phone: a.phone,
            action: a.callResult || 'unknown',
            time: a.timestamp || a.endTime || 'N/A',
            duration: a.totalDuration || 0,
            sentiment: a.sentiment || 'neutral',
            result: a.callResult || 'unknown'
          }));
        }
        break;
        
      case 'appointments':
        // Load appointments
        const db = loadDB();
        data = db.map(apt => ({
          name: apt.name,
          phone: apt.phone,
          businessType: apt.businessType,
          serviceType: apt.serviceType,
          date: apt.date,
          time: apt.time,
          timestamp: apt.timestamp || apt.created
        }));
        break;
        
      case 'ai':
        // Load AI conversations from daily archives
        const today = getTodayDateString();
        const aiFile = `${DAILY_LOGS_DIR}/ai-${today}.json`;
        if (fs.existsSync(aiFile)) {
          const aiData = fs.readFileSync(aiFile, "utf8");
          data = JSON.parse(aiData || '[]');
        }
        break;
        
      case 'reminders':
        // Load reminders from daily archives
        const reminderFile = `${DAILY_LOGS_DIR}/reminders-${today}.json`;
        if (fs.existsSync(reminderFile)) {
          const reminderData = fs.readFileSync(reminderFile, "utf8");
          data = JSON.parse(reminderData || '[]');
        }
        break;
        
      default:
        return res.status(400).json({ success: false, error: "Invalid archive type" });
    }
    
    res.json({
      success: true,
      type,
      count: data.length,
      data: data.reverse() // Newest first
    });
    
  } catch (error) {
    console.error("Error loading archive:", error);
    res.status(500).json({ success: false, error: "Failed to load archive data" });
  }
});

app.get('/api/appointments', requireAuth, (req, res) => {
  try {
    const db = loadDB();
    
    res.json({
      success: true,
      count: db.length,
      appointments: db.reverse() // Newest first
    });
    
  } catch (error) {
    console.error("Error loading appointments:", error);
    res.status(500).json({ success: false, error: "Failed to load appointments" });
  }
});

app.delete('/api/appointments/:phone', requireAuth, (req, res) => {
  try {
    const { phone } = req.params;
    const db = loadDB();
    
    const initialLength = db.length;
    const filteredDB = db.filter(apt => apt.phone !== phone);
    
    if (filteredDB.length === initialLength) {
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }
    
    saveDB(filteredDB);
    
    res.json({ success: true, message: "Appointment cancelled" });
    
  } catch (error) {
    console.error("Error cancelling appointment:", error);
    res.status(500).json({ success: false, error: "Failed to cancel appointment" });
  }
});

app.post('/api/send-sms', requireAuth, async (req, res) => {
  try {
    const { phone, message } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: "Phone and message required" });
    }
    
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });
    
    res.json({ success: true, message: "SMS sent successfully" });
    
  } catch (error) {
    console.error("Error sending SMS:", error);
    res.status(500).json({ success: false, error: "Failed to send SMS" });
  }
});

// ======================================================
// ДОБАВЬ СЮДА ВЕСЬ ТВОЙ СТАРЫЙ КОД ОТСЮДА:
// (Вставь сюда весь твой предыдущий код начиная с ANALYTICS FUNCTIONS)
// ======================================================

// ======================================================
// ANALYTICS FUNCTIONS - УЛУЧШЕННАЯ АНАЛИТИКА!
// ======================================================

// Трекер пути пользователя
const userJourneyTracker = {};

function startUserJourney(phone) {
  userJourneyTracker[phone] = {
    startTime: new Date(),
    path: ['CALL_RECEIVED'],
    optionsSelected: [],
    speechTranscripts: [],
    pagesVisited: [],
    lastActionTime: new Date(),
    totalDuration: 0,
    conversion: false,
    sentiment: 'neutral',
    callQuality: 'good',
    deviceType: 'phone',
    location: 'unknown',
    hangupReason: '',
    frustrationLevel: 0,
    callResult: 'unknown'
  };
}

function trackUserAction(phone, action, details = {}) {
  if (!userJourneyTracker[phone]) {
    startUserJourney(phone);
  }
  
  userJourneyTracker[phone].path.push(action);
  userJourneyTracker[phone].lastActionTime = new Date();
  userJourneyTracker[phone].totalDuration = Math.round((new Date() - userJourneyTracker[phone].startTime) / 1000);
  
  if (details.option) {
    userJourneyTracker[phone].optionsSelected.push(details.option);
  }
  
  if (details.speech) {
    userJourneyTracker[phone].speechTranscripts.push({
      text: details.speech,
      time: new Date().toISOString()
    });
  }
  
  // Определяем настроение по словам
  if (details.speech) {
    const text = details.speech.toLowerCase();
    if (text.includes('спасибо') || text.includes('отлично') || text.includes('хорошо')) {
      userJourneyTracker[phone].sentiment = 'positive';
    } else if (text.includes('проблем') || text.includes('жалоб') || text.includes('плох')) {
      userJourneyTracker[phone].sentiment = 'negative';
      userJourneyTracker[phone].frustrationLevel += 1;
    }
  }
  
  // Отмечаем конверсию
  if (action === 'APPOINTMENT_SCHEDULED') {
    userJourneyTracker[phone].conversion = true;
    userJourneyTracker[phone].callResult = 'appointment_scheduled';
  } else if (action === 'CALLBACK_REQUESTED') {
    userJourneyTracker[phone].callResult = 'callback_requested';
  } else if (action === 'VOICE_MESSAGE_RECORDED') {
    userJourneyTracker[phone].callResult = 'voice_message_recorded';
  }
  
  console.log(`📊 Analytics: ${phone} -> ${action} (duration: ${userJourneyTracker[phone].totalDuration}s)`);
}

function completeUserJourney(phone, reason = 'normal_hangup') {
  if (!userJourneyTracker[phone]) return null;
  
  const journey = userJourneyTracker[phone];
  journey.endTime = new Date();
  journey.totalDuration = Math.round((journey.endTime - journey.startTime) / 1000);
  journey.hangupReason = reason;
  
  if (!journey.callResult) {
    journey.callResult = reason.includes('hangup') ? 'dropped_call' : 'completed_call';
  }
  
  // Сохраняем аналитику СРАЗУ
  saveAnalytics(phone, journey);
  
  // Очищаем трекер
  delete userJourneyTracker[phone];
  
  return journey;
}

// Определяем тип устройства по User-Agent
function detectDevice(req) {
  const agent = req.headers['user-agent'] || '';
  if (agent.includes('Mobile')) return 'mobile';
  if (agent.includes('Tablet')) return 'tablet';
  return 'desktop';
}

// ======================================================
// SELF-PING SYSTEM
// ======================================================
if (process.env.NODE_ENV !== 'production' || process.env.FREE_PLAN === 'true') {
  const PING_INTERVAL = 4 * 60 * 1000;
  
  console.log(`🔄 Self-ping system activated (every ${PING_INTERVAL/60000} minutes)`);
  
  const selfPing = async () => {
    try {
      const response = await fetch('https://altair-ivr-render-1.onrender.com/health');
      if (response.ok) {
        console.log('✅ Self-ping successful - Server kept awake');
      } else {
        console.log('⚠️ Self-ping failed with status:', response.status);
      }
    } catch (error) {
      console.log('❌ Self-ping error:', error.message);
    }
  };
  
  setInterval(selfPing, PING_INTERVAL);
  
  setTimeout(selfPing, 5000);
}

// ======================================================
// WORKING HOURS CHECK FUNCTIONS
// ======================================================

function isWithinBusinessHours() {
  try {
    const now = new Date();
    const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const day = pstTime.getDay();
    const hour = pstTime.getHours();
    const minutes = pstTime.getMinutes();
    const currentTime = hour * 100 + minutes;
    
    const isWeekday = day >= 1 && day <= 5;
    const isWithinHours = currentTime >= 1000 && currentTime <= 1700;
    
    return isWeekday && isWithinHours;
    
  } catch (error) {
    console.error("Error checking business hours:", error);
    return true;
  }
}

function getTimeUntilOpen() {
  try {
    const now = new Date();
    const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const day = pstTime.getDay();
    const hour = pstTime.getHours();
    const minutes = pstTime.getMinutes();
    
    let daysUntilOpen = 0;
    let openingHour = 10;
    
    if (day === 0) {
      daysUntilOpen = 1;
    } else if (day === 6) {
      daysUntilOpen = 2;
    } else if (day >= 1 && day <= 5) {
      if (hour < 10) {
        daysUntilOpen = 0;
      } else if (hour >= 17) {
        if (day === 5) {
          daysUntilOpen = 3;
        } else {
          daysUntilOpen = 1;
        }
      }
    }
    
    let message = "";
    if (daysUntilOpen === 0) {
      const hoursUntilOpen = 10 - hour;
      if (hoursUntilOpen > 0) {
        message = `We open today at ${openingHour} AM Pacific Time`;
      } else {
        message = `We're open now until 5 PM Pacific Time`;
      }
    } else if (daysUntilOpen === 1) {
      message = `We open tomorrow at ${openingHour} AM Pacific Time`;
    } else {
      message = `We open on Monday at ${openingHour} AM Pacific Time`;
    }
    
    return message;
    
  } catch (error) {
    console.error("Error calculating time until open:", error);
    return "We open tomorrow at 10 AM Pacific Time";
  }
}

function getBusinessStatus() {
  const isOpen = isWithinBusinessHours();
  const nextOpenTime = getTimeUntilOpen();
  
  return {
    isOpen,
    nextOpenTime,
    currentTime: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
    hours: "Monday to Friday, 10 AM to 5 PM Pacific Time",
    location: "Portland, Oregon"
  };
}

// ======================================================
// JSON DATABASE & LOGGING
// ======================================================

const LOGS_DIR = "./logs";
const CURRENT_LOGS_DIR = `${LOGS_DIR}/current`;
const DAILY_LOGS_DIR = `${LOGS_DIR}/daily`;
const ANALYTICS_DIR = `${LOGS_DIR}/analytics`;
const VOICEMAILS_DIR = `${LOGS_DIR}/voicemails`;
const CALLBACKS_DIR = `${LOGS_DIR}/callbacks`;

// Создаем папки
[LOGS_DIR, CURRENT_LOGS_DIR, DAILY_LOGS_DIR, ANALYTICS_DIR, VOICEMAILS_DIR, CALLBACKS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Пути к файлам
const DB_PATH = `${CURRENT_LOGS_DIR}/appointments.json`;
const CALL_LOGS_PATH = `${CURRENT_LOGS_DIR}/call_logs.json`;
const AI_CONVERSATIONS_PATH = `${CURRENT_LOGS_DIR}/ai_conversations.json`;
const REMINDERS_LOG = `${CURRENT_LOGS_DIR}/reminders_log.json`;
const ANALYTICS_PATH = `${ANALYTICS_DIR}/call_analytics.json`;
const CALLBACKS_PATH = `${CURRENT_LOGS_DIR}/callbacks.json`;

// ======================================================
// НОВЫЕ: VOICEMAIL И CALLBACK СИСТЕМЫ
// ======================================================

// Функция для получения сегодняшней даты
function getTodayDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// Сохранение callback запроса
function saveCallbackRequest(phone, details = {}) {
  try {
    const callbackEntry = {
      phone,
      details,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      status: 'pending',
      calledBack: false,
      calledBackAt: null
    };
    
    // Сохраняем в текущие логи
    let callbacks = [];
    if (fs.existsSync(CALLBACKS_PATH)) {
      try {
        const fileData = fs.readFileSync(CALLBACKS_PATH, "utf8");
        if (fileData.trim() !== '') {
          callbacks = JSON.parse(fileData);
        }
      } catch (e) {
        console.log(`⚠️ Creating new callbacks file`);
      }
    }
    
    callbacks.push(callbackEntry);
    
    // Ограничиваем размер
    if (callbacks.length > 1000) {
      callbacks = callbacks.slice(-1000);
    }
    
    fs.writeFileSync(CALLBACKS_PATH, JSON.stringify(callbacks, null, 2));
    
    // Сохраняем в ежедневный архив
    saveToDailyArchive('callbacks', callbackEntry);
    
    console.log(`📞 Callback request saved for: ${phone}`);
    
    return callbackEntry;
    
  } catch (error) {
    console.error("ERROR saving callback request:", error);
    return null;
  }
}

// Отметить callback как выполненный
function markCallbackAsCompleted(phone) {
  try {
    if (!fs.existsSync(CALLBACKS_PATH)) return false;
    
    const fileData = fs.readFileSync(CALLBACKS_PATH, "utf8");
    let callbacks = JSON.parse(fileData || '[]');
    
    let updated = false;
    callbacks = callbacks.map(cb => {
      if (cb.phone === phone && !cb.calledBack) {
        updated = true;
        return {
          ...cb,
          calledBack: true,
          calledBackAt: new Date().toISOString(),
          status: 'completed'
        };
      }
      return cb;
    });
    
    if (updated) {
      fs.writeFileSync(CALLBACKS_PATH, JSON.stringify(callbacks, null, 2));
      console.log(`✅ Callback marked as completed for: ${phone}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("ERROR marking callback as completed:", error);
    return false;
  }
}

// Сохранение voicemail записи
function saveVoicemailRecording(phone, recordingUrl, duration, transcript = '') {
  try {
    const voicemailEntry = {
      phone,
      recordingUrl,
      duration,
      transcript,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      listened: false,
      priority: 'medium'
    };
    
    // Сохраняем в отдельный файл для voicemails
    const voicemailFile = `${VOICEMAILS_DIR}/voicemails.json`;
    let voicemails = [];
    
    if (fs.existsSync(voicemailFile)) {
      try {
        const fileData = fs.readFileSync(voicemailFile, "utf8");
        if (fileData.trim() !== '') {
          voicemails = JSON.parse(fileData);
        }
      } catch (e) {
        console.log(`⚠️ Creating new voicemails file`);
      }
    }
    
    voicemails.push(voicemailEntry);
    
    // Ограничиваем размер
    if (voicemails.length > 500) {
      voicemails = voicemails.slice(-500);
    }
    
    fs.writeFileSync(voicemailFile, JSON.stringify(voicemails, null, 2));
    
    // Также сохраняем в ежедневный архив
    saveToDailyArchive('voicemails', voicemailEntry);
    
    console.log(`🎤 Voicemail saved for: ${phone}, duration: ${duration}s, URL: ${recordingUrl}`);
    
    return voicemailEntry;
    
  } catch (error) {
    console.error("ERROR saving voicemail:", error);
    return null;
  }
}

// ======================================================
// INSTANT ARCHIVING FUNCTIONS
// ======================================================

function saveToDailyArchive(type, data) {
  try {
    const today = getTodayDateString();
    const archiveFile = `${DAILY_LOGS_DIR}/${type}-${today}.json`;
    
    let existingData = [];
    
    // 1. Load existing data if file exists
    if (fs.existsSync(archiveFile)) {
      try {
        const fileData = fs.readFileSync(archiveFile, "utf8");
        if (fileData.trim() !== '') {
          existingData = JSON.parse(fileData);
        }
      } catch (e) {
        console.log(`⚠️ Creating new ${type} archive for ${today}`);
      }
    }
    
    // 2. Add new data
    if (Array.isArray(data)) {
      existingData.push(...data);
    } else {
      existingData.push(data);
    }
    
    // 3. Limit size
    if (existingData.length > 2000) {
      existingData = existingData.slice(-2000);
    }
    
    // 4. Save to daily file
    fs.writeFileSync(archiveFile, JSON.stringify(existingData, null, 2));
    
    console.log(`✅ Instant archive: ${type} saved for ${today} (${existingData.length} records)`);
    
  } catch (error) {
    console.error(`❌ Instant archive error for ${type}:`, error);
  }
}

// Сохраняем аналитику
function saveAnalytics(phone, journey) {
  try {
    const analyticsFile = `${ANALYTICS_DIR}/analytics-${getTodayDateString()}.json`;
    
    let existingAnalytics = [];
    
    if (fs.existsSync(analyticsFile)) {
      try {
        const fileData = fs.readFileSync(analyticsFile, "utf8");
        if (fileData.trim() !== '') {
          existingAnalytics = JSON.parse(fileData);
        }
      } catch (e) {
        console.log(`⚠️ Creating new analytics file for today`);
      }
    }
    
    // Добавляем новую аналитику
    existingAnalytics.push({
      phone,
      ...journey,
      analyticsDate: getTodayDateString()
    });
    
    // Сохраняем
    fs.writeFileSync(analyticsFile, JSON.stringify(existingAnalytics, null, 2));
    
    // Также сохраняем в общий файл для быстрого доступа
    saveToCurrentAnalytics(phone, journey);
    
    console.log(`📈 Analytics saved for ${phone} (${journey.totalDuration}s, result: ${journey.callResult})`);
    
  } catch (error) {
    console.error(`❌ Error saving analytics:`, error);
  }
}

// Сохраняем аналитику в текущие логи
function saveToCurrentAnalytics(phone, journey) {
  try {
    let currentAnalytics = [];
    
    if (fs.existsSync(ANALYTICS_PATH)) {
      try {
        const fileData = fs.readFileSync(ANALYTICS_PATH, "utf8");
        if (fileData.trim() !== '') {
          currentAnalytics = JSON.parse(fileData);
        }
      } catch (e) {
        console.log(`⚠️ Creating new current analytics file`);
      }
    }
    
    currentAnalytics.push({
      phone,
      ...journey,
      timestamp: new Date().toISOString()
    });
    
    // Ограничиваем размер (последние 1000 записей)
    if (currentAnalytics.length > 1000) {
      currentAnalytics = currentAnalytics.slice(-1000);
    }
    
    fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(currentAnalytics, null, 2));
    
  } catch (error) {
    console.error(`❌ Error saving to current analytics:`, error);
  }
}

// ======================================================
// УЛУЧШЕННОЕ ЛОГИРОВАНИЕ ЗВОНКОВ
// ======================================================

function logCall(phone, action, details = {}) {
  try {
    // Начинаем отслеживание если еще не начато
    if (action === 'CALL_RECEIVED') {
      startUserJourney(phone);
    }
    
    // Трекаем действие
    trackUserAction(phone, action, details);
    
    const logEntry = {
      phone,
      action,
      details,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      analytics: {
        callStage: action,
        userJourney: userJourneyTracker[phone] ? userJourneyTracker[phone].path : [],
        optionsSelected: userJourneyTracker[phone] ? userJourneyTracker[phone].optionsSelected : [],
        sentiment: userJourneyTracker[phone] ? userJourneyTracker[phone].sentiment : 'neutral',
        frustrationLevel: userJourneyTracker[phone] ? userJourneyTracker[phone].frustrationLevel : 0,
        timeInSystem: userJourneyTracker[phone] ? userJourneyTracker[phone].totalDuration : 0
      }
    };
    
    // INSTANT ARCHIVING to daily file
    saveToDailyArchive('calls', logEntry);
    
    console.log(`📝 Call logged: ${phone} - ${action}`);
    
    // Если звонок завершен, сохраняем полную аналитику
    if (action.includes('HANGUP') || action.includes('GOODBYE') || action === 'CALL_COMPLETED') {
      completeUserJourney(phone, action);
    }
    
  } catch (error) {
    console.error("ERROR logging call:", error);
  }
}

// ======================================================
// REMINDER SYSTEM
// ======================================================

function logReminder(phone, appointment, action) {
  try {
    const logEntry = {
      phone,
      appointment: {
        name: appointment.name,
        date: appointment.date,
        time: appointment.time
      },
      action,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true
      })
    };
    
    saveToDailyArchive('reminders', logEntry);
    
    console.log(`⏰ Reminder logged: ${phone} - ${action}`);
    
  } catch (error) {
    console.error("ERROR logging reminder:", error);
  }
}

function sendReminderCall(phone, appointment) {
  console.log(`🔔 SENDING REMINDER to: ${phone} for appointment: ${appointment.date} at ${appointment.time}`);
  
  try {
    twilioClient.calls.create({
      twiml: `<Response>
        <Say voice="alice" language="en-US">
          Hello, this is Altair Partners calling to remind you about your appointment 
          scheduled for ${appointment.date} at ${appointment.time}. 
          Please call us if you need to reschedule. 
          Thank you for choosing Altair Partners!
        </Say>
        <Hangup/>
      </Response>`,
      to: phone,
      from: process.env.TWILIO_PHONE_NUMBER
    });
    
    logReminder(phone, appointment, "REMINDER_SENT");
    
    console.log(`✅ Reminder sent to ${phone}`);
    
  } catch (error) {
    console.error("ERROR sending reminder:", error);
  }
}

function checkAndSendReminders() {
  console.log("⏰ Checking for reminders to send...");
  
  try {
    const appointments = loadDB();
    const now = new Date();
    const today = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();
    
    appointments.forEach(appointment => {
      try {
        const appointmentDate = new Date(appointment.date + ' ' + todayYear);
        
        if (isNaN(appointmentDate.getTime())) {
          console.log(`❌ Invalid date format for appointment: ${appointment.date}`);
          return;
        }
        
        const appointmentYear = appointmentDate.getFullYear();
        const appointmentMonth = appointmentDate.getMonth();
        const appointmentDay = appointmentDate.getDate();
        
        // Check if appointment is tomorrow
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        
        const isTomorrow = appointmentYear === tomorrow.getFullYear() &&
                          appointmentMonth === tomorrow.getMonth() &&
                          appointmentDay === tomorrow.getDate();
        
        if (isTomorrow) {
          console.log(`📅 Appointment found for tomorrow: ${appointment.name} - ${appointment.date} at ${appointment.time}`);
          
          // Check if it's 2 PM Pacific Time
          const currentHour = today.getHours();
          const currentMinute = today.getMinutes();
          
          if (currentHour === 14 && currentMinute >= 0 && currentMinute <= 5) {
            console.log(`✅ It's 2 PM PST - Sending reminder to: ${appointment.phone}`);
            sendReminderCall(appointment.phone, appointment);
          }
        }
        
      } catch (error) {
        console.error(`Error processing appointment for ${appointment.name}:`, error);
      }
    });
    
  } catch (error) {
    console.error("ERROR checking reminders:", error);
  }
}

function startReminderScheduler() {
  console.log("⏰ Reminder scheduler started");
  console.log("🔄 Will check every 5 minutes for appointments tomorrow at 2 PM PST");
  
  checkAndSendReminders();
  
  setInterval(checkAndSendReminders, 5 * 60 * 1000);
}

// ======================================================
// OPENAI SETUP
// ======================================================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const REP_CONTEXT = `
You work at Altair Partners - a creative agency in Portland.

BUSINESS INFO:
- Hours: Monday to Friday, 10 AM to 5 PM Pacific Time
- Location: Portland, Oregon
- Services: Creative design, branding, marketing campaigns, video production
- For appointments: Say "I'll transfer you to our booking system"

BEHAVIOR:
1. Keep answers VERY SHORT (max 10 words)
2. If question about appointments → say "I'll transfer you to our booking system"
3. If about hours/location/services → answer directly
4. If customer says goodbye → say "Goodbye" and end call
5. Sound human but be concise
`;

async function getRepResponse(question, phone) {
  try {
    console.log(`🤖 AI Question: ${question}`);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `${REP_CONTEXT}\n\nRespond in 5-10 words maximum.`
        },
        {
          role: "user",
          content: question
        }
      ],
      max_tokens: 30,
      temperature: 0.3
    });
    
    const response = completion.choices[0].message.content;
    console.log(`🤖 AI Response: ${response}`);
    
    return response;
    
  } catch (error) {
    console.error("AI Error:", error);
    return "Let me transfer you to our booking system.";
  }
}

function isSeriousQuestion(question) {
  const lower = question.toLowerCase();
  const seriousKeywords = [
    'law', 'legal', 'attorney', 'lawyer', 'court', 'lawsuit', 'sue',
    'million', 'billion', '100k', '500k', 'investment', 'laws', 'contract'
  ];
  
  return seriousKeywords.some(keyword => lower.includes(keyword));
}

function logAIConversation(phone, question, response) {
  try {
    const conversationEntry = {
      phone,
      question,
      response,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true
      })
    };
    
    saveToDailyArchive('ai', conversationEntry);
    
    console.log(`🤖 AI conversation logged: ${phone}`);
    
  } catch (error) {
    console.error("ERROR logging AI conversation:", error);
  }
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, '[]');
      return [];
    }
    const data = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error("ERROR loading database:", error);
    return [];
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("ERROR saving database:", error);
  }
}

function findAppointment(phone) {
  const db = loadDB();
  const normalizedPhone = phone.replace(/\D/g, '');
  
  return db.find(a => {
    const normalizedApptPhone = a.phone.replace(/\D/g, '');
    return normalizedApptPhone === normalizedPhone;
  });
}

function addAppointment(name, phone, businessType, serviceType, date, time) {
  const db = loadDB();
  const normalizedPhone = phone.replace(/\D/g, '');
  
  const filteredDB = db.filter(a => {
    const normalizedApptPhone = a.phone.replace(/\D/g, '');
    return normalizedApptPhone !== normalizedPhone;
  });
  
  const appointment = { 
    name, 
    phone,
    businessType,
    serviceType,
    date, 
    time,
    created: new Date().toISOString(),
    timestamp: new Date().toLocaleString('en-US', { 
      timeZone: 'America/Los_Angeles',
      hour12: true
    })
  };
  
  filteredDB.push(appointment);
  
  saveDB(filteredDB);
  
  saveToDailyArchive('appointments', appointment);
  
  console.log(`✅ Appointment added: ${name} - ${date} at ${time}`);
  
  logCall(phone, 'APPOINTMENT_SCHEDULED', {
    name,
    businessType,
    serviceType,
    date,
    time
  });
  
  // Отправляем SMS клиенту и админу
  sendAppointmentNotifications(phone, name, date, time, businessType, serviceType);
  
  return appointment;
}

// Функция отправки уведомлений
function sendAppointmentNotifications(phone, name, date, time, businessType, serviceType) {
  try {
    // SMS клиенту
    twilioClient.messages.create({
      body: `✅ Thank you for your appointment with Altair Partners!\n\n` +
            `Your appointment: ${date} at ${time}\n` +
            `Name: ${name}\n` +
            `Business: ${businessType}\n` +
            `Service: ${serviceType}\n\n` +
            `We'll call you ONE DAY BEFORE as a reminder.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });
    console.log(`📱 SMS sent to client ${phone}`);
    
  } catch (err) {
    console.log("ERROR sending SMS to client:", err);
  }
  
  try {
    // SMS админу (тебе)
    twilioClient.messages.create({
      body: `📅 NEW APPOINTMENT\n` +
            `Name: ${name}\n` +
            `Phone: ${phone}\n` +
            `Date: ${date} at ${time}\n` +
            `Business: ${businessType}\n` +
            `Service: ${serviceType}\n` +
            `⏰ Reminder: Will call ONE DAY BEFORE at 2 PM PST`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: '+15035442571' // ТВОЙ НОМЕР
    });
    console.log(`📱 Notification sent to admin`);
    
  } catch (err) {
    console.log("ERROR sending admin notification:", err);
  }
}

// Функция отправки voicemail уведомления
function sendVoicemailNotification(phone, recordingUrl, duration, transcript = '') {
  try {
    const transcriptPreview = transcript.length > 100 ? 
      transcript.substring(0, 100) + '...' : 
      transcript;
    
    // SMS админу о новом voicemail
    twilioClient.messages.create({
      body: `🎤 NEW VOICEMAIL\n` +
            `From: ${phone}\n` +
            `Duration: ${duration}s\n` +
            `Recording: ${recordingUrl}\n` +
            `Transcript: "${transcriptPreview}"\n\n` +
            `Listen at: https://altair-ivr-render-1.onrender.com/voicemails`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: '+15035442571' // ТВОЙ НОМЕР
    });
    console.log(`📱 Voicemail notification sent to admin`);
    
  } catch (err) {
    console.log("ERROR sending voicemail notification:", err);
  }
}

// Функция отправки callback уведомления
function sendCallbackNotification(phone) {
  try {
    // SMS админу о callback запросе
    twilioClient.messages.create({
      body: `📞 CALLBACK REQUESTED\n` +
            `From: ${phone}\n` +
            `Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}\n\n` +
            `View all callbacks: https://altair-ivr-render-1.onrender.com/callbacks-dashboard`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: '+15035442571' // ТВОЙ НОМЕР
    });
    console.log(`📱 Callback notification sent to admin`);
    
  } catch (err) {
    console.log("ERROR sending callback notification:", err);
  }
}

function getNextAvailableDate() {
  const today = new Date();
  const nextDate = new Date(today);
  nextDate.setDate(today.getDate() + 3);
  
  const options = { weekday: 'long', month: 'long', day: 'numeric' };
  return nextDate.toLocaleDateString('en-US', options);
}

// ======================================================
// НОВЫЙ: HTML СТРАНИЦА ДЛЯ CALLBACKS
// ======================================================

const CALLBACKS_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📞 Callback Requests - Altair Partners</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        body {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            padding: 20px;
            color: white;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            overflow: hidden;
            color: #333;
        }

        .header {
            background: linear-gradient(to right, #ef4444, #f97316);
            color: white;
            padding: 30px 40px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .back-btn {
            position: absolute;
            top: 30px;
            right: 40px;
            padding: 10px 20px;
            background: white;
            color: #ef4444;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s ease;
        }

        .back-btn:hover {
            background: #f8fafc;
            transform: translateY(-2px);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8fafc;
        }

        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 15px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            text-align: center;
            transition: transform 0.3s ease;
            border-left: 5px solid #ef4444;
        }

        .stat-card:hover {
            transform: translateY(-5px);
        }

        .stat-number {
            font-size: 3rem;
            font-weight: 800;
            color: #ef4444;
            margin-bottom: 10px;
        }

        .controls {
            padding: 20px 40px;
            background: white;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }

        .filter-btn {
            padding: 10px 20px;
            background: #f1f5f9;
            border: 2px solid #cbd5e1;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .filter-btn.active {
            background: #ef4444;
            color: white;
            border-color: #ef4444;
        }

        .search-box {
            flex: 1;
            min-width: 200px;
            padding: 10px 15px;
            border: 2px solid #cbd5e1;
            border-radius: 10px;
            font-size: 1rem;
        }

        .action-btn {
            padding: 10px 20px;
            background: #10b981;
            color: white;
            border: none;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s ease;
        }

        .action-btn:hover {
            background: #059669;
            transform: translateY(-2px);
        }

        .callback-list {
            padding: 30px;
        }

        .callback-item {
            background: white;
            margin-bottom: 15px;
            padding: 20px;
            border-radius: 10px;
            border-left: 4px solid #ef4444;
            box-shadow: 0 3px 10px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        }

        .callback-item:hover {
            transform: translateX(5px);
            box-shadow: 0 5px 15px rgba(239, 68, 68, 0.2);
        }

        .callback-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .phone-number {
            font-family: monospace;
            background: #fee2e2;
            padding: 5px 10px;
            border-radius: 5px;
            font-weight: 600;
            color: #991b1b;
        }

        .time {
            color: #64748b;
            font-size: 0.9rem;
        }

        .status-badge {
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }

        .status-pending {
            background: #fef3c7;
            color: #92400e;
        }

        .status-completed {
            background: #dcfce7;
            color: #166534;
        }

        .actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }

        .call-btn {
            padding: 8px 15px;
            background: #10b981;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
            text-decoration: none;
        }

        .mark-btn {
            padding: 8px 15px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .delete-btn {
            padding: 8px 15px;
            background: #ef4444;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .loading {
            text-align: center;
            padding: 60px;
            color: #64748b;
            font-size: 1.2rem;
        }

        .loader {
            width: 50px;
            height: 50px;
            border: 4px solid #e2e8f0;
            border-top: 4px solid #ef4444;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .no-data {
            text-align: center;
            padding: 60px;
            color: #64748b;
            font-size: 1.2rem;
        }

        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .stat-number {
                font-size: 2rem;
            }
            
            .callback-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
            }
            
            .actions {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>
                <i class="fas fa-phone"></i>
                Callback Requests Dashboard
            </h1>
            <p>Track and manage all callback requests from customers</p>
            <a href="/dashboard" class="back-btn">
                <i class="fas fa-arrow-left"></i> Back to Dashboard
            </a>
        </div>

        <!-- Stats -->
        <div class="stats-grid" id="statsGrid">
            <div class="stat-card">
                <div class="stat-number" id="totalCallbacks">0</div>
                <div>Total Callbacks</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="pendingCallbacks">0</div>
                <div>Pending</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="completedCallbacks">0</div>
                <div>Completed</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="todayCallbacks">0</div>
                <div>Today</div>
            </div>
        </div>

        <!-- Controls -->
        <div class="controls">
            <button class="filter-btn active" onclick="filterCallbacks('all')">All</button>
            <button class="filter-btn" onclick="filterCallbacks('pending')">Pending</button>
            <button class="filter-btn" onclick="filterCallbacks('completed')">Completed</button>
            
            <input type="text" class="search-box" id="searchBox" placeholder="🔍 Search by phone number..." oninput="searchCallbacks()">
            
            <button class="action-btn" onclick="loadCallbacks()">
                <i class="fas fa-sync-alt"></i> Refresh
            </button>
        </div>

        <!-- Loading -->
        <div class="loading" id="loading">
            <div class="loader"></div>
            Loading callback requests...
        </div>

        <!-- Callback List -->
        <div class="callback-list" id="callbackList">
            <!-- Callbacks will be loaded here -->
        </div>

        <!-- No Data -->
        <div class="no-data" id="noData" style="display: none;">
            <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 20px;"></i>
            <h3>No callback requests found</h3>
            <p>When customers request callbacks, they will appear here.</p>
        </div>
    </div>

    <script>
        let allCallbacks = [];
        let currentFilter = 'all';
        let searchTerm = '';

        // Load on page load
        document.addEventListener('DOMContentLoaded', () => {
            loadCallbacks();
            setInterval(loadCallbacks, 30000); // Auto-refresh every 30 seconds
        });

        // Load callback data
        async function loadCallbacks() {
            showLoading();
            
            try {
                const response = await fetch('/api/callbacks');
                const data = await response.json();
                
                if (data.success) {
                    allCallbacks = data.callbacks || [];
                    updateStats(allCallbacks);
                    renderCallbacks(allCallbacks);
                    hideLoading();
                } else {
                    throw new Error(data.error || 'Failed to load callbacks');
                }
            } catch (error) {
                console.error('Error loading callbacks:', error);
                showError('Failed to load callback requests');
                hideLoading();
            }
        }

        // Update statistics
        function updateStats(callbacks) {
            const total = callbacks.length;
            const pending = callbacks.filter(cb => cb.status === 'pending').length;
            const completed = callbacks.filter(cb => cb.status === 'completed').length;
            
            const today = new Date().toISOString().split('T')[0];
            const todayCount = callbacks.filter(cb => cb.timestamp.includes(today)).length;
            
            document.getElementById('totalCallbacks').textContent = total;
            document.getElementById('pendingCallbacks').textContent = pending;
            document.getElementById('completedCallbacks').textContent = completed;
            document.getElementById('todayCallbacks').textContent = todayCount;
            
            // Animate numbers
            animateNumbers();
        }

        // Animate stats numbers
        function animateNumbers() {
            const statNumbers = document.querySelectorAll('.stat-number');
            statNumbers.forEach(stat => {
                const target = parseInt(stat.textContent);
                let current = 0;
                const increment = target / 20;
                
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        current = target;
                        clearInterval(timer);
                    }
                    stat.textContent = Math.floor(current);
                }, 50);
            });
        }

        // Filter callbacks
        function filterCallbacks(filter) {
            currentFilter = filter;
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            renderCallbacks(allCallbacks);
        }

        // Search callbacks
        function searchCallbacks() {
            searchTerm = document.getElementById('searchBox').value.toLowerCase();
            renderCallbacks(allCallbacks);
        }

        // Render callbacks
        function renderCallbacks(callbacks) {
            let filtered = [...callbacks];
            
            // Apply filter
            if (currentFilter === 'pending') {
                filtered = filtered.filter(cb => cb.status === 'pending');
            } else if (currentFilter === 'completed') {
                filtered = filtered.filter(cb => cb.status === 'completed');
            }
            
            // Apply search
            if (searchTerm) {
                filtered = filtered.filter(cb => 
                    cb.phone.toLowerCase().includes(searchTerm)
                );
            }
            
            // Sort by time (newest first)
            filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            const callbackList = document.getElementById('callbackList');
            
            if (filtered.length === 0) {
                document.getElementById('noData').style.display = 'block';
                callbackList.innerHTML = '';
                return;
            }
            
            document.getElementById('noData').style.display = 'none';
            
            let html = '';
            
            filtered.forEach(callback => {
                const time = new Date(callback.timestamp).toLocaleString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                const statusClass = callback.status === 'pending' ? 'status-pending' : 'status-completed';
                const statusIcon = callback.status === 'pending' ? 'fa-clock' : 'fa-check';
                const statusText = callback.status === 'pending' ? 'PENDING' : 'COMPLETED';
                
                html += \`
                    <div class="callback-item">
                        <div class="callback-header">
                            <div>
                                <span class="phone-number">\${callback.phone}</span>
                                <span class="status-badge \${statusClass}" style="margin-left: 10px;">
                                    <i class="fas \${statusIcon}"></i>
                                    \${statusText}
                                </span>
                            </div>
                            <div class="time">\${time}</div>
                        </div>
                        
                        <div style="margin-bottom: 10px;">
                            <strong>Requested:</strong> \${callback.time || 'N/A'}
                        </div>
                        
                        \${callback.details && callback.details.reason ? \`
                            <div style="margin-bottom: 10px; padding: 10px; background: #f8fafc; border-radius: 5px;">
                                <strong>Reason:</strong> "\${callback.details.reason}"
                            </div>
                        \` : ''}
                        
                        <div class="actions">
                            <a href="tel:\${callback.phone}" class="call-btn">
                                <i class="fas fa-phone"></i> Call Now
                            </a>
                            
                            \${callback.status === 'pending' ? \`
                                <button class="mark-btn" onclick="markAsCompleted('\${callback.phone}')">
                                    <i class="fas fa-check"></i> Mark as Completed
                                </button>
                            \` : \`
                                <button class="mark-btn" style="background: #6b7280;" disabled>
                                    <i class="fas fa-check"></i> Completed
                                </button>
                            \`}
                            
                            <button class="delete-btn" onclick="deleteCallback('\${callback.phone}')">
                                <i class="fas fa-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                \`;
            });
            
            callbackList.innerHTML = html;
        }

        // Mark callback as completed
        async function markAsCompleted(phone) {
            if (!confirm('Mark this callback as completed?')) return;
            
            try {
                const response = await fetch(\`/api/callbacks/\${phone}/complete\`, {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    alert('Callback marked as completed!');
                    loadCallbacks(); // Reload the list
                } else {
                    throw new Error(data.error || 'Failed to mark as completed');
                }
            } catch (error) {
                console.error('Error marking as completed:', error);
                alert('Failed to mark as completed: ' + error.message);
            }
        }

        // Delete callback
        async function deleteCallback(phone) {
            if (!confirm('Delete this callback request?')) return;
            
            try {
                const response = await fetch(\`/api/callbacks/\${phone}\`, {
                    method: 'DELETE'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    alert('Callback deleted!');
                    loadCallbacks(); // Reload the list
                } else {
                    throw new Error(data.error || 'Failed to delete');
                }
            } catch (error) {
                console.error('Error deleting callback:', error);
                alert('Failed to delete: ' + error.message);
            }
        }

        // Utility functions
        function showLoading() {
            document.getElementById('loading').style.display = 'block';
            document.getElementById('callbackList').style.display = 'none';
        }

        function hideLoading() {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('callbackList').style.display = 'block';
        }

        function showError(message) {
            alert('Error: ' + message);
        }
    </script>
</body>
</html>
`;

// ======================================================
// НОВЫЙ: HTML СТРАНИЦА ДЛЯ VOICEMAILS
// ======================================================

const VOICEMAILS_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎤 Voicemails - Altair Partners</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        body {
            background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
            min-height: 100vh;
            padding: 20px;
            color: white;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            overflow: hidden;
            color: #333;
        }

        .header {
            background: linear-gradient(to right, #0d9488, #14b8a6);
            color: white;
            padding: 30px 40px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .back-btn {
            position: absolute;
            top: 30px;
            right: 40px;
            padding: 10px 20px;
            background: white;
            color: #0d9488;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s ease;
        }

        .back-btn:hover {
            background: #f8fafc;
            transform: translateY(-2px);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8fafc;
        }

        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 15px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            text-align: center;
            transition: transform 0.3s ease;
            border-left: 5px solid #0d9488;
        }

        .stat-card:hover {
            transform: translateY(-5px);
        }

        .stat-number {
            font-size: 3rem;
            font-weight: 800;
            color: #0d9488;
            margin-bottom: 10px;
        }

        .controls {
            padding: 20px 40px;
            background: white;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }

        .filter-btn {
            padding: 10px 20px;
            background: #f1f5f9;
            border: 2px solid #cbd5e1;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .filter-btn.active {
            background: #0d9488;
            color: white;
            border-color: #0d9488;
        }

        .search-box {
            flex: 1;
            min-width: 200px;
            padding: 10px 15px;
            border: 2px solid #cbd5e1;
            border-radius: 10px;
            font-size: 1rem;
        }

        .action-btn {
            padding: 10px 20px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s ease;
        }

        .action-btn:hover {
            background: #2563eb;
            transform: translateY(-2px);
        }

        .voicemail-list {
            padding: 30px;
        }

        .voicemail-item {
            background: white;
            margin-bottom: 20px;
            padding: 25px;
            border-radius: 10px;
            border-left: 4px solid #0d9488;
            box-shadow: 0 3px 10px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        }

        .voicemail-item:hover {
            transform: translateX(5px);
            box-shadow: 0 5px 15px rgba(13, 148, 136, 0.2);
        }

        .voicemail-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .phone-number {
            font-family: monospace;
            background: #ccfbf1;
            padding: 5px 10px;
            border-radius: 5px;
            font-weight: 600;
            color: #0f766e;
        }

        .time {
            color: #64748b;
            font-size: 0.9rem;
        }

        .duration-badge {
            padding: 5px 15px;
            background: #f0f9ff;
            color: #0369a1;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            margin-left: 10px;
        }

        .audio-player {
            width: 100%;
            margin: 15px 0;
            background: #f8fafc;
            border-radius: 10px;
            padding: 15px;
        }

        .transcript {
            background: #f8fafc;
            padding: 15px;
            border-radius: 10px;
            margin: 15px 0;
            font-size: 0.95rem;
            line-height: 1.6;
            color: #475569;
        }

        .actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
            flex-wrap: wrap;
        }

        .listen-btn {
            padding: 8px 15px;
            background: #0d9488;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
            text-decoration: none;
        }

        .mark-btn {
            padding: 8px 15px;
            background: #8b5cf6;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .delete-btn {
            padding: 8px 15px;
            background: #ef4444;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .loading {
            text-align: center;
            padding: 60px;
            color: #64748b;
            font-size: 1.2rem;
        }

        .loader {
            width: 50px;
            height: 50px;
            border: 4px solid #e2e8f0;
            border-top: 4px solid #0d9488;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .no-data {
            text-align: center;
            padding: 60px;
            color: #64748b;
            font-size: 1.2rem;
        }

        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .stat-number {
                font-size: 2rem;
            }
            
            .voicemail-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
            }
            
            .audio-player {
                padding: 10px;
            }
            
            .actions {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>
                <i class="fas fa-microphone"></i>
                Voicemail Dashboard
            </h1>
            <p>Listen to and manage all voicemail recordings from customers</p>
            <a href="/dashboard" class="back-btn">
                <i class="fas fa-arrow-left"></i> Back to Dashboard
            </a>
        </div>

        <!-- Stats -->
        <div class="stats-grid" id="statsGrid">
            <div class="stat-card">
                <div class="stat-number" id="totalVoicemails">0</div>
                <div>Total Voicemails</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="totalDuration">0</div>
                <div>Total Duration (s)</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="unlistenedVoicemails">0</div>
                <div>Unlistened</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="todayVoicemails">0</div>
                <div>Today</div>
            </div>
        </div>

        <!-- Controls -->
        <div class="controls">
            <button class="filter-btn active" onclick="filterVoicemails('all')">All</button>
            <button class="filter-btn" onclick="filterVoicemails('unlistened')">Unlistened</button>
            <button class="filter-btn" onclick="filterVoicemails('listened')">Listened</button>
            
            <input type="text" class="search-box" id="searchBox" placeholder="🔍 Search by phone number..." oninput="searchVoicemails()">
            
            <button class="action-btn" onclick="loadVoicemails()">
                <i class="fas fa-sync-alt"></i> Refresh
            </button>
        </div>

        <!-- Loading -->
        <div class="loading" id="loading">
            <div class="loader"></div>
            Loading voicemails...
        </div>

        <!-- Voicemail List -->
        <div class="voicemail-list" id="voicemailList">
            <!-- Voicemails will be loaded here -->
        </div>

        <!-- No Data -->
        <div class="no-data" id="noData" style="display: none;">
            <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 20px;"></i>
            <h3>No voicemails found</h3>
            <p>When customers leave voicemails, they will appear here.</p>
        </div>
    </div>

    <script>
        let allVoicemails = [];
        let currentFilter = 'all';
        let searchTerm = '';

        // Load on page load
        document.addEventListener('DOMContentLoaded', () => {
            loadVoicemails();
            setInterval(loadVoicemails, 30000); // Auto-refresh every 30 seconds
        });

        // Load voicemail data
        async function loadVoicemails() {
            showLoading();
            
            try {
                const response = await fetch('/api/voicemails');
                const data = await response.json();
                
                if (data.success) {
                    allVoicemails = data.voicemails || [];
                    updateStats(allVoicemails);
                    renderVoicemails(allVoicemails);
                    hideLoading();
                } else {
                    throw new Error(data.error || 'Failed to load voicemails');
                }
            } catch (error) {
                console.error('Error loading voicemails:', error);
                showError('Failed to load voicemails');
                hideLoading();
            }
        }

        // Update statistics
        function updateStats(voicemails) {
            const total = voicemails.length;
            const totalDuration = voicemails.reduce((sum, vm) => sum + (vm.duration || 0), 0);
            const unlistened = voicemails.filter(vm => !vm.listened).length;
            
            const today = new Date().toISOString().split('T')[0];
            const todayCount = voicemails.filter(vm => vm.timestamp.includes(today)).length;
            
            document.getElementById('totalVoicemails').textContent = total;
            document.getElementById('totalDuration').textContent = totalDuration;
            document.getElementById('unlistenedVoicemails').textContent = unlistened;
            document.getElementById('todayVoicemails').textContent = todayCount;
            
            // Animate numbers
            animateNumbers();
        }

        // Animate stats numbers
        function animateNumbers() {
            const statNumbers = document.querySelectorAll('.stat-number');
            statNumbers.forEach(stat => {
                const target = parseInt(stat.textContent);
                let current = 0;
                const increment = target / 20;
                
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        current = target;
                        clearInterval(timer);
                    }
                    stat.textContent = Math.floor(current);
                }, 50);
            });
        }

        // Filter voicemails
        function filterVoicemails(filter) {
            currentFilter = filter;
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            renderVoicemails(allVoicemails);
        }

        // Search voicemails
        function searchVoicemails() {
            searchTerm = document.getElementById('searchBox').value.toLowerCase();
            renderVoicemails(allVoicemails);
        }

        // Render voicemails
        function renderVoicemails(voicemails) {
            let filtered = [...voicemails];
            
            // Apply filter
            if (currentFilter === 'unlistened') {
                filtered = filtered.filter(vm => !vm.listened);
            } else if (currentFilter === 'listened') {
                filtered = filtered.filter(vm => vm.listened);
            }
            
            // Apply search
            if (searchTerm) {
                filtered = filtered.filter(vm => 
                    vm.phone.toLowerCase().includes(searchTerm)
                );
            }
            
            // Sort by time (newest first)
            filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            const voicemailList = document.getElementById('voicemailList');
            
            if (filtered.length === 0) {
                document.getElementById('noData').style.display = 'block';
                voicemailList.innerHTML = '';
                return;
            }
            
            document.getElementById('noData').style.display = 'none';
            
            let html = '';
            
            filtered.forEach(voicemail => {
                const time = new Date(voicemail.timestamp).toLocaleString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                const duration = voicemail.duration || 0;
                const listened = voicemail.listened || false;
                
                html += \`
                    <div class="voicemail-item">
                        <div class="voicemail-header">
                            <div>
                                <span class="phone-number">\${voicemail.phone}</span>
                                <span class="duration-badge">
                                    <i class="fas fa-clock"></i>
                                    \${duration}s
                                </span>
                            </div>
                            <div class="time">\${time}</div>
                        </div>
                        
                        <!-- Audio Player -->
                        <div class="audio-player">
                            <audio controls style="width: 100%;">
                                <source src="\${voicemail.recordingUrl}" type="audio/mpeg">
                                Your browser does not support the audio element.
                            </audio>
                        </div>
                        
                        <!-- Transcript -->
                        \${voicemail.transcript ? \`
                            <div class="transcript">
                                <strong>Transcript:</strong><br>
                                "\${voicemail.transcript}"
                            </div>
                        \` : \`
                            <div class="transcript" style="color: #94a3b8; font-style: italic;">
                                No transcript available
                            </div>
                        \`}
                        
                        <div class="actions">
                            <a href="\${voicemail.recordingUrl}" target="_blank" class="listen-btn">
                                <i class="fas fa-external-link-alt"></i> Open in New Tab
                            </a>
                            
                            \${!listened ? \`
                                <button class="mark-btn" onclick="markAsListened('\${voicemail.phone}', '\${voicemail.timestamp}')">
                                    <i class="fas fa-check"></i> Mark as Listened
                                </button>
                            \` : \`
                                <button class="mark-btn" style="background: #6b7280;" disabled>
                                    <i class="fas fa-check"></i> Listened
                                </button>
                            \`}
                            
                            <button class="delete-btn" onclick="deleteVoicemail('\${voicemail.phone}', '\${voicemail.timestamp}')">
                                <i class="fas fa-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                \`;
            });
            
            voicemailList.innerHTML = html;
        }

        // Mark voicemail as listened
        async function markAsListened(phone, timestamp) {
            try {
                const response = await fetch(\`/api/voicemails/\${encodeURIComponent(phone)}/\${encodeURIComponent(timestamp)}/listen\`, {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    loadVoicemails(); // Reload the list
                } else {
                    throw new Error(data.error || 'Failed to mark as listened');
                }
            } catch (error) {
                console.error('Error marking as listened:', error);
                alert('Failed to mark as listened: ' + error.message);
            }
        }

        // Delete voicemail
        async function deleteVoicemail(phone, timestamp) {
            if (!confirm('Delete this voicemail?')) return;
            
            try {
                const response = await fetch(\`/api/voicemails/\${encodeURIComponent(phone)}/\${encodeURIComponent(timestamp)}\`, {
                    method: 'DELETE'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    alert('Voicemail deleted!');
                    loadVoicemails(); // Reload the list
                } else {
                    throw new Error(data.error || 'Failed to delete');
                }
            } catch (error) {
                console.error('Error deleting voicemail:', error);
                alert('Failed to delete: ' + error.message);
            }
        }

        // Utility functions
        function showLoading() {
            document.getElementById('loading').style.display = 'block';
            document.getElementById('voicemailList').style.display = 'none';
        }

        function hideLoading() {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('voicemailList').style.display = 'block';
        }

        function showError(message) {
            alert('Error: ' + message);
        }
    </script>
</body>
</html>
`;

// ======================================================
// НОВЫЙ: ОБНОВЛЕННЫЙ ANALYTICS DASHBOARD (ИСПРАВЛЕННЫЙ!)
// ======================================================

const ANALYTICS_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📈 Altair Partners - Real-time Analytics Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        body {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            padding: 20px;
            color: white;
        }

        .container {
            max-width: 1600px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            overflow: hidden;
            color: #333;
        }

        .header {
            background: linear-gradient(to right, #4f46e5, #7c3aed);
            color: white;
            padding: 30px 40px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .back-btn {
            position: absolute;
            top: 30px;
            right: 40px;
            padding: 10px 20px;
            background: white;
            color: #4f46e5;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s ease;
        }

        .back-btn:hover {
            background: #f8fafc;
            transform: translateY(-2px);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8fafc;
        }

        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 15px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            text-align: center;
            transition: transform 0.3s ease;
            border-left: 5px solid #4f46e5;
        }

        .stat-card:hover {
            transform: translateY(-5px);
        }

        .stat-number {
            font-size: 3rem;
            font-weight: 800;
            color: #4f46e5;
            margin-bottom: 10px;
        }

        .stat-label {
            color: #64748b;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .charts-container {
            padding: 30px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
            gap: 30px;
        }

        .chart-box {
            background: white;
            padding: 25px;
            border-radius: 15px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        }

        .chart-title {
            font-size: 1.3rem;
            font-weight: 600;
            margin-bottom: 20px;
            color: #1e293b;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .controls {
            padding: 20px 30px;
            background: #e2e8f0;
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }

        .filter-btn {
            padding: 10px 20px;
            background: white;
            border: 2px solid #cbd5e1;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .filter-btn.active {
            background: #4f46e5;
            color: white;
            border-color: #4f46e5;
        }

        .time-selector {
            padding: 10px 15px;
            border: 2px solid #cbd5e1;
            border-radius: 10px;
            font-size: 1rem;
            background: white;
        }

        .refresh-btn {
            padding: 10px 20px;
            background: #10b981;
            color: white;
            border: none;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s ease;
        }

        .refresh-btn:hover {
            background: #059669;
            transform: translateY(-2px);
        }

        .recent-calls {
            padding: 30px;
        }

        .call-item {
            background: white;
            margin-bottom: 15px;
            padding: 20px;
            border-radius: 10px;
            border-left: 4px solid #4f46e5;
            box-shadow: 0 3px 10px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        }

        .call-item:hover {
            transform: translateX(5px);
            box-shadow: 0 5px 15px rgba(79, 70, 229, 0.2);
        }

        .call-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .phone-number {
            font-family: monospace;
            background: #f1f5f9;
            padding: 5px 10px;
            border-radius: 5px;
            font-weight: 600;
            color: #1e293b;
        }

        .sentiment {
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
        }

        .sentiment-positive { background: #dcfce7; color: #166534; }
        .sentiment-negative { background: #fee2e2; color: #991b1b; }
        .sentiment-neutral { background: #e2e8f0; color: #475569; }

        .conversion-badge {
            background: #10b981;
            color: white;
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-left: 10px;
        }

        .result-badge {
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-left: 10px;
        }

        .badge-appointment { background: #dbeafe; color: #1e40af; }
        .badge-callback { background: #fef3c7; color: #92400e; }
        .badge-voicemail { background: #dcfce7; color: #166534; }
        .badge-dropped { background: #fee2e2; color: #991b1b; }

        .loading {
            text-align: center;
            padding: 60px;
            color: #64748b;
            font-size: 1.2rem;
        }

        .loader {
            width: 50px;
            height: 50px;
            border: 4px solid #e2e8f0;
            border-top: 4px solid #4f46e5;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
            .charts-container {
                grid-template-columns: 1fr;
            }
            
            .stat-number {
                font-size: 2rem;
            }
            
            .call-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>
                <i class="fas fa-chart-line"></i>
                Real-time Call Analytics Dashboard
            </h1>
            <p>Live tracking of all calls, conversions, and customer journeys</p>
            <a href="/dashboard" class="back-btn">
                <i class="fas fa-arrow-left"></i> Back to Dashboard
            </a>
        </div>

        <!-- Stats -->
        <div class="stats-grid" id="statsGrid">
            <!-- Stats will be loaded here -->
        </div>

        <!-- Controls -->
        <div class="controls">
            <button class="filter-btn active" onclick="loadData('today')">
                <i class="fas fa-calendar-day"></i> Today
            </button>
            <button class="filter-btn" onclick="loadData('week')">
                <i class="fas fa-calendar-week"></i> This Week
            </button>
            <button class="filter-btn" onclick="loadData('month')">
                <i class="fas fa-calendar-alt"></i> This Month
            </button>
            <button class="filter-btn" onclick="loadData('all')">
                <i class="fas fa-database"></i> All Time
            </button>
            
            <select class="time-selector" id="timeRange">
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="all">All Time</option>
            </select>
            
            <button class="refresh-btn" onclick="loadData()">
                <i class="fas fa-sync-alt"></i> Refresh Now
            </button>
        </div>

        <!-- Charts -->
        <div class="charts-container">
            <div class="chart-box">
                <div class="chart-title"><i class="fas fa-phone"></i> Calls Over Time</div>
                <canvas id="callsChart"></canvas>
            </div>
            
            <div class="chart-box">
                <div class="chart-title"><i class="fas fa-smile"></i> Customer Sentiment</div>
                <canvas id="sentimentChart"></canvas>
            </div>

            <div class="chart-box">
                <div class="chart-title"><i class="fas fa-clock"></i> Call Duration Distribution</div>
                <canvas id="durationChart"></canvas>
            </div>

            <div class="chart-box">
                <div class="chart-title"><i class="fas fa-bullseye"></i> Call Results</div>
                <canvas id="resultsChart"></canvas>
            </div>
        </div>

        <!-- Recent Calls -->
        <div class="recent-calls">
            <h2 style="margin-bottom: 20px; color: #1e293b;">
                <i class="fas fa-list"></i> Recent Calls (Live)
            </h2>
            
            <div id="recentCallsList">
                <!-- Calls will be loaded here -->
            </div>
        </div>
    </div>

    <script>
        // Charts
        let callsChart, sentimentChart, durationChart, resultsChart;
        let currentTimeframe = 'today';
        
        // Load initial data
        document.addEventListener('DOMContentLoaded', () => {
            loadData('today');
            setInterval(() => loadData(currentTimeframe), 30000); // Auto-refresh every 30 seconds
        });

        async function loadData(timeframe = currentTimeframe) {
            try {
                currentTimeframe = timeframe;
                
                // Update active button
                document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                
                // FIXED LINE - НЕТ ВЛОЖЕННЫХ TEMPLATE LITERALS!
                const selector = \`.filter-btn[onclick*="loadData('"\${timeframe}\`')"]\`;
                const element = document.querySelector(selector);
                if (element) {
                    element.classList.add('active');
                }

                const response = await fetch(\`/api/analytics?timeframe=\${timeframe}\`);
                const data = await response.json();

                updateStats(data.stats);
                updateCharts(data.charts);
                updateRecentCalls(data.recentCalls);

            } catch (error) {
                console.error('Error loading analytics:', error);
            }
        }

        function updateStats(stats) {
            const statsGrid = document.getElementById('statsGrid');
            statsGrid.innerHTML = \`
                <div class="stat-card">
                    <div class="stat-number">\${stats.totalCalls}</div>
                    <div class="stat-label">Total Calls</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.averageDuration}s</div>
                    <div class="stat-label">Avg Duration</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.conversionRate}%</div>
                    <div class="stat-label">Conversion Rate</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.uniqueCallers}</div>
                    <div class="stat-label">Unique Callers</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.positiveSentiment}%</div>
                    <div class="stat-label">Positive Calls</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.appointments}</div>
                    <div class="stat-label">Appointments</div>
                </div>
            \`;
            
            // Animate numbers
            animateStats();
        }

        function animateStats() {
            const statNumbers = document.querySelectorAll('.stat-number');
            statNumbers.forEach(stat => {
                const text = stat.textContent;
                const isPercentage = text.includes('%');
                const numberPart = isPercentage ? text.replace('%', '') : text;
                const target = parseFloat(numberPart) || 0;
                let current = 0;
                const increment = target / 30;
                
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        current = target;
                        clearInterval(timer);
                    }
                    stat.textContent = isPercentage ? 
                        Math.floor(current) + '%' : 
                        Math.floor(current);
                }, 50);
            });
        }

        function updateCharts(chartData) {
            // Calls over time chart
            if (callsChart) callsChart.destroy();
            const callsCtx = document.getElementById('callsChart').getContext('2d');
            callsChart = new Chart(callsCtx, {
                type: 'line',
                data: {
                    labels: chartData.callsOverTime.labels,
                    datasets: [{
                        label: 'Calls',
                        data: chartData.callsOverTime.data,
                        borderColor: '#4f46e5',
                        backgroundColor: 'rgba(79, 70, 229, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            display: true
                        }
                    }
                }
            });

            // Sentiment chart
            if (sentimentChart) sentimentChart.destroy();
            const sentimentCtx = document.getElementById('sentimentChart').getContext('2d');
            sentimentChart = new Chart(sentimentCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Positive', 'Neutral', 'Negative'],
                    datasets: [{
                        data: [chartData.sentiment.positive, chartData.sentiment.neutral, chartData.sentiment.negative],
                        backgroundColor: ['#10b981', '#94a3b8', '#ef4444']
                    }]
                }
            });

            // Duration chart
            if (durationChart) durationChart.destroy();
            const durationCtx = document.getElementById('durationChart').getContext('2d');
            durationChart = new Chart(durationCtx, {
                type: 'bar',
                data: {
                    labels: chartData.duration.labels,
                    datasets: [{
                        label: 'Number of Calls',
                        data: chartData.duration.data,
                        backgroundColor: '#8b5cf6'
                    }]
                }
            });

            // Results chart
            if (resultsChart) resultsChart.destroy();
            const resultsCtx = document.getElementById('resultsChart').getContext('2d');
            resultsChart = new Chart(resultsCtx, {
                type: 'pie',
                data: {
                    labels: chartData.results.labels,
                    datasets: [{
                        data: chartData.results.data,
                        backgroundColor: ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6']
                    }]
                }
            });
        }

        function updateRecentCalls(calls) {
            const recentCallsList = document.getElementById('recentCallsList');
            
            if (!calls || calls.length === 0) {
                recentCallsList.innerHTML = \`
                    <div style="text-align: center; padding: 40px; color: #64748b;">
                        <i class="fas fa-phone-slash" style="font-size: 2rem; margin-bottom: 10px;"></i>
                        <p>No recent calls found</p>
                    </div>
                \`;
                return;
            }
            
            let html = '';
            
            calls.forEach(call => {
                const sentimentClass = \`sentiment-\${call.sentiment || 'neutral'}\`;
                const resultClass = \`badge-\${call.result?.replace('_', '-') || 'unknown'}\`;
                const resultText = call.result ? call.result.replace('_', ' ').toUpperCase() : 'UNKNOWN';
                const time = call.time || new Date(call.timestamp).toLocaleTimeString();
                
                html += \`
                    <div class="call-item">
                        <div class="call-header">
                            <div>
                                <span class="phone-number">\${call.phone}</span>
                                <span class="sentiment \${sentimentClass}">
                                    \${call.sentiment || 'neutral'}
                                </span>
                                <span class="result-badge \${resultClass}">
                                    \${resultText}
                                </span>
                                \${call.conversion ? '<span class="conversion-badge">CONVERTED</span>' : ''}
                            </div>
                            <div>\${time}</div>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>Duration:</strong> \${call.duration || 0} seconds
                        </div>
                        <div style="margin-bottom: 5px;">
                            <strong>Options:</strong> \${call.optionsSelected ? call.optionsSelected.join(', ') : 'None'}
                        </div>
                        \${call.transcript ? \`
                            <div style="margin-top: 10px; padding: 10px; background: #f8fafc; border-radius: 5px;">
                                <strong>Last message:</strong> "\${call.transcript.length > 80 ? call.transcript.substring(0, 80) + '...' : call.transcript}"
                            </div>
                        \` : ''}
                    </div>
                \`;
            });
            
            recentCallsList.innerHTML = html;
        }
    </script>
</body>
</html>
`;

// ======================================================
// НОВЫЕ API ЭНДПОИНТЫ
// ======================================================

// Callbacks Dashboard (PROTECTED)
app.get('/callbacks-dashboard', requireAuth, (req, res) => {
  res.send(CALLBACKS_HTML);
});

// Voicemails Dashboard (PROTECTED)
app.get('/voicemails-dashboard', requireAuth, (req, res) => {
  res.send(VOICEMAILS_HTML);
});

// Analytics Dashboard (PROTECTED)
app.get('/analytics-dashboard', requireAuth, (req, res) => {
  res.send(ANALYTICS_HTML);
});

// API: Получить callbacks
app.get('/api/callbacks', requireAuth, (req, res) => {
  try {
    let callbacks = [];
    
    if (fs.existsSync(CALLBACKS_PATH)) {
      const fileData = fs.readFileSync(CALLBACKS_PATH, "utf8");
      callbacks = JSON.parse(fileData || '[]');
    }
    
    res.json({
      success: true,
      total: callbacks.length,
      callbacks: callbacks.reverse(),
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("Error loading callbacks:", error);
    res.status(500).json({ success: false, error: "Failed to load callbacks" });
  }
});

// API: Отметить callback как выполненный
app.post('/api/callbacks/:phone/complete', requireAuth, async (req, res) => {
  try {
    const { phone } = req.params;
    const completed = markCallbackAsCompleted(phone);
    
    if (completed) {
      res.json({ success: true, message: "Callback marked as completed" });
    } else {
      res.status(404).json({ success: false, error: "Callback not found" });
    }
    
  } catch (error) {
    console.error("Error marking callback as completed:", error);
    res.status(500).json({ success: false, error: "Failed to mark callback" });
  }
});

// API: Удалить callback
app.delete('/api/callbacks/:phone', requireAuth, (req, res) => {
  try {
    const { phone } = req.params;
    
    if (!fs.existsSync(CALLBACKS_PATH)) {
      return res.status(404).json({ success: false, error: "No callbacks found" });
    }
    
    const fileData = fs.readFileSync(CALLBACKS_PATH, "utf8");
    let callbacks = JSON.parse(fileData || '[]');
    
    const initialLength = callbacks.length;
    callbacks = callbacks.filter(cb => cb.phone !== phone);
    
    if (callbacks.length === initialLength) {
      return res.status(404).json({ success: false, error: "Callback not found" });
    }
    
    fs.writeFileSync(CALLBACKS_PATH, JSON.stringify(callbacks, null, 2));
    
    res.json({ success: true, message: "Callback deleted" });
    
  } catch (error) {
    console.error("Error deleting callback:", error);
    res.status(500).json({ success: false, error: "Failed to delete callback" });
  }
});

// API: Получить voicemails
app.get('/api/voicemails', requireAuth, (req, res) => {
  try {
    const voicemailFile = `${VOICEMAILS_DIR}/voicemails.json`;
    let voicemails = [];
    
    if (fs.existsSync(voicemailFile)) {
      const fileData = fs.readFileSync(voicemailFile, "utf8");
      voicemails = JSON.parse(fileData || '[]');
    }
    
    res.json({
      success: true,
      total: voicemails.length,
      voicemails: voicemails.reverse(),
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("Error loading voicemails:", error);
    res.status(500).json({ success: false, error: "Failed to load voicemails" });
  }
});

// API: Отметить voicemail как прослушанный
app.post('/api/voicemails/:phone/:timestamp/listen', requireAuth, async (req, res) => {
  try {
    const { phone, timestamp } = req.params;
    const voicemailFile = `${VOICEMAILS_DIR}/voicemails.json`;
    
    if (!fs.existsSync(voicemailFile)) {
      return res.status(404).json({ success: false, error: "No voicemails found" });
    }
    
    const fileData = fs.readFileSync(voicemailFile, "utf8");
    let voicemails = JSON.parse(fileData || '[]');
    
    let updated = false;
    voicemails = voicemails.map(vm => {
      if (vm.phone === phone && vm.timestamp === timestamp) {
        updated = true;
        return { ...vm, listened: true };
      }
      return vm;
    });
    
    if (!updated) {
      return res.status(404).json({ success: false, error: "Voicemail not found" });
    }
    
    fs.writeFileSync(voicemailFile, JSON.stringify(voicemails, null, 2));
    
    res.json({ success: true, message: "Voicemail marked as listened" });
    
  } catch (error) {
    console.error("Error marking voicemail as listened:", error);
    res.status(500).json({ success: false, error: "Failed to mark voicemail" });
  }
});

// API: Удалить voicemail
app.delete('/api/voicemails/:phone/:timestamp', requireAuth, (req, res) => {
  try {
    const { phone, timestamp } = req.params;
    const voicemailFile = `${VOICEMAILS_DIR}/voicemails.json`;
    
    if (!fs.existsSync(voicemailFile)) {
      return res.status(404).json({ success: false, error: "No voicemails found" });
    }
    
    const fileData = fs.readFileSync(voicemailFile, "utf8");
    let voicemails = JSON.parse(fileData || '[]');
    
    const initialLength = voicemails.length;
    voicemails = voicemails.filter(vm => !(vm.phone === phone && vm.timestamp === timestamp));
    
    if (voicemails.length === initialLength) {
      return res.status(404).json({ success: false, error: "Voicemail not found" });
    }
    
    fs.writeFileSync(voicemailFile, JSON.stringify(voicemails, null, 2));
    
    res.json({ success: true, message: "Voicemail deleted" });
    
  } catch (error) {
    console.error("Error deleting voicemail:", error);
    res.status(500).json({ success: false, error: "Failed to delete voicemail" });
  }
});

// API: Получить аналитику
app.get('/api/analytics', requireAuth, (req, res) => {
  try {
    const timeframe = req.query.timeframe || 'today';
    
    // Загружаем аналитику
    let allAnalytics = [];
    if (fs.existsSync(ANALYTICS_PATH)) {
      const data = fs.readFileSync(ANALYTICS_PATH, "utf8");
      allAnalytics = JSON.parse(data || '[]');
    }
    
    // Фильтруем по времени
    const filteredAnalytics = filterByTimeframe(allAnalytics, timeframe);
    
    // Вычисляем статистику
    const stats = calculateStats(filteredAnalytics);
    const charts = prepareChartData(filteredAnalytics);
    
    // Получаем недавние звонки
    const recentCalls = filteredAnalytics
      .slice(-20)
      .reverse()
      .map(call => ({
        phone: call.phone,
        time: call.endTime ? new Date(call.endTime).toLocaleTimeString() : 'N/A',
        duration: call.totalDuration || 0,
        sentiment: call.sentiment || 'neutral',
        result: call.callResult || 'unknown',
        conversion: call.conversion || false,
        optionsSelected: call.optionsSelected || [],
        transcript: call.speechTranscripts && call.speechTranscripts.length > 0 
          ? call.speechTranscripts[call.speechTranscripts.length - 1]?.text || ''
          : '',
        timestamp: call.endTime || call.timestamp
      }));
    
    res.json({
      success: true,
      timeframe,
      totalRecords: filteredAnalytics.length,
      stats,
      charts,
      recentCalls
    });
    
  } catch (error) {
    console.error("Error loading analytics:", error);
    res.status(500).json({ success: false, error: "Failed to load analytics" });
  }
});

// Вспомогательные функции для аналитики
function filterByTimeframe(data, timeframe) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return data.filter(item => {
    const itemDate = new Date(item.endTime || item.timestamp || item.startTime);
    
    switch(timeframe) {
      case 'today':
        return itemDate >= today;
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        return itemDate >= weekAgo;
      case 'month':
        const monthAgo = new Date(today);
        monthAgo.setMonth(today.getMonth() - 1);
        return itemDate >= monthAgo;
      default:
        return true; // all time
    }
  });
}

function calculateStats(data) {
  if (data.length === 0) {
    return {
      totalCalls: 0,
      averageDuration: 0,
      conversionRate: 0,
      uniqueCallers: 0,
      positiveSentiment: 0,
      appointments: 0
    };
  }
  
  const totalCalls = data.length;
  const totalDuration = data.reduce((sum, call) => sum + (call.totalDuration || 0), 0);
  const averageDuration = Math.round(totalDuration / totalCalls);
  
  const appointments = data.filter(call => call.callResult === 'appointment_scheduled').length;
  const conversionRate = Math.round((appointments / totalCalls) * 100);
  
  const uniquePhones = new Set(data.map(call => call.phone));
  
  const positiveCalls = data.filter(call => call.sentiment === 'positive').length;
  const positiveSentiment = Math.round((positiveCalls / totalCalls) * 100);
  
  return {
    totalCalls,
    averageDuration,
    conversionRate,
    uniqueCallers: uniquePhones.size,
    positiveSentiment,
    appointments
  };
}

function prepareChartData(data) {
  // Группируем по часам для графика звонков
  const callsByHour = {};
  for (let i = 0; i < 24; i++) {
    callsByHour[i] = 0;
  }
  
  data.forEach(call => {
    const hour = new Date(call.startTime || call.timestamp).getHours();
    callsByHour[hour]++;
  });
  
  // Сентимент
  const sentiment = {
    positive: data.filter(c => c.sentiment === 'positive').length,
    neutral: data.filter(c => c.sentiment === 'neutral').length,
    negative: data.filter(c => c.sentiment === 'negative').length
  };
  
  // Длительность звонков
  const durationRanges = ['<30s', '30-60s', '1-3m', '3-5m', '5-10m', '>10m'];
  const durationCounts = [0, 0, 0, 0, 0, 0];
  
  data.forEach(call => {
    const duration = call.totalDuration || 0;
    if (duration < 30) durationCounts[0]++;
    else if (duration < 60) durationCounts[1]++;
    else if (duration < 180) durationCounts[2]++;
    else if (duration < 300) durationCounts[3]++;
    else if (duration < 600) durationCounts[4]++;
    else durationCounts[5]++;
  });
  
  // Результаты звонков
  const results = {
    'appointment_scheduled': data.filter(c => c.callResult === 'appointment_scheduled').length,
    'callback_requested': data.filter(c => c.callResult === 'callback_requested').length,
    'voice_message_recorded': data.filter(c => c.callResult === 'voice_message_recorded').length,
    'dropped_call': data.filter(c => c.callResult === 'dropped_call').length,
    'completed_call': data.filter(c => c.callResult === 'completed_call').length
  };
  
  // Убираем нулевые результаты
  const resultLabels = [];
  const resultData = [];
  
  Object.entries(results).forEach(([key, value]) => {
    if (value > 0) {
      resultLabels.push(key.replace('_', ' '));
      resultData.push(value);
    }
  });
  
  return {
    callsOverTime: {
      labels: Object.keys(callsByHour).map(h => `${h}:00`),
      data: Object.values(callsByHour)
    },
    sentiment,
    duration: {
      labels: durationRanges,
      data: durationCounts
    },
    results: {
      labels: resultLabels,
      data: resultData
    }
  };
}

// ======================================================
// IVR LOGIC - С НОВЫМИ VOICEMAIL И CALLBACK СИСТЕМАМИ
// ======================================================

app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("📞 Main menu - Caller:", phone);
  
  logCall(phone, 'CALL_RECEIVED', {
    caller: phone,
    time: new Date().toLocaleTimeString(),
    deviceType: detectDevice(req)
  });
  
  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST',
    timeout: 10
  });

  gather.say(
    "Thank you for choosing Altair Partners. This call may be monitored for quality assurance. " +
    "Press 1 to schedule an appointment. " +
    "Press 2 to speak with a representative. " +
    "Press 3 to request a callback. " +
    "Press 4 for partnership opportunities. " +
    "Press 7 to talk with a creative director.",
    { voice: 'alice', language: 'en-US' }
  );

  twiml.say("Please select an option.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/voice');

  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// VOICEMAIL RECORDING SYSTEM
// ======================================================

app.post('/start-voicemail-recording', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log(`🎤 Starting voicemail recording for: ${phone}`);
  
  logCall(phone, 'VOICEMAIL_RECORDING_STARTED');
  
  twiml.say(
    "Please leave your message after the beep. When you are finished, press pound or simply hang up.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.record({
    action: '/process-voicemail-recording',
    method: 'POST',
    maxLength: 120,
    finishOnKey: '#',
    playBeep: true,
    recordingStatusCallback: '/voicemail-recording-status',
    recordingStatusCallbackMethod: 'POST'
  });
  
  twiml.say("I did not receive your recording. Goodbye.", { voice: 'alice', language: 'en-US' });
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-voicemail-recording', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  const recordingUrl = req.body.RecordingUrl;
  const duration = req.body.RecordingDuration;
  
  console.log(`🎤 Voicemail recording received: ${phone}, duration: ${duration}s`);
  console.log(`📁 Recording URL: ${recordingUrl}`);
  
  // Сохраняем запись
  const voicemail = saveVoicemailRecording(phone, recordingUrl, duration);
  
  if (voicemail) {
    // Отправляем уведомление админу
    sendVoicemailNotification(phone, recordingUrl, duration);
  }
  
  twiml.say(
    "Thank you for your message. We will get back to you as soon as possible. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  
  logCall(phone, 'VOICEMAIL_RECORDING_COMPLETED', {
    recordingUrl,
    duration
  });
  
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/voicemail-recording-status', (req, res) => {
  const status = req.body.RecordingStatus;
  const phone = req.body.From;
  
  console.log(`🎤 Voicemail recording status: ${status} for ${phone}`);
  
  res.status(200).send('OK');
});

// ======================================================
// CALLBACK REQUEST SYSTEM (УЛУЧШЕННАЯ)
// ======================================================

app.post('/callback-request', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log(`📞 Callback request from: ${phone}`);
  
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-callback-reason',
    method: 'POST',
    speechTimeout: 5,
    timeout: 10,
    speechModel: 'phone_call'
  });
  
  gather.say(
    "Please tell us briefly why you're requesting a callback. After your message, you can press any key or wait for the beep.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear your reason. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/callback-request');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-callback-reason', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  const reason = req.body.SpeechResult || '';
  const digits = req.body.Digits;
  
  console.log(`📞 Callback reason: ${reason} from ${phone}`);
  
  // Сохраняем callback запрос
  const callback = saveCallbackRequest(phone, { reason });
  
  if (callback) {
    // Отправляем уведомление админу
    sendCallbackNotification(phone);
  }
  
  twiml.say(
    "Thank you. Your callback request has been submitted. We'll call you back as soon as possible. " +
    "Thank you for choosing Altair Partners. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  
  logCall(phone, 'CALLBACK_REQUESTED', { reason });
  
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// MAIN MENU HANDLER
// ======================================================

app.post('/handle-key', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.body.From;

  console.log(`🔘 Menu option ${digit} - Phone: ${phone}`);
  
  logCall(phone, `MENU_OPTION_${digit}`, {
    option: digit,
    deviceType: detectDevice(req)
  });

  if (!digit) {
    twiml.say("Invalid input. Please try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    console.log("📅 Option 1 - Schedule appointment");
    const appt = findAppointment(phone);

    if (appt) {
      const gather = twiml.gather({
        numDigits: 1,
        action: `/appointment-manage?phone=${encodeURIComponent(phone)}`,
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I see you have an appointment scheduled on ${appt.date} at ${appt.time}. ` +
        "Press 1 to cancel this appointment. Press 2 to reschedule.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
      twiml.redirect('/voice');

    } else {
      twiml.say("I don't see you in our appointment database. Let me ask you a few questions to schedule an appointment.", 
        { voice: 'alice', language: 'en-US' });
      twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    }
  }

  else if (digit === '2') {
    console.log("👤 Option 2 - Representative");
    
    if (isWithinBusinessHours()) {
      twiml.redirect('/connect-representative');
    } else {
      const nextOpenTime = getTimeUntilOpen();
      const gather = twiml.gather({
        numDigits: 1,
        action: '/closed-hours-options',
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
        "To request a callback, press 1. To leave a voicemail, press 2. " +
        "To return to the main menu, press 9.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();
    }
  }

  else if (digit === '3') {
    console.log("📞 Option 3 - Callback request");
    twiml.redirect('/callback-request');
  }

  else if (digit === '4') {
    console.log("🤝 Option 4 - Partnership");
    twiml.redirect('/partnership');
  }

  else if (digit === '7') {
    console.log("🎨 Option 7 - Creative Director");
    
    if (isWithinBusinessHours()) {
      twiml.redirect('/creative-director');
    } else {
      const nextOpenTime = getTimeUntilOpen();
      const gather = twiml.gather({
        numDigits: 1,
        action: '/closed-hours-options',
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
        "To request a callback, press 1. To leave a voicemail, press 2. " +
        "To return to the main menu, press 9.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();
    }
  }

  else {
    twiml.say("Invalid option. Please try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// CLOSED HOURS OPTIONS
// ======================================================
app.post('/closed-hours-options', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.body.From;

  console.log(`🔘 Closed hours option ${digit} - Phone: ${phone}`);
  
  logCall(phone, `CLOSED_HOURS_OPTION_${digit}`);

  if (!digit) {
    twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    console.log("📞 Callback request during closed hours");
    
    twiml.say(
      "Your callback request has been submitted. We'll call you back during our next business hours. " +
      "Thank you for calling Altair Partners. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    
    try {
      twilioClient.messages.create({
        body: `📞 AFTER-HOURS Callback requested from ${phone} (Closed hours)`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: '+15035442571'
      });
      console.log(`📱 After-hours callback notification sent to admin`);
    } catch (err) {
      console.log("ERROR sending admin notification:", err);
    }
    
    logCall(phone, 'AFTER_HOURS_CALLBACK_REQUESTED');
    twiml.hangup();
  }

  else if (digit === '2') {
    console.log("🎤 Voice message during closed hours");
    
    const gather = twiml.gather({
      input: 'speech',
      action: '/record-voice-message',
      method: 'POST',
      speechTimeout: 10,
      timeout: 30,
      speechModel: 'phone_call',
      enhanced: true
    });
    
    gather.say(
      "Please leave your voice message after the beep. When you are finished, simply hang up or press the pound key.",
      { voice: 'alice', language: 'en-US' }
    );
    
    twiml.say("I didn't hear your message. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/closed-hours-options');
  }

  else if (digit === '9') {
    twiml.say("Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  else {
    twiml.say("Invalid option. Goodbye.", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/record-voice-message', (req, res) => {
  const twiml = new VoiceResponse();
  const message = req.body.SpeechResult || '';
  const phone = req.body.From;

  console.log(`🎤 Voice message recorded from: ${phone}`);
  console.log(`📝 Message: ${message.substring(0, 100)}...`);
  
  if (message && message.trim() !== '') {
    try {
      twilioClient.messages.create({
        body: `🎤 AFTER-HOURS VOICE MESSAGE from ${phone}:\n\n"${message.substring(0, 300)}"`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: '+15035442571'
      });
      console.log(`📱 Voice message notification sent to admin`);
    } catch (err) {
      console.log("ERROR sending voice message notification:", err);
    }
    
    logCall(phone, 'VOICE_MESSAGE_RECORDED', {
      messageLength: message.length,
      preview: message.substring(0, 100)
    });
    
    twiml.say(
      "Thank you for your message. We will get back to you during our next business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
  } else {
    twiml.say(
      "I didn't hear your message. Please try again or call back during business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
  }
  
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// ======================================================
// REPRESENTATIVE (Option 2) - FAST AI
// ======================================================
app.post('/connect-representative', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("👤 Representative - asking for reason");
  
  if (!isWithinBusinessHours()) {
    const nextOpenTime = getTimeUntilOpen();
    twiml.say(
      `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
      "Please call back during business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  
  logCall(phone, 'REPRESENTATIVE_SELECTED');

  const gather = twiml.gather({
    input: 'speech',
    action: '/confirm-reason',
    method: 'POST',
    speechTimeout: 5,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(
    "Before I connect you with a representative, please tell me the reason for your call.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear your reason. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/connect-representative');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/confirm-reason', (req, res) => {
  const twiml = new VoiceResponse();
  const reason = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`❓ Call reason: ${reason}`);
  
  if (!reason || reason.trim() === '') {
    twiml.say("I didn't hear your reason. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/connect-representative');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/start-rings?reason=${encodeURIComponent(reason)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`You are calling about: ${reason}. Is this correct? Say yes or no.`, 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's start over.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/connect-representative');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/start-rings', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const reason = req.query.reason;
  const phone = req.body.From;
  
  console.log(`✅ Reason confirmed: ${reason} - Response: ${response}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. Please tell me the reason for your call.", 
      { voice: 'alice', language: 'en-US' });
    twiml.redirect('/connect-representative');
    return res.type('text/xml').send(twiml.toString());
  }
  
  twiml.say("Okay, wait while I transfer you. Please hold.", 
    { voice: 'alice', language: 'en-US' });
  
  for (let i = 0; i < 3; i++) {
    twiml.play({ digits: 'w' });
    twiml.play({ digits: '1' });
    twiml.pause({ length: 1 });
  }
  
  twiml.say(
    "The wait time is greater than average, so I will help you with that. ",
    { voice: 'alice', language: 'en-US' }
  );
  
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-rep-question',
    method: 'POST',
    speechTimeout: 2,
    timeout: 8,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("What would you like to know?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your question. Let me transfer you back to the main menu.");
  twiml.redirect('/voice');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-rep-question', async (req, res) => {
  const twiml = new VoiceResponse();
  const question = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`🤖 Processing question: ${question}`);
  
  if (!question || question.trim() === '') {
    twiml.say("I didn't hear your question. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/process-rep-question');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const aiResponse = await getRepResponse(question, phone);
  
  logAIConversation(phone, question, aiResponse);
  
  twiml.say(aiResponse, { voice: 'alice', language: 'en-US' });
  
  const lowerQuestion = question.toLowerCase();
  
  if (lowerQuestion.includes('appointment') || 
      lowerQuestion.includes('book') || 
      lowerQuestion.includes('schedule') ||
      lowerQuestion.includes('meeting') ||
      lowerQuestion.includes('appoint')) {
    
    twiml.pause({ length: 0.5 });
    twiml.say("Transferring you to our booking system now.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/transfer-to-appointment');
    return res.type('text/xml').send(twiml.toString());
  }
  
  if (lowerQuestion.includes('bye') || 
      lowerQuestion.includes('thank you') || 
      lowerQuestion.includes('thanks') ||
      lowerQuestion.includes('goodbye') ||
      lowerQuestion.includes('that\'s all')) {
    
    twiml.say("Thank you for calling Altair Partners. Goodbye!", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-rep-question',
    method: 'POST',
    speechTimeout: 2,
    timeout: 8
  });
  
  gather.say("What else can I help you with?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("Or press any key to return to main menu.");
  twiml.redirect('/voice');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// CREATIVE DIRECTOR (Option 7)
// ======================================================
app.post('/creative-director', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("🎨 Creative Director - asking for details");
  
  if (!isWithinBusinessHours()) {
    const nextOpenTime = getTimeUntilOpen();
    twiml.say(
      `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
      "Please call back during business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  
  logCall(phone, 'CREATIVE_DIRECTOR_SELECTED');

  const gather = twiml.gather({
    input: 'speech',
    action: '/check-creative-question',
    method: 'POST',
    speechTimeout: 5,
    timeout: 15,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(
    "What exactly are you calling about? Maybe I can help you with that.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear your question. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/creative-director');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/check-creative-question', (req, res) => {
  const twiml = new VoiceResponse();
  const question = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`🎨 Creative Director question: ${question}`);
  
  if (!question || question.trim() === '') {
    twiml.say("I didn't hear your question. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/creative-director');
    return res.type('text/xml').send(twiml.toString());
  }
  
  if (isSeriousQuestion(question)) {
    console.log(`🚨 SERIOUS QUESTION detected: ${question}`);
    
    logCall(phone, 'SERIOUS_QUESTION_DETECTED', {
      question,
      category: 'legal/money'
    });
    
    try {
      twilioClient.calls.create({
        url: 'http://demo.twilio.com/docs/voice.xml',
        to: '+15035442571',
        from: process.env.TWILIO_PHONE_NUMBER
      });
      console.log(`📞 Calling creative director about serious matter: ${question}`);
    } catch (err) {
      console.log("ERROR calling director:", err);
    }
    
    twiml.say(
      "I understand this is important. Our creative director has been notified and will review your inquiry shortly. " +
      "Would you like to schedule an appointment to discuss this further?",
      { voice: 'alice', language: 'en-US' }
    );
    
    const gather = twiml.gather({
      input: 'speech dtmf',
      action: '/creative-appointment-check',
      method: 'POST',
      speechTimeout: 3,
      timeout: 8
    });
    
    gather.say("Say yes or no.", { voice: 'alice', language: 'en-US' });
    
    twiml.say("Returning to main menu.");
    twiml.redirect('/voice');
    
  } else {
    twiml.say(
      "Perfect! You talked about that. Would you like to schedule an appointment with us?",
      { voice: 'alice', language: 'en-US' }
    );
    
    const gather = twiml.gather({
      input: 'speech dtmf',
      action: '/creative-appointment-check',
      method: 'POST',
      speechTimeout: 3,
      timeout: 8
    });
    
    gather.say("Say yes or no.", { voice: 'alice', language: 'en-US' });
    
    twiml.say("Returning to main menu.");
    twiml.redirect('/voice');
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/creative-appointment-check', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('yes') || lowerResponse === '1') {
    twiml.say("Great! Transferring you to our booking system.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/transfer-to-appointment');
  } else {
    twiml.say("Okay. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// APPOINTMENT FLOW
// ======================================================
app.post('/get-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  
  console.log(`📝 Getting name for: ${phone}`);
  
  logCall(phone, 'APPOINTMENT_FLOW_STARTED');

  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-name?phone=${encodeURIComponent(phone)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("First question: What is your full name?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your name. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-name', (req, res) => {
  const twiml = new VoiceResponse();
  const name = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  
  console.log(`📝 Name received: ${name} for ${phone}`);
  
  if (!name || name.trim() === '') {
    twiml.say("Sorry, I didn't catch your name. Let's try again.", { voice: 'alice', language: 'en-US' });
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
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/get-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log(`📝 Name verification: ${response} for ${name}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What is your full name?", { voice: 'alice', language: 'en-US' });
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
  
  gather.say(`Thanks ${name}. Second question: What type of business do you have?`, 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your business type. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const businessType = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log(`🏢 Business type: ${businessType} for ${name}`);
  
  if (!businessType || businessType.trim() === '') {
    twiml.say("Sorry, I didn't catch your business type. Let's try again.", { voice: 'alice', language: 'en-US' });
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
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
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
  
  console.log(`🏢 Business verification: ${response} for ${businessType}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What type of business do you have?", { voice: 'alice', language: 'en-US' });
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
  
  gather.say("Third question: What type of service are you looking for?", 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your service type. Please try again.", { voice: 'alice', language: 'en-US' });
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
  
  console.log(`🔧 Service type: ${serviceType} for ${name}`);
  
  if (!serviceType || serviceType.trim() === '') {
    twiml.say("Sorry, I didn't catch your service type. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/schedule-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${serviceType}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/schedule-date', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  const serviceType = decodeURIComponent(req.query.serviceType || '');
  
  console.log(`🔧 Service verification: ${response} for ${serviceType}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What type of service are you looking for?", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const nextDate = getNextAvailableDate();
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/schedule-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}&date=${encodeURIComponent(nextDate)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(
    `Perfect. The next available date is ${nextDate}. ` +
    "What time works for you on that day? Please say the time including AM or PM.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear a time. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/schedule-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/schedule-time', (req, res) => {
  const twiml = new VoiceResponse();
  const time = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  const serviceType = decodeURIComponent(req.query.serviceType || '');
  const date = decodeURIComponent(req.query.date || '');
  
  console.log(`⏰ Time received: ${time} for ${date}`);
  
  if (!time || time.trim() === '') {
    twiml.say("Sorry, I didn't catch the time. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/schedule-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  let cleanedTime = time.trim()
    .replace(/NPM/gi, 'PM')
    .replace(/MPM/gi, 'PM')
    .replace(/AMM/gi, 'AM')
    .replace(/B ?M/gi, 'PM')
    .replace(/A ?M/gi, 'AM')
    .replace(/P ?M/gi, 'PM')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (!cleanedTime.toLowerCase().includes('pacific') && !cleanedTime.toLowerCase().includes('pt')) {
    cleanedTime = `${cleanedTime} Pacific Time`;
  }
  
  const existingAppt = findAppointment(phone);
  if (existingAppt) {
    twiml.say(
      "I see you already have an existing appointment. Please cancel it first before scheduling a new one. " +
      "Returning to main menu.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const appointmentSaved = addAppointment(name, phone, businessType, serviceType, date, cleanedTime);
  
  if (appointmentSaved) {
    try {
      twilioClient.messages.create({
        body: `✅ Thank you for your appointment with Altair Partners!\n\n` +
              `Your appointment: ${date} at ${cleanedTime}\n` +
              `Name: ${name}\n` +
              `Business: ${businessType}\n` +
              `Service: ${serviceType}\n\n` +
              `For further communication with our creative director, please reply with your email address.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone
      });
      console.log(`📱 SMS sent to client ${phone}`);
    } catch (err) {
      console.log("ERROR sending SMS to client:", err);
    }
    
    try {
      twilioClient.messages.create({
        body: `📅 NEW APPOINTMENT\n` +
              `Name: ${name}\n` +
              `Phone: ${phone}\n` +
              `Date: ${date} at ${cleanedTime}\n` +
              `Business: ${businessType}\n` +
              `Service: ${serviceType}\n` +
              `⏰ Reminder: Will call ONE DAY BEFORE at 2 PM Pacific Time`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: '+15035442571'
      });
      console.log(`📱 Notification sent to admin`);
    } catch (err) {
      console.log("ERROR sending admin notification:", err);
    }
  }
  
  twiml.say(
    `Excellent! Your appointment has been scheduled for ${date} at ${cleanedTime}. ` +
    "You will receive an SMS shortly. Please check your messages and reply with your email address " +
    "for further communication with our creative director. We will also call you ONE DAY BEFORE " +
    "your appointment at 2 PM Pacific Time as a reminder. Thank you for choosing Altair Partners!",
    { voice: 'alice', language: 'en-US' }
  );
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// PARTNERSHIP (Option 4)
// ======================================================
app.post('/partnership', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("🤝 Partnership inquiry");
  
  logCall(phone, 'PARTNERSHIP_INQUIRY');

  twiml.say(
    "Thank you for your interest in partnership opportunities. " +
    "Please email us at partners@altairpartners.com for more information. " +
    "Thank you for choosing Altair Partners. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// CANCEL / RESCHEDULE APPOINTMENT
// ======================================================
app.post('/appointment-manage', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.query.phone;

  console.log(`❌ Managing appointment for: ${phone}`);
  
  logCall(phone, `APPOINTMENT_MANAGE_${digit}`);

  if (!digit) {
    twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    let db = loadDB();
    const normalizedPhone = phone.replace(/\D/g, '');
    const initialLength = db.length;
    
    db = db.filter(a => {
      const normalizedApptPhone = a.phone.replace(/\D/g, '');
      return normalizedApptPhone !== normalizedPhone;
    });
    
    if (db.length < initialLength) {
      saveDB(db);
      console.log(`❌ Appointment cancelled for ${phone}`);
      
      logCall(phone, 'APPOINTMENT_CANCELLED');
      
      twiml.say("Your appointment has been cancelled. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();
    } else {
      twiml.say("No appointment found to cancel. Returning to main menu.", { voice: 'alice', language: 'en-US' });
      twiml.redirect('/voice');
    }
  }

  else if (digit === '2') {
    let db = loadDB();
    const normalizedPhone = phone.replace(/\D/g, '');
    
    db = db.filter(a => {
      const normalizedApptPhone = a.phone.replace(/\D/g, '');
      return normalizedApptPhone !== normalizedPhone;
    });
    
    saveDB(db);
    
    console.log(`🔄 Rescheduling for: ${phone}`);
    logCall(phone, 'APPOINTMENT_RESCHEDULE_STARTED');
    twiml.say("Let's reschedule your appointment.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  }

  else {
    twiml.say("Invalid option. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// TRANSFER TO APPOINTMENT FLOW
// ======================================================
app.post('/transfer-to-appointment', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log(`🔀 Transferring to appointment flow: ${phone}`);
  
  twiml.say("Transferring you to our appointment scheduling system.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// TEST REMINDER ENDPOINT
// ======================================================
app.post('/test-reminder', (req, res) => {
  const phone = req.body.phone || req.query.phone;
  
  if (!phone) {
    return res.status(400).json({ error: "Phone number required" });
  }
  
  console.log(`🔔 Manual test trigger for phone: ${phone}`);
  
  // Find appointment for this phone
  const db = loadDB();
  const appointment = db.find(a => a.phone === phone);
  
  if (!appointment) {
    return res.status(404).json({ error: "No appointment found for this phone" });
  }
  
  console.log(`🔔 Sending test reminder to: ${phone} for appointment: ${appointment.date} at ${appointment.time}`);
  
  sendReminderCall(phone, appointment);
  
  res.json({ 
    status: 'test_triggered', 
    phone, 
    appointment,
    message: 'Test reminder call initiated' 
  });
});

// ======================================================
// BUSINESS HOURS ENDPOINT
// ======================================================
app.get('/business-status', (req, res) => {
  const businessStatus = getBusinessStatus();
  
  res.json({
    isOpen: businessStatus.isOpen,
    currentTime: businessStatus.currentTime,
    nextOpenTime: businessStatus.nextOpenTime,
    businessHours: businessStatus.hours,
    location: businessStatus.location,
    message: businessStatus.isOpen ? 
      "We are currently open!" : 
      `We are currently closed. ${businessStatus.nextOpenTime}`
  });
});

// ======================================================
// DEBUG И ДРУГИЕ ЭНДПОИНТЫ
// ======================================================

app.get('/health', (req, res) => {
  res.status(200).send('✅ IVR Server is running');
});

app.get('/debug', requireAuth, (req, res) => {
  const appointments = loadDB();
  const businessStatus = getBusinessStatus();
  
  let callLogs = [];
  let aiConversations = [];
  let reminderLogs = [];
  let analyticsData = [];
  let callbackData = [];
  let voicemailData = [];
  
  try {
    if (fs.existsSync(CALL_LOGS_PATH)) {
      const logsData = fs.readFileSync(CALL_LOGS_PATH, "utf8");
      callLogs = JSON.parse(logsData || '[]');
    }
    
    if (fs.existsSync(AI_CONVERSATIONS_PATH)) {
      const convData = fs.readFileSync(AI_CONVERSATIONS_PATH, "utf8");
      aiConversations = JSON.parse(convData || '[]');
    }
    
    if (fs.existsSync(REMINDERS_LOG)) {
      const remData = fs.readFileSync(REMINDERS_LOG, "utf8");
      reminderLogs = JSON.parse(remData || '[]');
    }
    
    if (fs.existsSync(ANALYTICS_PATH)) {
      const analytics = fs.readFileSync(ANALYTICS_PATH, "utf8");
      analyticsData = JSON.parse(analytics || '[]');
    }
    
    if (fs.existsSync(CALLBACKS_PATH)) {
      const callbackFile = fs.readFileSync(CALLBACKS_PATH, "utf8");
      callbackData = JSON.parse(callbackFile || '[]');
    }
    
    const voicemailFile = `${VOICEMAILS_DIR}/voicemails.json`;
    if (fs.existsSync(voicemailFile)) {
      const voicemailContent = fs.readFileSync(voicemailFile, "utf8");
      voicemailData = JSON.parse(voicemailContent || '[]');
    }
  } catch (error) {
    console.error("ERROR loading logs:", error);
  }
  
  // Рассчитываем статистику
  const totalCalls = analyticsData.length;
  const appointmentsMade = analyticsData.filter(a => a.callResult === 'appointment_scheduled').length;
  const callbacksRequested = analyticsData.filter(a => a.callResult === 'callback_requested').length;
  const voicemailsRecorded = analyticsData.filter(a => a.callResult === 'voice_message_recorded').length;
  const conversionRate = totalCalls > 0 ? Math.round((appointmentsMade / totalCalls) * 100) : 0;
  const averageDuration = totalCalls > 0 ? 
    Math.round(analyticsData.reduce((sum, a) => sum + (a.totalDuration || 0), 0) / totalCalls) : 0;
  
  res.json({
    status: 'running',
    businessStatus,
    analytics: {
      totalCalls,
      appointmentsMade,
      callbacksRequested,
      voicemailsRecorded,
      conversionRate: `${conversionRate}%`,
      averageDuration: `${averageDuration}s`
    },
    callbacks: {
      total: callbackData.length,
      pending: callbackData.filter(c => c.status === 'pending').length,
      completed: callbackData.filter(c => c.status === 'completed').length,
      recent: callbackData.slice(-10)
    },
    voicemails: {
      total: voicemailData.length,
      unlistened: voicemailData.filter(v => !v.listened).length,
      recent: voicemailData.slice(-10)
    },
    appointments: {
      total: appointments.length,
      recent: appointments.slice(-10)
    },
    systemInfo: {
      voicemailSystem: 'ACTIVE (records and sends notifications)',
      callbackSystem: 'ACTIVE (tracks and notifies)',
      analyticsSystem: 'REAL-TIME (updates every 30 seconds)',
      reminderSystem: 'ACTIVE (calls one day before at 2 PM PST)'
    },
    dashboards: {
      main: '/dashboard',
      analytics: '/analytics-dashboard',
      callbacks: '/callbacks-dashboard',
      voicemails: '/voicemails-dashboard',
      archive: '/archive-viewer',
      appointments: '/appointments-viewer'
    },
    security: {
      protection: 'ACTIVE (Basic Auth)',
      username: 'altair_admin',
      note: 'Change in .env file'
    }
  });
});

app.get('/', (req, res) => {
  const businessStatus = getBusinessStatus();
  
  res.send(`
    <html>
      <head>
        <title>Altair Partners IVR Server</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 1000px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
          .main-container { background: white; padding: 30px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
          .status { padding: 15px; border-radius: 10px; margin: 15px 0; }
          .open { background: linear-gradient(to right, #10b981, #34d399); color: white; }
          .closed { background: linear-gradient(to right, #ef4444, #f97316); color: white; }
          .dashboard-btn { display: block; width: 100%; padding: 20px; background: linear-gradient(to right, #4f46e5, #7c3aed); color: white; text-align: center; border-radius: 15px; text-decoration: none; font-weight: 600; font-size: 1.2rem; margin: 15px 0; transition: all 0.3s ease; }
          .dashboard-btn:hover { background: linear-gradient(to right, #4338ca, #6d28d9); transform: translateY(-5px); box-shadow: 0 10px 30px rgba(79, 70, 229, 0.4); }
          .system-info { background: #f0f9ff; padding: 20px; border-radius: 10px; margin: 20px 0; border: 2px solid #0ea5e9; }
          .security-note { background: #fee2e2; color: #991b1b; padding: 15px; border-radius: 10px; margin: 20px 0; border: 2px solid #ef4444; text-align: center; }
        </style>
      </head>
      <body>
        <div class="main-container">
          <h1 style="color: #1e293b; margin-bottom: 20px; display: flex; align-items: center; gap: 15px;">
            <span style="font-size: 2rem;">🚀</span>
            Altair Partners IVR System
          </h1>
          
          <div class="status ${businessStatus.isOpen ? 'open' : 'closed'}">
            <p><strong>Status:</strong> ${businessStatus.isOpen ? '🟢 OPEN' : '🔴 CLOSED'}</p>
            <p><strong>Current Time (PST):</strong> ${businessStatus.currentTime}</p>
            <p><strong>Business Hours:</strong> ${businessStatus.hours}</p>
            <p>${businessStatus.isOpen ? '✅ Currently open' : '⏰ ' + businessStatus.nextOpenTime}</p>
          </div>
          
          <div class="system-info">
            <h3 style="color: #0369a1; margin-top: 0;">🚀 NEW UNIFIED DASHBOARD!</h3>
            <p><strong>🔐 Secure Access:</strong> All dashboards protected with password</p>
            <p><strong>📊 Everything in One Place:</strong> Analytics, Callbacks, Voicemails, Archive, Appointments</p>
            <p><strong>🎯 Easy Navigation:</strong> Click any system to open in popup</p>
          </div>
          
          <div class="security-note">
            <p><strong>🔒 SECURE DASHBOARD ACCESS</strong></p>
            <p><strong>Username:</strong> altair_admin | <strong>Password:</strong> AltairSecure2024!@#$</p>
            <p><em>Change these in your .env file for production</em></p>
          </div>
          
          <a href="/dashboard" class="dashboard-btn">
            <span style="font-size: 1.5rem; margin-right: 10px;">🔐</span>
            ENTER SECURE DASHBOARD
          </a>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e2e8f0;">
            <p><strong>📞 Twilio Webhook:</strong> POST /voice</p>
            <p><strong>🎤 Voicemail System:</strong> Records messages, sends SMS to admin</p>
            <p><strong>📞 Callback System:</strong> Tracks requests, sends notifications</p>
            <p><strong>📈 Analytics:</strong> Real-time updates every 30 seconds</p>
            <p><strong>⏰ Reminder System:</strong> Calls ONE DAY BEFORE appointment at 2 PM PST</p>
            <p><strong>🔔 Test Call:</strong> +1 (503) 444-8881</p>
            <p><strong>📱 Admin Notifications:</strong> Sent to +1 (503) 544-2571</p>
          </div>
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
  const businessStatus = getBusinessStatus();
  const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  console.log(`🚀 Altair Partners IVR Server running on port ${PORT}`);
  console.log(`⏰ Business Status: ${businessStatus.isOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`📅 Next Open: ${businessStatus.nextOpenTime}`);
  console.log(`🌐 Server URL: ${serverUrl}`);
  
  console.log(`\n🚀 NEW UNIFIED DASHBOARD ACTIVATED:`);
  console.log(`✅ ${serverUrl}/dashboard - ALL SYSTEMS IN ONE PLACE`);
  console.log(`🔐 Password: altair_admin / AltairSecure2024!@#$`);
  
  console.log(`\n📊 INDIVIDUAL DASHBOARDS:`);
  console.log(`✅ ${serverUrl}/analytics-dashboard - REAL-TIME ANALYTICS`);
  console.log(`✅ ${serverUrl}/callbacks-dashboard - CALLBACK REQUESTS`);
  console.log(`✅ ${serverUrl}/voicemails-dashboard - VOICEMAIL RECORDINGS`);
  console.log(`✅ ${serverUrl}/archive-viewer - BEAUTIFUL ARCHIVE`);
  console.log(`✅ ${serverUrl}/appointments-viewer - APPOINTMENTS`);
  console.log(`✅ ${serverUrl}/debug - SYSTEM DEBUG`);
  
  console.log(`\n🔒 SECURITY INFO:`);
  console.log(`✅ Username: altair_admin`);
  console.log(`✅ Password: AltairSecure2024!@#$`);
  console.log(`📱 Notifications sent to: +1 (503) 544-2571`);
  
  console.log(`\n🎤 VOICEMAIL SYSTEM:`);
  console.log(`✅ Records audio messages`);
  console.log(`✅ Saves recordings with URLs`);
  console.log(`✅ Sends SMS notifications to admin`);
  
  console.log(`\n📞 CALLBACK SYSTEM:`);
  console.log(`✅ Tracks all callback requests`);
  console.log(`✅ Dashboard for management`);
  console.log(`✅ SMS notifications to admin`);
  
  console.log(`\n📈 ANALYTICS SYSTEM:`);
  console.log(`✅ Real-time updates every 30 seconds`);
  console.log(`✅ Charts and statistics`);
  console.log(`✅ User journey tracking`);
  
  console.log(`\n🗂️ ARCHIVE SYSTEM:`);
  console.log(`✅ Browse all call logs, appointments, AI conversations`);
  console.log(`✅ Search and filter functionality`);
  console.log(`✅ Export to CSV`);
  
  // Start reminder scheduler
  startReminderScheduler();
});