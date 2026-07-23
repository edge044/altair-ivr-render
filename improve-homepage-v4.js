// Run once: node improve-homepage-v4.js
// Full redesign of the home page — proper hero section, feature showcase,
// footer, and a richer animated background (soft drifting color blobs,
// not just a gradient shift). Anchors on markers from improve-homepage.js
// and improve-homepage-v2.js, which must run first.

const fs = require('fs');
const path = require('path');
const INDEX_PATH = path.join(__dirname, 'index.js');

if (!fs.existsSync(INDEX_PATH)) {
  console.error('✗ Could not find index.js in this folder.');
  process.exit(1);
}

let code = fs.readFileSync(INDEX_PATH, 'utf8');

if (code.includes('manet-hero-v4')) {
  console.log('… v4 homepage redesign already applied, nothing to do.');
  process.exit(0);
}

// ── 1. Replace the plain h1/p with a real hero section ─────────────────
const OLD_HERO = '<h1>Manet Creative</h1>\n          <p>Phone system is running.</p>';
const NEW_HERO = `<div class="manet-hero-v4">
            <div class="manet-eyebrow">CREATIVE AGENCY · OPERATIONS</div>
            <h1 class="manet-h1">Manet Creative</h1>
            <p class="manet-tagline">Real people, real AI, one place — the phone line and the studio, both running live.</p>
          </div>`;

// ── 2. Add a feature showcase after the CTA buttons ─────────────────────
const CTA_END_MARKER = `.cta-sub { font-size: 0.72rem; color: #9a9488; }
          </style>`;
const FEATURE_SHOWCASE = `${CTA_END_MARKER}
          <div class="manet-features">
            <div class="manet-feature">
              <div class="manet-feature-num">01</div>
              <div class="manet-feature-title">Phone, answered</div>
              <div class="manet-feature-desc">Every call logged, every appointment booked, nothing missed.</div>
            </div>
            <div class="manet-feature">
              <div class="manet-feature-num">02</div>
              <div class="manet-feature-title">A studio that thinks</div>
              <div class="manet-feature-desc">Six-person AI team, real budget, real work, real archive.</div>
            </div>
            <div class="manet-feature">
              <div class="manet-feature-num">03</div>
              <div class="manet-feature-title">Instagram, covered</div>
              <div class="manet-feature-desc">Messages and ad performance in one screen, not three tabs.</div>
            </div>
          </div>
          <div class="manet-footer">Manet Creative — built to run itself, watched by someone who still cares.</div>
          <style>
            .manet-hero-v4 { text-align: center; margin-bottom: 6px; }
            .manet-eyebrow {
              font-size: 0.68rem; letter-spacing: 3px; color: #a89e8c; font-weight: 600;
              margin-bottom: 14px; text-transform: uppercase;
            }
            .manet-h1 {
              font-family: Georgia, 'Times New Roman', serif; font-size: 2.6rem; font-weight: 400;
              color: #161616; margin: 0 0 10px; letter-spacing: -0.5px;
              animation: manetFadeUp 0.9s ease both;
            }
            .manet-tagline {
              font-size: 0.98rem; color: #7a7466; max-width: 420px; margin: 0 auto 8px;
              line-height: 1.55; font-style: italic;
              animation: manetFadeUp 0.9s ease 0.15s both;
            }
            @keyframes manetFadeUp {
              from { opacity: 0; transform: translateY(8px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .manet-features {
              display: flex; gap: 20px; justify-content: center; margin-top: 44px;
              padding-top: 30px; border-top: 1px solid rgba(0,0,0,0.08);
              max-width: 480px; margin-left: auto; margin-right: auto; flex-wrap: wrap;
            }
            .manet-feature { flex: 1 1 120px; text-align: left; min-width: 120px; }
            .manet-feature-num {
              font-family: Georgia, serif; font-size: 0.85rem; color: #c9beac; font-weight: 600; margin-bottom: 6px;
            }
            .manet-feature-title { font-size: 0.86rem; font-weight: 600; color: #2a2a2a; margin-bottom: 4px; }
            .manet-feature-desc { font-size: 0.76rem; color: #9a9488; line-height: 1.5; }
            .manet-footer {
              text-align: center; margin-top: 40px; font-size: 0.7rem; color: #b8b0a0;
              letter-spacing: 0.3px; font-style: italic;
            }
            @media (max-width: 640px) {
              .manet-features { flex-direction: column; gap: 18px; }
            }
          </style>`;

let count = 0;
if (code.includes(OLD_HERO)) { code = code.replace(OLD_HERO, NEW_HERO); count++; }
else console.warn('⚠ Could not find the plain h1/p hero markup — skipping that part.');

if (code.includes(CTA_END_MARKER)) { code = code.replace(CTA_END_MARKER, FEATURE_SHOWCASE); count++; }
else console.warn('⚠ Could not find the CTA-button style block marker — run improve-homepage.js first.');

if (count > 0) {
  fs.writeFileSync(INDEX_PATH, code);
  console.log(`✓ Applied homepage redesign (${count}/2 sections). Restart/redeploy to see it.`);
} else {
  console.error('✗ Nothing matched — no changes made. Run improve-homepage.js and improve-homepage-v2.js first.');
}
