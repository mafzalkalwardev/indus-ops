export function commanderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
  <title>Commander · INDUS</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin:0; height:100%; background:#070b12; color:#d7e6f2; font: 14px/1.45 "Avenir Next", "Segoe UI", sans-serif; }
    canvas { position:fixed; inset:0; width:100%; height:100%; z-index:0; }
    .ui { position:relative; z-index:1; min-height:100%; display:grid; grid-template-rows:auto 1fr auto; }
    header, footer { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:16px 18px; }
    h1 { font-family: Georgia, serif; font-weight:500; margin:0; font-size:28px; letter-spacing:-.03em; }
    .mark { color:#7ee0ff; letter-spacing:.18em; font-size:11px; }
    button { background:#7ee0ff; color:#041018; border:0; border-radius:999px; padding:8px 14px; font:inherit; cursor:pointer; }
    .layout { display:grid; grid-template-columns: 280px 1fr 300px; gap:12px; padding:0 18px 12px; min-height:0; }
    section { background: rgba(8,14,24,.72); border:1px solid rgba(126,224,255,.18); border-radius:18px; padding:12px; backdrop-filter: blur(8px); overflow:auto; max-height: calc(100vh - 210px); }
    h2 { margin:0 0 8px; font-size:13px; letter-spacing:.14em; color:#9fd8ea; font-weight:600; }
    .thought { border-top:1px solid rgba(126,224,255,.15); padding:8px 0; }
    .thought b { color:#e7b15a; font-weight:600; }
    svg { width:100%; height:260px; }
    .node { fill:#102033; stroke:#7ee0ff; }
    .label { fill:#d7e6f2; font-size:10px; }
    footer { display:grid; grid-template-columns: 1.4fr .8fr; gap:12px; }
    .cards { display:flex; gap:8px; overflow:auto; }
    .card { min-width: 180px; background: rgba(8,14,24,.72); border:1px solid rgba(231,177,90,.3); border-radius:14px; padding:10px; }
    textarea, input { width:100%; background:#0b121c; color:inherit; border:1px solid rgba(126,224,255,.25); border-radius:10px; padding:8px; font:inherit; }
    @media (max-width: 980px) {
      .layout, footer { grid-template-columns: 1fr; }
      section { max-height: none; }
    }
  </style>
</head>
<body>
<canvas id="orb"></canvas>
<div class="ui">
  <header>
    <div><div class="mark">INDUS COMMAND</div><h1 id="title">Morning watch</h1></div>
    <div><button id="plan" type="button">Run the day</button> <span id="pause"></span></div>
  </header>
  <div class="layout">
    <section><h2>THOUGHTS</h2><div id="thoughts"></div></section>
    <section><h2>FLEET</h2><svg id="graph" viewBox="0 0 360 260"></svg><p id="why"></p></section>
    <section><h2>GOALS</h2><textarea id="goals" placeholder="Grow organic traffic for MailForge. Keep every public reply in the inbox."></textarea><button id="save" type="button">Save goals</button></section>
  </div>
  <footer>
    <div><h2 style="padding-left:18px">TODAY</h2><div class="cards" id="cards"></div></div>
    <div style="padding-right:18px"><h2>REJECTED</h2><div id="rejected"></div></div>
  </footer>
</div>
<script>
  const canvas = document.getElementById('orb');
  const ctx = canvas.getContext('2d');
  const dots = Array.from({length: 48}, (_, i) => ({ a: i / 48 * Math.PI * 2, r: 70 + (i % 5) * 18, s: 0.004 + (i % 3) * 0.002 }));
  let pulse = 0.4;
  function frame(t) {
    const w = canvas.width = window.innerWidth * devicePixelRatio;
    const h = canvas.height = window.innerHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);
    const x = w * 0.52, y = h * 0.46;
    const g = ctx.createRadialGradient(x, y, 20, x, y, 220 * devicePixelRatio);
    g.addColorStop(0, 'rgba(126,224,255,' + (0.25 + pulse * 0.35) + ')');
    g.addColorStop(1, 'rgba(7,11,18,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 240 * devicePixelRatio, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(126,224,255,.45)'; ctx.lineWidth = 1.2 * devicePixelRatio;
    for (const dot of dots) {
      dot.a += dot.s * (0.6 + pulse);
      ctx.beginPath();
      ctx.arc(x + Math.cos(dot.a) * dot.r * devicePixelRatio, y + Math.sin(dot.a * 1.3) * dot.r * 0.62 * devicePixelRatio, 2.2 * devicePixelRatio, 0, 7);
      ctx.stroke();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  function headers(){const h={'content-type':'application/json'}; if (window.__INDUS_CSRF__) h['x-csrf-token']=window.__INDUS_CSRF__; return h;}
  async function api(path, opts){ const res = await fetch(path, Object.assign({headers:headers()}, opts||{})); const data = await res.json(); if(!res.ok) throw new Error(data.error||res.statusText); return data; }
  function draw(data){
    pulse = data.paused ? 0.15 : Math.min(1, 0.35 + (data.thoughts||[]).length / 20);
    document.getElementById('pause').textContent = data.paused ? 'Paused' : 'Live';
    document.getElementById('title').textContent = data.paused ? 'Holding' : 'Morning watch';
    document.getElementById('thoughts').innerHTML = (data.thoughts||[]).slice(-12).map(t => '<div class="thought"><b>'+new Date(t.at).toLocaleTimeString()+'</b> '+escape(t.text)+'</div>').join('') || '<p>The morning pass has not run.</p>';
    const fleet = data.fleet || [];
    const cx = 180, cy = 128, rad = 108;
    const nodes = fleet.map((bot, i) => {
      const a = -Math.PI/2 + i / Math.max(fleet.length, 1) * Math.PI * 2;
      return { ...bot, x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * (rad * 0.72) };
    });
    document.getElementById('graph').innerHTML = nodes.map(n => '<line x1="'+cx+'" y1="'+cy+'" x2="'+n.x+'" y2="'+n.y+'" stroke="rgba(126,224,255,.35)" />').join('')
      + '<circle cx="'+cx+'" cy="'+cy+'" r="18" fill="#123" stroke="#e7b15a" />'
      + nodes.map(n => '<g><circle class="node" cx="'+n.x+'" cy="'+n.y+'" r="11"></circle><text class="label" x="'+n.x+'" y="'+(n.y+20)+'" text-anchor="middle">'+escape(n.id)+'</text></g>').join('');
    const last = (data.decisions||[]).at(-1);
    document.getElementById('why').textContent = last ? last.reasoning : 'Decisions show their reasoning here.';
    document.getElementById('cards').innerHTML = (last && last.actions || []).map(a => '<div class="card"><b>'+escape(a.botId)+'</b><div>'+escape(a.task)+'</div><div>'+escape(a.reason)+'</div></div>').join('') || '<div class="card">No plan yet.</div>';
    document.getElementById('rejected').innerHTML = (last && last.rejected || []).map(a => '<div>'+escape(a.action.botId)+' / '+escape(a.action.task)+' — '+escape(a.reason)+'</div>').join('') || '<div>Nothing blocked on the last pass.</div>';
    if (data.goals && document.activeElement !== document.getElementById('goals')) document.getElementById('goals').value = data.goals;
  }
  function escape(v){return String(v??'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
  async function refresh(){ try { draw(await api('api/feed')); } catch (error) { document.getElementById('why').textContent = error.message; } }
  document.getElementById('plan').onclick = async () => { await api('api/jobs/run', { method:'POST', body: JSON.stringify({ task:'plan', dryRun:false }) }); };
  document.getElementById('save').onclick = async () => { await api('api/goals', { method:'PUT', body: JSON.stringify({ goals: document.getElementById('goals').value }) }); };
  refresh(); setInterval(refresh, 2000);
</script>
</body></html>`;
}
