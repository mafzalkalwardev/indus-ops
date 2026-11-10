export function hubPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>INDUS Ops</title>
  <style>
    :root { color-scheme: dark; --bg:#10140f; --card:#1a211c; --ink:#e7eee4; --muted:#b7c4b6; --line:#2e382f; --brass:#e0b15c; --bad:#d36b5c; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; color:var(--ink); background:
      radial-gradient(1000px 420px at 10% -10%, rgba(224,177,92,.16), transparent 55%),
      var(--bg); font: 15px/1.5 "Avenir Next", "Segoe UI", sans-serif; }
    a { color: inherit; }
    header { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; padding:22px; border-bottom:1px solid var(--line); }
    h1, h2 { font-family: Georgia, serif; font-weight: 500; letter-spacing:-.03em; margin:0; }
    h1 { font-size: 40px; }
    .mark { color: var(--brass); letter-spacing:.16em; font-size:12px; }
    nav { display:flex; gap:8px; flex-wrap:wrap; padding:12px 22px; }
    nav button, form button, .ghost { background:var(--brass); color:#221a0c; border:0; border-radius:999px; padding:8px 14px; cursor:pointer; font:inherit; }
    .ghost, nav button { background:transparent; color:var(--ink); border:1px solid var(--line); }
    main { padding: 8px 22px 48px; display:grid; gap:14px; }
    .grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:12px; }
    article, .auth { background: rgba(26,33,28,.92); border:1px solid var(--line); border-radius:18px; padding:16px; }
    .auth { max-width: 420px; margin: 8vh auto; }
    label { display:grid; gap:4px; margin:0 0 10px; color:var(--muted); font-size:13px; }
    input, textarea { width:100%; background:#0e120f; color:var(--ink); border:1px solid var(--line); border-radius:10px; padding:8px 10px; font:inherit; }
    textarea { min-height: 90px; }
    .sub { color:var(--muted); font-size:13px; }
    .pill { border:1px solid var(--line); border-radius:999px; padding:2px 8px; font-size:12px; }
    .bad { color: var(--bad); }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } h1 { font-size: 32px; } }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    let csrf = '';
    const app = document.getElementById('app');
    function esc(v){return String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
    async function api(path, opts){
      const headers = Object.assign({'content-type':'application/json'}, (opts&&opts.headers)||{});
      if (csrf && opts && opts.method && opts.method !== 'GET') headers['x-csrf-token'] = csrf;
      const res = await fetch(path, Object.assign({}, opts, { headers }));
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }
    function shell(title, body){
      app.innerHTML = '<header><div><div class="mark">INDUS WEB AGENCY</div><h1>'+title+'</h1><p class="sub">One login. Bots stay on this machine. Nothing public leaves without an approval.</p></div></header><nav><button type="button" data-go="overview">Overview</button><button type="button" data-go="inbox">Inbox</button><button type="button" data-go="instruct">Instruct</button><button type="button" id="out">Sign out</button></nav><main>'+body+'</main>';
      app.querySelectorAll('[data-go]').forEach(btn => btn.onclick = () => show(btn.dataset.go));
      const out = document.getElementById('out');
      if (out) out.onclick = async () => { await api('/api/logout', {method:'POST', body:'{}'}); boot(); };
    }
    async function show(name){
      if (name === 'inbox') return inbox();
      if (name === 'instruct') return instruct();
      const data = await api('/api/overview');
      const cards = (data.bots||[]).map(bot => '<article><div class="pill">'+(bot.online?'online':'quiet')+'</div><h2>'+esc(bot.name)+'</h2><p class="sub">'+esc(bot.description)+'</p><p>'+esc(bot.lastSummary||'No run yet.')+'</p><p class="sub">Pending '+esc(bot.pendingApprovals||0)+'</p><p><a href="/bots/'+esc(bot.id)+'/">Open '+esc(bot.name)+'</a></p></article>').join('') || '<article><h2>Waiting for bots</h2><p>Start the bot processes. They register themselves within a few seconds.</p></article>';
      shell('Ops', '<p class="sub">'+(data.paused?'Scheduler is paused. ':'')+esc(data.pending||0)+' approvals waiting.</p><section class="grid">'+cards+'</section>');
    }
    async function inbox(){
      const data = await api('/api/inbox');
      const rows = (data.approvals||[]).map(item => '<article data-bot="'+esc(item.botId)+'" data-id="'+item.id+'"><div class="pill">'+esc(item.botId)+' · '+esc(item.type)+'</div><h2>'+esc(item.title)+'</h2><p class="sub">'+esc(item.summary)+'</p><textarea>'+esc(item.body)+'</textarea><p><button type="button" data-act="approve">Approve</button> <button type="button" class="ghost" data-act="reject">Reject</button></p></article>').join('') || '<article><h2>Inbox zero</h2><p>Drafts from the bots land here. Approving is the only way mail, posts, deploys, or fixes go out.</p></article>';
      shell('Inbox', '<section class="grid">'+rows+'</section>');
      app.querySelectorAll('article[data-id] button').forEach(btn => btn.onclick = async () => {
        const card = btn.closest('article');
        await api('/api/inbox/'+card.dataset.bot+'/'+card.dataset.id+'/'+btn.dataset.act, { method:'POST', body: JSON.stringify({ body: card.querySelector('textarea').value }) });
        inbox();
      });
    }
    async function instruct(){
      const data = await api('/api/overview');
      const options = (data.bots||[]).map(bot => '<option value="'+esc(bot.id)+'">'+esc(bot.name)+'</option>').join('');
      shell('Instruct', '<article><p class="sub">This queues a private instruction. The bot answers with the local model. It still cannot send or publish.</p><label>Bot<select id="bot">'+options+'</select></label><label>Instruction<textarea id="msg"></textarea></label><button id="send" type="button">Queue it</button><p id="note" class="sub"></p></article>');
      document.getElementById('send').onclick = async () => {
        const result = await api('/api/instruct', { method:'POST', body: JSON.stringify({ botId: document.getElementById('bot').value, message: document.getElementById('msg').value }) });
        document.getElementById('note').textContent = 'Queued as job '+result.id+'. The scheduler will run it when the CPU lock is free.';
      };
    }
    function auth(setup){
      app.innerHTML = '<form class="auth"><div class="mark">INDUS OPS</div><h1>'+(setup?'Create the owner':'Owner sign in')+'</h1><p class="sub">The first account owns the board. Bots do not get their own passwords.</p>'+(setup?'<label>Setup token<input id="token" type="password" autocomplete="off"></label>':'')+'<label>Username<input id="user" autocomplete="username"></label><label>Password<input id="pass" type="password" autocomplete="'+(setup?'new-password':'current-password')+'"></label><button type="submit">'+(setup?'Create account':'Sign in')+'</button><p id="err" class="bad"></p></form>';
      app.querySelector('form').onsubmit = async (event) => {
        event.preventDefault();
        try {
          const body = { username: document.getElementById('user').value, password: document.getElementById('pass').value };
          if (setup) body.token = document.getElementById('token').value;
          const data = await api(setup?'/api/setup':'/api/login', { method:'POST', body: JSON.stringify(body) });
          csrf = data.csrf;
          show('overview');
        } catch (error) { document.getElementById('err').textContent = error.message; }
      };
    }
    async function boot(){
      const session = await api('/api/session');
      csrf = session.csrf || '';
      if (session.setupRequired) return auth(true);
      if (!session.user) return auth(false);
      show('overview');
    }
    boot();
  </script>
</body>
</html>`;
}
