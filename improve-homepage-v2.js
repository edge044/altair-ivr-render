// Run once: node improve-homepage-v2.js
// Adds a real, live system-status indicator above the two buttons (checks
// /health for real, not a fake green dot) plus a bit more visual polish.
// Safe to run more than once.

const fs = require('fs');
const path = require('path');
const INDEX_PATH = path.join(__dirname, 'index.js');

if (!fs.existsSync(INDEX_PATH)) {
  console.error('✗ Could not find index.js in this folder.');
  process.exit(1);
}

let code = fs.readFileSync(INDEX_PATH, 'utf8');

const ANCHOR = '<div class="cta-row">';
const STATUS_BLOCK = `<div id="sys-status" class="sys-status">
            <span class="sys-dot" id="sys-dot"></span>
            <span id="sys-status-text">Checking system status…</span>
          </div>
          <script>
            fetch('/health').then(r => {
              const dot = document.getElementById('sys-dot');
              const text = document.getElementById('sys-status-text');
              if (r.ok) { dot.style.background = '#3ba55d'; text.textContent = 'All systems operational'; }
              else { dot.style.background = '#da373c'; text.textContent = 'Something is off — check Logs'; }
            }).catch(() => {
              const dot = document.getElementById('sys-dot');
              const text = document.getElementById('sys-status-text');
              dot.style.background = '#da373c'; text.textContent = 'Could not reach the server';
            });
          </script>
          <style>
            .sys-status { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 4px 0 22px; font-size: 0.82rem; color: #77716a; }
            .sys-dot { width: 8px; height: 8px; border-radius: 50%; background: #c9c2b6; display: inline-block; }
          </style>
          ${ANCHOR}`;

if (code.includes('id="sys-status"')) {
  console.log('… status indicator already added, nothing to do.');
} else if (code.includes(ANCHOR)) {
  code = code.replace(ANCHOR, STATUS_BLOCK);
  fs.writeFileSync(INDEX_PATH, code);
  console.log('✓ Added a real, live system-status indicator to the home page.');
} else {
  console.warn('⚠ Could not find the expected home page markup (run improve-homepage.js first). No changes made.');
}
