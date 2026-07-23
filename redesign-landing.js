// Run once: node redesign-landing.js
// Precisely matches the reference design: full navbar header, monospace
// font throughout, LIGHT-theme code editor mockup (not dark), bordered
// grid strip. Real text about Manet Creative, no borrowed client logos.
// Adds /login (real login form) and /choose (phone/office picker).
// Safe to run more than once — re-running replaces the whole section.

const fs = require('fs');
const path = require('path');
const INDEX_PATH = path.join(__dirname, 'index.js');

if (!fs.existsSync(INDEX_PATH)) {
  console.error('✗ Could not find index.js in this folder.');
  process.exit(1);
}

let code = fs.readFileSync(INDEX_PATH, 'utf8');

const START_ANCHOR = "app.get('/', (req, res) => {";
const END_ANCHOR = 'const PORT = process.env.PORT';

const startIdx = code.indexOf(START_ANCHOR);
const endIdx = code.indexOf(END_ANCHOR);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error('✗ Could not find the expected anchors ("app.get(\'/\'...)" and "const PORT = process.env.PORT").');
  console.error('  This usually means index.js has changed since this script was written. No changes made.');
  process.exit(1);
}

const MONO = `'SF Mono', 'Roboto Mono', 'IBM Plex Mono', Consolas, 'Courier New', monospace`;

const SHARED_STYLE = `<style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: ${MONO}; background: #f2f1ec; color: #161616; -webkit-font-smoothing: antialiased; }
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
      .btn { display: inline-block; padding: 9px 18px; border-radius: 3px; font-size: 0.78rem; font-weight: 700; text-decoration: none; border: 1.3px solid transparent; font-family: ${MONO}; cursor: pointer; }
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
    </style>`;

const LOGO_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14140f" stroke-width="1.6"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>`;

const NAVBAR = `<div class="navbar">
    <div class="navbar-inner">
      <div class="nav-logo">${LOGO_SVG}Manet Creative</div>
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
  </div>`;

const CODE_BLOCK_1 = `<div class="ide-mock">
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
        </div>`;

const CODE_BLOCK_2 = `<div class="ide-mock">
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
        </div>`;

const NEW_HOME_ROUTE = `app.get('/', (req, res) => {
  res.send(\`<!-- MANET_LANDING_V3 -->
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manet Creative — AI-run creative studio</title>
${SHARED_STYLE}
</head>
<body>
  ${NAVBAR}
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
        ${CODE_BLOCK_1}
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
        ${CODE_BLOCK_2}
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
</html>\`);
});

app.get('/login', (req, res) => {
  try { if (typeof hasValidSession === 'function' && hasValidSession(req)) return res.redirect('/choose'); } catch (e) {}
  res.send(\`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Member Login — Manet Creative</title>
${SHARED_STYLE}
<style>
  .login-wrap { max-width: 380px; margin: 70px auto; padding: 0 24px; }
  .login-card { background: #fff; border: 1px solid #e2ded2; border-radius: 8px; padding: 36px 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.06); }
  .login-card h1 { font-size: 1.15rem; margin: 0 0 6px; font-weight: 700; font-family: -apple-system, sans-serif; }
  .login-card .sub2 { font-size: 0.78rem; color: #9a9488; margin: 0 0 24px; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 0.72rem; font-weight: 700; color: #55534d; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.3px; }
  .field input { width: 100%; padding: 10px 12px; border: 1.4px solid #e0dcd0; border-radius: 4px; font-size: 0.85rem; font-family: ${MONO}; }
  .field input:focus { outline: none; border-color: #14140f; }
  .login-btn { width: 100%; padding: 11px; background: #14140f; color: #fff; border: none; border-radius: 4px; font-size: 0.82rem; font-weight: 700; cursor: pointer; margin-top: 6px; font-family: ${MONO}; }
  .login-btn:hover { opacity: 0.9; }
  .login-err { color: #b8433a; font-size: 0.76rem; margin-top: 10px; display: none; }
  .login-back { text-align: center; margin-top: 18px; font-size: 0.74rem; }
  .login-back a { color: #9a9488; text-decoration: none; }
</style>
</head>
<body>
  ${NAVBAR}
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
</html>\`);
});

app.get('/choose', requireAuth, (req, res) => {
  res.send(\`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Manet Creative</title>
${SHARED_STYLE}
<style>
  .choose-wrap { max-width: 640px; margin: 90px auto; padding: 0 24px; text-align: center; }
  .choose-wrap h1 { font-size: 1.5rem; margin-bottom: 8px; font-weight: 700; font-family: -apple-system, sans-serif; }
  .choose-wrap .sub2 { color: #9a9488; margin-bottom: 40px; font-size: 0.82rem; }
  .choose-row { display: flex; gap: 18px; justify-content: center; }
  .choose-card { flex: 1; max-width: 220px; padding: 30px 20px; background: #fff; border: 1.4px solid #e2ded2; border-radius: 8px; text-decoration: none; color: #14140f; transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .choose-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(0,0,0,0.1); border-color: #14140f; }
  .choose-icon { font-size: 28px; margin-bottom: 10px; }
  .choose-label { font-weight: 700; font-size: 0.88rem; margin-bottom: 4px; }
  .choose-sub { font-size: 0.7rem; color: #9a9488; }
</style>
</head>
<body>
  ${NAVBAR}
  <div class="choose-wrap">
    <h1>Welcome back.</h1>
    <div class="sub2">Where do you want to go?</div>
    <div class="choose-row">
      <a href="/admin" class="choose-card"><div class="choose-icon">📞</div><div class="choose-label">Phone System</div><div class="choose-sub">Calls, messages, appointments</div></a>
      <a href="/office" class="choose-card"><div class="choose-icon">🏢</div><div class="choose-label">Our Office</div><div class="choose-sub">Team, projects, budget</div></a>
    </div>
  </div>
</body>
</html>\`);
});

`;

code = code.slice(0, startIdx) + NEW_HOME_ROUTE + code.slice(endIdx);
fs.writeFileSync(INDEX_PATH, code);
console.log('✓ Landing page redesign (v3 — navbar, monospace font, light-theme code mockup) applied.');
