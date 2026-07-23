// Run once: node add-session-login.js
// Makes requireAuth() also accept a valid session cookie (set by the
// pretty /login form), not just HTTP Basic Auth. Without this, logging in
// via the nice form would only grant access to /choose, not /admin or
// /office. Safe to run more than once.
//
// Run this AFTER office-integration.js is in place (needs to require it).

const fs = require('fs');
const path = require('path');
const INDEX_PATH = path.join(__dirname, 'index.js');

if (!fs.existsSync(INDEX_PATH)) {
  console.error('✗ Could not find index.js in this folder.');
  process.exit(1);
}

let code = fs.readFileSync(INDEX_PATH, 'utf8');

if (code.includes("const { hasValidSession } = require('./office-integration');")) {
  console.log('… session-cookie check already added to requireAuth, nothing to do.');
  process.exit(0);
}

const REQUIRE_ANCHOR = "function requireAuth(req, res, next) {";
if (!code.includes(REQUIRE_ANCHOR)) {
  console.error('✗ Could not find "function requireAuth(req, res, next) {" in index.js. No changes made.');
  process.exit(1);
}

// Insert a require for office-integration's exported session checker near
// the top (right after the other requires), and a session check as the
// very first thing requireAuth does.
const REQUIRE_LINE = "const basicAuth = require('basic-auth');";
if (!code.includes(REQUIRE_LINE)) {
  console.error('✗ Could not find the basic-auth require line to anchor on. No changes made.');
  process.exit(1);
}
code = code.replace(REQUIRE_LINE, `${REQUIRE_LINE}\nconst { hasValidSession } = require('./office-integration');`);

code = code.replace(
  REQUIRE_ANCHOR,
  `${REQUIRE_ANCHOR}\n  if (hasValidSession(req)) return next(); // real session cookie from the /login form — no Basic Auth needed`
);

fs.writeFileSync(INDEX_PATH, code);
console.log('✓ requireAuth now accepts real session cookies from /login, in addition to Basic Auth.');
