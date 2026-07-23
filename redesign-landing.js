// Run once: node redesign-landing.js
// Replaces the home page with a landing page closely matching a
// dev-tool-style reference design (left-aligned hero, IDE-style code
// mockup with a layered terminal box, clean sans-serif throughout) — but
// with real text about Manet Creative, and no borrowed client logos
// (that would misrepresent who your actual clients are). Adds /login (a
// real login form) and /choose (the phone/office picker, reached after
// login). Safe to run more than once — re-running replaces the whole
// section with this version.

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

const SHARED_STYLE = `<style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #ffffff; color: #14140f; -webkit-font-smoothing: antialiased; }
      a { color: inherit; }
      .announce { max-width: 1180px; margin: 0 auto; padding: 22px 32px 0; font-size: 0.78rem; color: #6b6b64; display: flex; align-items: center; gap: 7px; }
      .announce .dot3 { width: 6px; height: 6px; border-radius: 50%; background: #14140f; display: inline-block; }
      .announce a { color: #e8623d; text-decoration: none; font-weight: 600; }
      .announce a:hover { text-decoration: underline; }
      .wrap { max-width: 1180px; margin: 0 auto; padding: 0 32px; }
      .hero-row { display: flex; align-items: flex-start; gap: 60px; padding: 22px 0 70px; flex-wrap: wrap; }
      .hero-left { flex: 1 1 420px; min-width: 300px; padding-top: 10px; }
      .hero-right { flex: 1 1 440px; min-width: 320px; position: relative; padding-bottom: 60px; }
      h1.headline { font-size: 2.5rem; line-height: 1.14; font-weight: 700; letter-spacing: -0.8px; margin: 0 0 20px; color: #14140f; }
      .sub { font-size: 0.98rem; color: #6b6b64; line-height: 1.6; margin: 0 0 16px; max-width: 460px; }
      .cta-row2 { display: flex; gap: 10px; margin-top: 26px; }
      .btn { display: inline-block; padding: 11px 20px; border-radius: 5px; font-size: 0.86rem; font-weight: 600; text-decoration: none; transition: opacity 0.12s ease; border: 1.3px solid transparent; }
      .btn.primary { background: #14140f; color: #fff; }
      .btn.primary:hover { opacity: 0.85; }
      .btn.outline { border-color: #dcdad2; color: #14140f; background: #fff; }
      .btn.outline:hover { border-color: #14140f; }
      /* IDE-style code mockup */
      .ide-mock { background: #1c1c1e; border-radius: 9px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.22); font-family: 'SF Mono', Consolas, monospace; }
      .ide-bar { display: flex; align-items: center; gap: 6px; padding: 9px 12px; background: #262628; border-bottom: 1px solid #333; }
      .ide-dot { width: 9px; height: 9px; border-radius: 50%; }
      .ide-body { display: flex; }
      .ide-tree { width: 130px; background: #202022; padding: 10px 8px; font-size: 0.65rem; color: #8a8d93; border-right: 1px solid #2e2e30; line-height: 2; }
      .ide-tree .t1 { color: #c9c9ce; font-weight: 600; margin-bottom: 4px; }
      .ide-tree .f { padding-left: 10px; }
      .ide-tree .f.on { color: #fff; background: #2e2e30; margin-left: -8px; padding-left: 18px; }
      .ide-code { flex: 1; padding: 12px 14px; font-size: 0.68rem; line-height: 1.7; color: #c9c9ce; overflow-x: auto; }
      .ide-code .k { color: #ff7ab6; } .ide-code .s { color: #a6e22e; } .ide-code .c { color: #6d6f78; } .ide-code .f2 { color: #66d9ef; }
      /* Layered terminal box */
      .term-mock { position: absolute; right: -14px; bottom: 0; width: 76%; background: #1c1c1e; border: 1px solid #333; border-radius: 8px; box-shadow: 0 20px 50px rgba(0,0,0,0.3); font-family: 'SF Mono', Consolas, monospace; }
      .term-tabs { display: flex; gap: 0; border-bottom: 1px solid #333; }
      .term-tab { padding: 7px 14px; font-size: 0.62rem; color: #8a8d93; }
      .term-tab.on { color: #fff; border-bottom: 2px solid #e8623d; }
      .term-line { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 0.7rem; color: #c9c9ce; }
      .term-copy { color: #6d6f78; cursor: pointer; }
      .divider-strip { border-top: 1px solid #eeece4; border-bottom: 1px solid #eeece4; background: #fafaf7; padding: 26px 32px; margin-top: 6px; }
      .divider-row { max-width: 1180px; margin: 0 auto; display: flex; justify-content: center; gap: 0; flex-wrap: wrap; }
      .divider-item { padding: 0 30px; font-size: 0.78rem; color: #8a8778; font-weight: 600; letter-spacing: 0.3px; border-right: 1px solid #e4e1d6; }
      .divider-item:last-child { border-right: none; }
      footer { border-top: 1px solid #eeece4; padding: 40px 32px 50px; text-align: center; color: #9a9488; font-size: 0.8rem; }
      footer a { color: #14140f; text-decoration: none; font-weight: 600; }
      footer a:hover { text-decoration: underline; }
      footer .foot-brand { font-weight: 700; font-size: 1rem; color: #14140f; margin-bottom: 8px; }
      @media (max-width: 760px) { h1.headline { font-size: 1.9rem; } .term-mock { display: none; } }
    </style>`;

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
  res.send(\`<!-- MANET_LANDING_V2 -->
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manet Creative — AI-run creative studio</title>
${SHARED_STYLE}
</head>
<body>
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
  <div class="divider-strip">
    <div class="divider-row">
      <div class="divider-item">📞 Phone, answered</div>
      <div class="divider-item">🏢 A studio that thinks</div>
      <div class="divider-item">📷 Instagram, covered</div>
      <div class="divider-item">🔒 Actually secured</div>
    </div>
  </div>
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
  .login-card { background: #fff; border: 1px solid #eeece4; border-radius: 10px; padding: 36px 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.06); }
  .login-card h1 { font-size: 1.3rem; margin: 0 0 6px; font-weight: 700; }
  .login-card .sub2 { font-size: 0.82rem; color: #9a9488; margin: 0 0 24px; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 0.76rem; font-weight: 600; color: #55534d; margin-bottom: 5px; }
  .field input { width: 100%; padding: 10px 12px; border: 1.4px solid #e0dcd0; border-radius: 5px; font-size: 0.9rem; }
  .field input:focus { outline: none; border-color: #14140f; }
  .login-btn { width: 100%; padding: 11px; background: #14140f; color: #fff; border: none; border-radius: 5px; font-size: 0.9rem; font-weight: 600; cursor: pointer; margin-top: 6px; }
  .login-btn:hover { opacity: 0.9; }
  .login-err { color: #b8433a; font-size: 0.8rem; margin-top: 10px; display: none; }
  .login-back { text-align: center; margin-top: 18px; font-size: 0.78rem; }
  .login-back a { color: #9a9488; text-decoration: none; }
</style>
</head>
<body>
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
  .choose-wrap { max-width: 640px; margin: 100px auto; padding: 0 24px; text-align: center; }
  .choose-wrap h1 { font-size: 1.7rem; margin-bottom: 8px; font-weight: 700; }
  .choose-wrap .sub2 { color: #9a9488; margin-bottom: 40px; }
  .choose-row { display: flex; gap: 18px; justify-content: center; }
  .choose-card { flex: 1; max-width: 220px; padding: 30px 20px; background: #fff; border: 1.4px solid #eeece4; border-radius: 10px; text-decoration: none; color: #14140f; transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .choose-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(0,0,0,0.1); border-color: #14140f; }
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
console.log('✓ Landing page redesign (v2, matching the reference design) applied: new home page, /login, and /choose are live.');
