import type { FieldSpec } from './protocol';

export function renderBotPage(input: {
  id: string;
  name: string;
  description: string;
  accent: string;
  fields: FieldSpec[];
  settings: Record<string, unknown>;
  secretsSet: Record<string, boolean>;
  extraHtml?: string;
}): string {
  const boot = JSON.stringify({
    fields: input.fields,
    settings: input.settings,
    secretsSet: input.secretsSet,
  }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(input.name)} · INDUS</title>
  <style>
    :root { color-scheme: dark; --bg:#121613; --card:#1b221d; --ink:#e8eee4; --muted:#b7c4b6; --line:#313b33; --accent:${input.accent}; --danger:#d36b5c; --ok:#8fbf98; }
    * { box-sizing: border-box; }
    body { margin:0; font: 15px/1.5 "Avenir Next", "Segoe UI", sans-serif; background:
      radial-gradient(900px 280px at 0 -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 50%),
      var(--bg); color: var(--ink); }
    header { display:flex; gap:16px; align-items:flex-end; justify-content:space-between; padding:28px 22px 18px; border-bottom:1px solid var(--line); }
    .mark { font-family: Georgia, serif; letter-spacing:.14em; font-size:12px; color: var(--accent); }
    h1 { font-family: Georgia, serif; font-weight:500; font-size:34px; margin:0; letter-spacing:-.03em; }
    h2 { font-family: Georgia, serif; font-weight:500; font-size:20px; margin:0 0 12px; }
    p { margin:4px 0 0; color: var(--muted); max-width: 62ch; }
    main { padding:18px 22px 48px; display:grid; gap:14px; }
    .metrics, .grid { display:grid; gap:14px; }
    .metrics { grid-template-columns: repeat(4, minmax(0,1fr)); }
    .grid { grid-template-columns: 1.1fr .9fr; }
    article, .metric { background: color-mix(in srgb, var(--card) 92%, black); border:1px solid var(--line); border-radius:16px; padding:16px; }
    .metric b { display:block; font-family: Georgia, serif; font-size:22px; font-weight:500; }
    .metric span, .sub { color: var(--muted); font-size:12px; }
    button, input, textarea, select { font: inherit; color: inherit; }
    button { background: var(--accent); color:#1a1408; border:0; border-radius:999px; padding:8px 14px; cursor:pointer; }
    button.ghost { background:transparent; color:var(--ink); border:1px solid var(--line); }
    button.danger { background: transparent; color: var(--danger); border:1px solid var(--danger); }
    textarea, input[type=text], input[type=number], input[type=password] { width:100%; background:#101410; border:1px solid var(--line); border-radius:10px; padding:8px 10px; }
    textarea { min-height: 88px; }
    label { display:grid; gap:4px; margin:0 0 10px; font-size:13px; color: var(--muted); }
    .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .job, .approval { border-top:1px solid var(--line); padding:10px 0; }
    .pill { border-radius:999px; padding:2px 8px; border:1px solid var(--line); font-size:12px; }
    .pill.run { color:#1a1408; background: var(--accent); border-color: transparent; }
    .pill.bad { color: var(--danger); }
    .pill.ok { color: var(--ok); }
    pre { white-space: pre-wrap; word-break: break-word; margin:0; color:#d5e0d4; font: 12px/1.45 ui-monospace, monospace; max-height: 280px; overflow:auto; }
    .check { display:flex; gap:8px; align-items:center; color: var(--ink); }
    @media (max-width: 860px) {
      .metrics, .grid { grid-template-columns: 1fr; }
      header { flex-direction: column; align-items: flex-start; }
      h1 { font-size: 28px; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="mark">INDUS · ${escapeHtml(input.id)}</div>
      <h1>${escapeHtml(input.name)}</h1>
      <p>${escapeHtml(input.description)}</p>
    </div>
    <div class="pill" id="pill">…</div>
  </header>
  <main>
    <section class="metrics" id="metrics"></section>
    <section class="grid">
      <article>
        <h2>Queue</h2>
        <div class="row">
          <button id="run" type="button">Run now</button>
          <label class="check"><input id="dry" type="checkbox" checked> Dry run</label>
        </div>
        <div id="jobs"></div>
      </article>
      <article>
        <h2>Approvals</h2>
        <p class="sub">Nothing here is sent, posted, or deployed until you approve it on this screen or in the hub.</p>
        <div id="approvals"></div>
      </article>
    </section>
    <article>
      <h2>Logs</h2>
      <pre id="logs">Waiting for the first line.</pre>
    </article>
    <article>
      <h2>Settings</h2>
      <form id="settings"></form>
    </article>
    ${input.extraHtml || ''}
  </main>
  <script>
    const boot = ${boot};
    const $ = (id) => document.getElementById(id);
    function csrfHeaders(extra) {
      const headers = Object.assign({ 'content-type': 'application/json' }, extra || {});
      if (window.__INDUS_CSRF__) headers['x-csrf-token'] = window.__INDUS_CSRF__;
      return headers;
    }
    async function api(path, opts) {
      const res = await fetch(path, Object.assign({ headers: csrfHeaders() }, opts || {}));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }
    function pill(status) {
      const el = $('pill');
      el.textContent = status;
      el.className = 'pill ' + (status === 'running' ? 'run' : status === 'error' ? 'bad' : 'ok');
    }
    function render(state) {
      pill(state.status || 'idle');
      const cards = [
        ['Last run', state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'Not yet'],
        ['Pending', String(state.pendingApprovals || 0)],
        ['Queue', String((state.queue && state.queue.queued) || 0)],
        ['Model', state.llm && state.llm.model || ''],
      ];
      $('metrics').innerHTML = cards.map(([k,v]) => '<div class="metric"><span>'+k+'</span><b>'+escapeText(v)+'</b></div>').join('');
      $('jobs').innerHTML = (state.jobs || []).map((job) => '<div class="job"><b>'+escapeText(job.task)+'</b> <span class="pill '+(job.status==='error'?'bad':job.status==='done'?'ok':'')+'">'+escapeText(job.status)+(job.dryRun?' · dry':'')+'</span><div class="sub">'+escapeText(job.summary || job.error || '')+'</div></div>').join('') || '<p class="sub">The queue is empty.</p>';
      $('logs').textContent = (state.logs || []).map((line) => line.createdAt.slice(11,19)+'  '+line.level+'  '+line.message).join('\\n') || 'No log lines yet.';
      $('approvals').innerHTML = (state.approvals || []).map((item) => '<div class="approval" data-id="'+item.id+'"><b>'+escapeText(item.title)+'</b><div class="sub">'+escapeText(item.type)+'</div><textarea>'+escapeText(item.body)+'</textarea><div class="row"><button type="button" data-act="approve">Approve</button><button type="button" class="danger" data-act="reject">Reject</button></div></div>').join('') || '<p class="sub">No drafts waiting.</p>';
    }
    function escapeText(value) {
      return String(value ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    }
    function settingsForm(data) {
      const form = $('settings');
      form.innerHTML = boot.fields.map((field) => {
        const value = data.settings[field.key];
        if (field.type === 'bool') return '<label class="check"><input type="checkbox" name="'+field.key+'" '+(value?'checked':'')+'> '+escapeText(field.label)+'</label>';
        if (field.type === 'lines') return '<label>'+escapeText(field.label)+'<textarea name="'+field.key+'">'+escapeText(Array.isArray(value)?value.join('\\n'):value||'')+'</textarea></label>';
        const type = field.secret ? 'password' : field.type === 'number' ? 'number' : 'text';
        const placeholder = field.secret && data.secretsSet[field.key] ? 'Saved. Leave blank to keep it.' : '';
        return '<label>'+escapeText(field.label)+'<input type="'+type+'" name="'+field.key+'" value="'+escapeText(field.secret?'':value??'')+'" placeholder="'+escapeText(placeholder)+'"></label>';
      }).join('') + '<button type="submit">Save settings</button><span class="sub" id="saved"></span>';
    }
    async function refresh() {
      if (document.hidden) return;
      const state = await api('api/status');
      render(state);
    }
    $('run').onclick = async () => {
      $('run').disabled = true;
      try { await api('api/jobs/run', { method:'POST', body: JSON.stringify({ task: 'auto', dryRun: $('dry').checked }) }); await refresh(); }
      catch (error) { alert(error.message); }
      $('run').disabled = false;
    };
    $('approvals').onclick = async (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const card = button.closest('.approval');
      const body = card.querySelector('textarea').value;
      try {
        await api('api/approvals/'+card.dataset.id+'/'+button.dataset.act, { method:'POST', body: JSON.stringify({ body }) });
        await refresh();
      } catch (error) { alert(error.message); }
    };
    $('settings').onsubmit = async (event) => {
      event.preventDefault();
      const data = {};
      for (const field of boot.fields) {
        const el = event.target.elements[field.key];
        if (!el) continue;
        if (field.type === 'bool') data[field.key] = el.checked;
        else if (field.type === 'number') data[field.key] = Number(el.value);
        else if (field.type === 'lines') data[field.key] = el.value.split(/\\n/).map((x)=>x.trim()).filter(Boolean);
        else data[field.key] = el.value;
      }
      await api('api/settings', { method:'PUT', body: JSON.stringify(data) });
      $('saved').textContent = 'Saved.';
    };
    settingsForm(boot);
    refresh().catch((error) => { $('logs').textContent = error.message; });
    setInterval(() => refresh().catch(() => {}), 4000);
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}
