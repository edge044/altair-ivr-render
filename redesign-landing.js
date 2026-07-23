// Run once: node redesign-landing.js
// Replaces the home page entirely with a full landing page (real
// announcement bar, real code snippet from this actual project, honest
// "not open to everyone yet" notice, footer) and adds two new real
// routes: /login (a real login form) and /choose (the old phone/office
// picker, now reached after login). Safe to run more than once.
//
// Run this AFTER apply-integration.js (needs requireAuth to exist).
// Any earlier improve-homepage*.js patches are superseded by this one —
// running this replaces the whole route, so their edits don't matter
// either way once this runs.

const fs = require('fs');
const path = require('path');
const INDEX_PATH = path.join(__dirname, 'index.js');

if (!fs.existsSync(INDEX_PATH)) {
  console.error('✗ Could not find index.js in this folder.');
  process.exit(1);
}

let code = fs.readFileSync(INDEX_PATH, 'utf8');

if (code.includes('MANET_LANDING_V1')) {
  console.log('… landing page redesign already applied, nothing to do.');
  process.exit(0);
}

const START_ANCHOR = "app.get('/', (req, res) => {";
const END_ANCHOR = 'const PORT = process.env.PORT';

const startIdx = code.indexOf(START_ANCHOR);
const endIdx = code.indexOf(END_ANCHOR);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error('✗ Could not find the expected anchors ("app.get(\'/\'...)" and "const PORT = process.env.PORT").');
  console.error('  This usually means index.js has changed since this script was written. No changes made.');
  process.exit(1);
}

const SHARED_STYLE = `<style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafaf8; color: #161616; }
      a { color: inherit; }
      .topbar { background: #161616; color: #fff; text-align: center; padding: 9px 16px; font-size: 0.78rem; letter-spacing: 0.2px; }
      .topbar .dot { color: #ff8a5c; margin-right: 6px; }
      .topbar a { color: #ff8a5c; text-decoration: none; font-weight: 600; margin-left: 6px; }
      .topbar a:hover { text-decoration: underline; }
      .wrap { max-width: 1080px; margin: 0 auto; padding: 0 32px; }
      .hero-row { display: flex; align-items: flex-start; gap: 56px; padding: 64px 0 40px; flex-wrap: wrap; }
      .hero-left { flex: 1 1 420px; min-width: 320px; }
      .hero-right { flex: 1 1 420px; min-width: 320px; }
      h1.headline { font-size: 2.6rem; line-height: 1.12; font-weight: 700; letter-spacing: -0.5px; margin: 0 0 20px; }
      .sub { font-size: 1.02rem; color: #55534d; line-height: 1.6; margin: 0 0 14px; max-width: 460px; }
      .cta-row2 { display: flex; gap: 12px; margin-top: 28px; }
      .btn { display: inline-block; padding: 12px 22px; border-radius: 7px; font-size: 0.92rem; font-weight: 600; text-decoration: none; transition: transform 0.12s ease, box-shadow 0.12s ease; }
      .btn.primary { background: #161616; color: #fff; }
      .btn.primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,0.18); }
      .btn.outline { border: 1.4px solid #d8d4c9; color: #161616; background: #fff; }
      .btn.outline:hover { border-color: #161616; }
      .code-mock { background: #1c1c1e; border-radius: 10px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.18); font-family: 'SF Mono', Consolas, monospace; }
      .code-mock .bar { display: flex; align-items: center; gap: 6px; padding: 10px 14px; background: #2a2a2c; }
      .code-mock .dot2 { width: 10px; height: 10px; border-radius: 50%; }
      .code-mock .fname { margin-left: 10px; color: #8a8d93; font-size: 0.72rem; }
      .code-mock pre { margin: 0; padding: 16px 18px; font-size: 0.72rem; line-height: 1.65; color: #c9c9ce; overflow-x: auto; }
      .code-mock .k { color: #ff7ab6; } .code-mock .s { color: #a6e22e; } .code-mock .c { color: #6d6f78; } .code-mock .f { color: #66d9ef; }
      .notice { max-width: 1080px; margin: 0 auto 40px; padding: 16px 32px; }
      .notice-box { background: #fff8ea; border: 1px solid #f0dfa8; border-radius: 8px; padding: 14px 18px; font-size: 0.86rem; color: #6b5a1f; }
      .feature-row { display: flex; align-items: center; gap: 56px; padding: 56px 0; border-top: 1px solid #e8e4d8; flex-wrap: wrap-reverse; }
      .feature-row .code-mock { flex: 1 1 420px; min-width: 320px; }
      .feature-row .hero-left { flex: 1 1 420px; min-width: 320px; }
      h2.headline2 { font-size: 1.9rem; font-weight: 700; line-height: 1.2; margin: 0 0 16px; letter-spacing: -0.3px; }
      footer { border-top: 1px solid #e8e4d8; padding: 40px 32px 50px; text-align: center; color: #9a9488; font-size: 0.8rem; }
      footer a { color: #161616; text-decoration: none; font-weight: 600; }
      footer a:hover { text-decoration: underline; }
      footer .foot-brand { font-family: Georgia, serif; font-size: 1.1rem; color: #161616; margin-bottom: 8px; }
      @media (max-width: 720px) { h1.headline { font-size: 1.9rem; } .hero-row, .feature-row { padding-top: 40px; } }
    </style>`;

const NEW_HOME_ROUTE = `app.get('/', (req, res) => {
  res.send(\`<!-- MANET_LANDING_V1 -->
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manet Creative — AI-run creative studio</title>
${SHARED_STYLE}
</head>
<body>
  <div class="topbar"><span class="dot">●</span>New — the real AI office is live internally<a href="https://manet.agency">See Manet Agency →</a></div>
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
        <div class="code-mock">
          <div class="bar"><span class="dot2" style="background:#ff5f57;"></span><span class="dot2" style="background:#febc2e;"></span><span class="dot2" style="background:#28c840;"></span><span class="fname">office-integration.js</span></div>
          <pre><span class="c">// real scanner traps — these paths don't exist on this server,</span>
<span class="c">// so hitting one means it's a bot, not a mistake</span>
<span class="k">const</span> HONEYPOT_PATHS = <span class="k">new</span> <span class="f">Set</span>([
  <span class="s">'/wp-admin'</span>, <span class="s">'/.env'</span>, <span class="s">'/phpmyadmin'</span>,
  <span class="s">'/.git/config'</span>, <span class="s">'/xmlrpc.php'</span>
]);

app.<span class="f">use</span>((req, res, next) => {
  <span class="k">if</span> (HONEYPOT_PATHS.<span class="f">has</span>(req.path)) {
    store.<span class="f">banIp</span>(ip, <span class="s">'probed honeypot'</span>);
    <span class="k">return</span> res.<span class="f">status</span>(404).<span class="f">send</span>(<span class="s">'Not found.'</span>);
  }
  <span class="f">next</span>();
});</pre>
        </div>
      </div>
    </div>
  </div>
  <div class="notice">
    <div class="notice-box">🚧 <b>This system isn't open to every client yet</b> — we're still finishing the last pieces internally. The full AI-run office will be available to all Manet clients soon.</div>
  </div>
  <div class="wrap">
    <div class="feature-row">
      <div class="code-mock">
        <div class="bar"><span class="dot2" style="background:#ff5f57;"></span><span class="dot2" style="background:#febc2e;"></span><span class="dot2" style="background:#28c840;"></span><span class="fname">office.html</span></div>
        <pre><span class="c">// every real job becomes a project with a real archive</span>
<span class="k">function</span> <span class="f">createProject</span>(text, importance, budget) {
  <span class="k">const</span> project = {
    id, title: text, importance, budget,
    status: <span class="s">'active'</span>,
    distribution: [],
    chatHistory: [],
  };
  s.projectsList.<span class="f">unshift</span>(project);
  <span class="f">syncProjectsToCloud</span>();
  <span class="k">return</span> project;
}</pre>
      </div>
      <div class="hero-left">
        <h2 class="headline2">Your studio, staffed and running.</h2>
        <p class="sub">Six real AI teammates, a real day-rate budget, a real archive of every project — Mila directs, the team executes, you approve.</p>
        <p class="sub">Nothing here is scripted. Every project, every conversation, every dollar spent is real and stored in a real database.</p>
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
  res.send(\`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Member Login — Manet Creative</title>
${SHARED_STYLE}
<style>
  .login-wrap { max-width: 380px; margin: 90px auto; padding: 0 24px; }
  .login-card { background: #fff; border: 1px solid #e8e4d8; border-radius: 12px; padding: 36px 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.06); }
  .login-card h1 { font-size: 1.3rem; margin: 0 0 6px; }
  .login-card .sub2 { font-size: 0.82rem; color: #9a9488; margin: 0 0 24px; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 0.76rem; font-weight: 600; color: #55534d; margin-bottom: 5px; }
  .field input { width: 100%; padding: 10px 12px; border: 1.4px solid #e0dcd0; border-radius: 7px; font-size: 0.9rem; }
  .field input:focus { outline: none; border-color: #161616; }
  .login-btn { width: 100%; padding: 11px; background: #161616; color: #fff; border: none; border-radius: 7px; font-size: 0.9rem; font-weight: 600; cursor: pointer; margin-top: 6px; }
  .login-btn:hover { opacity: 0.9; }
  .login-err { color: #b8433a; font-size: 0.8rem; margin-top: 10px; display: none; }
  .login-back { text-align: center; margin-top: 18px; font-size: 0.78rem; }
  .login-back a { color: #9a9488; text-decoration: none; }
</style>
</head>
<body>
  <div class="topbar"><span class="dot">●</span>Protected area — real credentials required<a href="https://manet.agency">Manet Agency →</a></div>
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
  .choose-wrap { max-width: 640px; margin: 100px auto; padding: 0 24px; text-align: center; }
  .choose-wrap h1 { font-size: 1.7rem; margin-bottom: 8px; }
  .choose-wrap .sub2 { color: #9a9488; margin-bottom: 40px; }
  .choose-row { display: flex; gap: 18px; justify-content: center; }
  .choose-card { flex: 1; max-width: 220px; padding: 30px 20px; background: #fff; border: 1.4px solid #e8e4d8; border-radius: 12px; text-decoration: none; color: #161616; transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .choose-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(0,0,0,0.1); border-color: #161616; }
  .choose-icon { font-size: 30px; margin-bottom: 10px; }
  .choose-label { font-weight: 700; font-size: 1rem; margin-bottom: 4px; }
  .choose-sub { font-size: 0.76rem; color: #9a9488; }
</style>
</head>
<body>
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
console.log('✓ Landing page redesign applied: new home page, /login, and /choose are live.');
