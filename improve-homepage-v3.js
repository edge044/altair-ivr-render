// Run once: node improve-homepage-v3.js
// Adds a subtle animated gradient background to the HOME PAGE specifically
// (anchored on the cta-row buttons from improve-homepage.js, which only
// exist there — not on the login page, which has similar-looking CSS and
// caused the animation to land in the wrong place in an earlier version
// of this script). Pure CSS, no external assets. Safe to run more than once.
//
// Requires improve-homepage.js to have been run first (needs the cta-row
// marker it adds).

const fs = require('fs');
const path = require('path');
const INDEX_PATH = path.join(__dirname, 'index.js');

if (!fs.existsSync(INDEX_PATH)) {
  console.error('✗ Could not find index.js in this folder.');
  process.exit(1);
}

let code = fs.readFileSync(INDEX_PATH, 'utf8');

const ANCHOR = 'class="cta-row"';
const STYLE_BLOCK = `<style>
            body {
              background: linear-gradient(-45deg, #f7f3ed, #f0e9de, #eef2ea, #f3ede2) !important;
              background-size: 400% 400% !important;
              animation: manetGradientShift 18s ease infinite;
            }
            @keyframes manetGradientShift {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
          </style>
          <div ${ANCHOR}`;

if (code.includes('manetGradientShift')) {
  console.log('… background animation already added, nothing to do.');
} else if (code.includes('<div ' + ANCHOR)) {
  code = code.replace('<div ' + ANCHOR, STYLE_BLOCK);
  fs.writeFileSync(INDEX_PATH, code);
  console.log('✓ Added an animated gradient background to the home page (only — login page untouched).');
} else {
  console.warn('⚠ Could not find the cta-row marker — run improve-homepage.js first, then this script.');
}
