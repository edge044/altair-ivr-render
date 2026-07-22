// Run once from your project folder: node improve-homepage.js
// Makes the home page (the two-button page) look nicer — bigger, icon
// buttons with hover effects, a subtitle. Safe to run more than once.

const fs = require('fs');
const path = require('path');
const INDEX_PATH = path.join(__dirname, 'index.js');

if (!fs.existsSync(INDEX_PATH)) {
  console.error('✗ Could not find index.js in this folder.');
  process.exit(1);
}

let code = fs.readFileSync(INDEX_PATH, 'utf8');

const OLD_MARKER = '<div style="display:flex; gap:12px; justify-content:center;"><a href="/admin">📞 Phone System</a><a href="/office">🏢 Our Office</a></div>';
const NEW_BLOCK = `<div class="cta-row">
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
          </style>`;

if (code.includes('class="cta-row"')) {
  console.log('… home page already upgraded, nothing to do.');
} else if (code.includes(OLD_MARKER)) {
  code = code.replace(OLD_MARKER, NEW_BLOCK);
  fs.writeFileSync(INDEX_PATH, code);
  console.log('✓ Home page upgraded with nicer buttons.');
} else {
  console.warn('⚠ Could not find the expected home page markup — it may have changed since the last update. No changes made.');
  console.warn('  Look for the two-link block in your GET \'/\' route in index.js and style it manually if you like.');
}
