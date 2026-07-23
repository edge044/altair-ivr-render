// Run once: node add-rawbody-capture.js
// Adds a tiny `verify` hook to your EXISTING app.use(express.json()) line
// so real Instagram webhook signatures can actually be checked. Without
// this, the webhook still works (accepts real messages) — it just can't
// verify they really came from Meta, and says so honestly in the logs.
// Safe to run more than once.

const fs = require('fs');
const path = require('path');
const INDEX_PATH = path.join(__dirname, 'index.js');

if (!fs.existsSync(INDEX_PATH)) {
  console.error('✗ Could not find index.js in this folder.');
  process.exit(1);
}

let code = fs.readFileSync(INDEX_PATH, 'utf8');

const OLD = 'app.use(express.json());';
const NEW = "app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));";

if (code.includes('req.rawBody = buf')) {
  console.log('… raw-body capture already added, nothing to do.');
} else if (code.includes(OLD)) {
  code = code.replace(OLD, NEW);
  fs.writeFileSync(INDEX_PATH, code);
  console.log('✓ Added raw-body capture. Instagram webhook signatures can now be verified for real.');
} else {
  console.warn('⚠ Could not find "app.use(express.json());" in index.js — it may already be customized.');
  console.warn('  Add this option to your existing express.json() call by hand:');
  console.warn('    { verify: (req, res, buf) => { req.rawBody = buf; } }');
}
