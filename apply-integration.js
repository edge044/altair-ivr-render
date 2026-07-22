// Run this ONCE from your project folder:  node apply-integration.js
//
// What it does to your real index.js:
//   1. Makes a backup: index.js.backup-before-office
//   2. Adds 2 lines right after your requireAuth() function, mounting the
//      office app — does not touch anything else, no Twilio/OpenAI/appointment
//      code is modified.
//   3. Replaces the single "Open Admin" link on the home page with two
//      buttons: Phone System (/admin) and Our Office (/office).
//
// Safe to run more than once — it checks whether each change is already
// applied and skips it instead of duplicating.

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'index.js');
const BACKUP_PATH = path.join(__dirname, 'index.js.backup-before-office');

if (!fs.existsSync(INDEX_PATH)) {
  console.error('✗ Could not find index.js in this folder. Run this script from your project folder (the one with index.js in it).');
  process.exit(1);
}

let code = fs.readFileSync(INDEX_PATH, 'utf8');
let changed = false;

// ── 1. Mount the office app right after requireAuth() closes ──────────
const MOUNT_MARKER = "const mountOffice = require('./office-integration');";
if (code.includes(MOUNT_MARKER)) {
  console.log('… office app mount already present, skipping that part.');
} else {
  const anchor = /function requireAuth\(req, res, next\) \{[\s\S]*?\n\}\n/;
  const match = code.match(anchor);
  if (!match) {
    console.error('✗ Could not find your requireAuth() function to anchor the change. Nothing was modified.');
    console.error('  You can add these 2 lines yourself, anywhere after requireAuth is defined and before app.listen(...):');
    console.error("  const mountOffice = require('./office-integration');\n  mountOffice(app, requireAuth);\n");
    process.exit(1);
  }
  const insertion = match[0] + "\n" + MOUNT_MARKER + "\nmountOffice(app, requireAuth);\n";
  code = code.replace(anchor, insertion);
  changed = true;
  console.log('✓ Added office app mount after requireAuth().');
}

// ── 2. Home page: two buttons instead of one admin link ───────────────
const OLD_HOME_LINK = '<a href="/admin">Open Admin</a>';
const NEW_HOME_LINKS = '<div style="display:flex; gap:12px; justify-content:center;"><a href="/admin">📞 Phone System</a><a href="/office">🏢 Our Office</a></div>';
if (code.includes('🏢 Our Office')) {
  console.log('… home page buttons already present, skipping that part.');
} else if (code.includes(OLD_HOME_LINK)) {
  code = code.replace(OLD_HOME_LINK, NEW_HOME_LINKS);
  changed = true;
  console.log('✓ Updated home page with two buttons (Phone System / Our Office).');
} else {
  console.warn('⚠ Could not find the exact "Open Admin" link on your home page — it may have changed. Home page was NOT modified.');
  console.warn('  You can add this manually where your admin link is:');
  console.warn('  ' + NEW_HOME_LINKS);
}

if (changed) {
  fs.writeFileSync(BACKUP_PATH, fs.readFileSync(INDEX_PATH)); // backup the ORIGINAL file before overwriting it
  fs.writeFileSync(INDEX_PATH, code);
  console.log('\n✓ Done. Original saved as index.js.backup-before-office. New index.js written.');
  console.log('  Next: make sure office-integration.js and office.html are in this same folder, then deploy.');
} else {
  console.log('\nNothing to change — index.js already has both parts.');
}
