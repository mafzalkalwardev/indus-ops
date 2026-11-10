import { createBotService, extractJson, type BotDeps, type TaskContext, type TaskResult } from '@indus/bot-core';
import { commanderPage } from './page';
import { preparePlan } from './plan';

const svc = createBotService({
  id: 'commander',
  name: 'Commander',
  description: 'Reads the fleet each morning, writes a plan, and refuses to publish, send, or deploy.',
  accent: '#7ee0ff',
  defaultPort: 41749,
  capabilities: ['plan', 'orchestrate'],
  defaultSettings: { goals: 'Grow organic traffic for MailForge. Answer new inquiries with drafts only.' },
  fields: [{ key: 'goals', label: 'Goals', type: 'lines' }],
  desired: [
    { key: 'plan', task: 'plan', cron: '0 7 * * *', group: 'llm' },
    { key: 'summary', task: 'summary', cron: '30 18 * * *', group: 'llm' },
  ],
  autoTask: 'plan',
  page: () => commanderPage(),
  routes: (app, deps) => {
    ensure(deps.db);
    app.get('/api/feed', async (_req, res) => res.json(await feed(deps)));
    app.put('/api/goals', (req, res) => {
      const current = deps.settings();
      const goals = String(req.body?.goals || '');
      deps.db.prepare(`INSERT INTO kv (key, value_json) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`)
        .run(JSON.stringify({ ...current, goals }));
      res.json({ ok: true });
    });
  },
  runTask: (ctx) => run(ctx),
});

function ensure(db: BotDeps['db']) {
  db.exec(`CREATE TABLE IF NOT EXISTS thoughts (id INTEGER PRIMARY KEY, at TEXT NOT NULL, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY, at TEXT NOT NULL, reasoning TEXT NOT NULL, actions_json TEXT NOT NULL, rejected_json TEXT NOT NULL);`);
}

ensure(svc.db);

function note(db: BotDeps['db'], text: string) {
  db.prepare(`INSERT INTO thoughts (at, text) VALUES (?, ?)`).run(new Date().toISOString(), text);
}

async function feed(deps: BotDeps) {
  ensure(deps.db);
  const thoughts = deps.db.prepare(`SELECT at, text FROM thoughts ORDER BY id DESC LIMIT 20`).all().reverse();
  const decisions = (deps.db.prepare(`SELECT at, reasoning, actions_json, rejected_json FROM decisions ORDER BY id DESC LIMIT 6`).all() as {
    at: string; reasoning: string; actions_json: string; rejected_json: string;
  }[]).map((row) => ({ at: row.at, reasoning: row.reasoning, actions: JSON.parse(row.actions_json), rejected: JSON.parse(row.rejected_json) })).reverse();
  const headers = { authorization: `Bearer ${deps.env.INDUS_BOT_TOKEN || 'dev-bot-token'}` };
  let fleet: { id: string; name: string }[] = [];
  let paused = false;
  try {
    const response = await fetch(new URL('/api/internal/fleet', deps.env.HUB_URL || 'http://127.0.0.1:41731'), { headers, signal: AbortSignal.timeout(2500) });
    if (response.ok) fleet = ((await response.json()) as { bots: { id: string; name: string }[] }).bots;
  } catch { /* hub still booting */ }
  try {
    const response = await fetch(new URL('/api/internal/state', deps.env.SCHEDULER_URL || 'http://127.0.0.1:41748'), { headers, signal: AbortSignal.timeout(2500) });
    if (response.ok) paused = Boolean((await response.json() as { paused?: boolean }).paused);
  } catch { /* scheduler still booting */ }
  return { thoughts, decisions, fleet, paused, goals: String(deps.settings().goals || '') };
}

async function run(ctx: TaskContext): Promise<TaskResult> {
  ensure(ctx.db);
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You are the INDUS commander. You may plan internal checks and drafts. You must never send, post, deploy, or approve.', String(ctx.payload.message || ''));
    note(ctx.db, reply.text.slice(0, 500));
    return { summary: reply.text.slice(0, 240) };
  }
  if (ctx.task === 'summary') return summary(ctx);
  return plan(ctx);
}

async function plan(ctx: TaskContext): Promise<TaskResult> {
  const headers = { authorization: `Bearer ${ctx.db ? process.env.INDUS_BOT_TOKEN || 'dev-bot-token' : ''}` };
  const hub = process.env.HUB_URL || 'http://127.0.0.1:41731';
  const scheduler = process.env.SCHEDULER_URL || 'http://127.0.0.1:41748';
  note(ctx.db, 'Reading the fleet and the goals.');
  let paused = false;
  try {
    const state = await fetch(new URL('/api/internal/state', scheduler), { headers, signal: AbortSignal.timeout(3000) });
    if (state.ok) paused = Boolean((await state.json() as { paused?: boolean }).paused);
  } catch { /* first boot */ }
  if (paused) {
    note(ctx.db, 'Pause-all is on. No tasks were queued.');
    return { summary: 'Paused. Nothing was queued.' };
  }
  let fleet: { id: string; name: string; base_url: string }[] = [];
  try {
    const response = await fetch(new URL('/api/internal/fleet', hub), { headers, signal: AbortSignal.timeout(3000) });
    if (response.ok) fleet = ((await response.json()) as { bots: typeof fleet }).bots;
  } catch { /* empty fleet */ }
  const known = fleet.map((bot) => bot.id);
  const snapshots = [];
  for (const bot of fleet.slice(0, 20)) {
    try {
      const response = await fetch(new URL('/api/internal/state', bot.base_url), { headers, signal: AbortSignal.timeout(2500) });
      if (response.ok) {
        const state = await response.json() as { lastSummary?: string; pendingApprovals?: number; status?: string };
        snapshots.push(`${bot.id}: ${state.status || 'idle'}, pending ${state.pendingApprovals || 0}, ${state.lastSummary || 'no result'}`);
      }
    } catch { snapshots.push(`${bot.id}: unreachable`); }
  }
  note(ctx.db, snapshots.join(' | ') || 'No bots have registered yet.');
  const goals = String(ctx.settings.goals || '');
  let parsed: unknown = {};
  try {
    const reply = await ctx.llm(
      'You write the INDUS daily plan as JSON with keys reasoning and actions. actions are {botId, task, reason}. Tasks may only be internal checks, drafts, renders, audits, and digests. Never choose publish, send, deploy, approve, or restore.',
      `Goals:\n${goals}\n\nFleet:\n${snapshots.join('\n')}\n\nWrite the daily plan.`,
    );
    parsed = extractJson(reply.text);
    note(ctx.db, `Model answered in ${reply.durationMs} ms.`);
  } catch (error) {
    note(ctx.db, `Model unavailable (${error instanceof Error ? error.message : error}). Using the standing checks.`);
  }
  const prepared = preparePlan(parsed, known.length ? known : ['monitor', 'inquiries', 'reports']);
  note(ctx.db, prepared.reasoning);
  let queued = 0;
  for (const action of prepared.accepted) {
    if (action.botId === 'commander') continue;
    const response = await fetch(new URL('/api/internal/jobs', scheduler), {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ botId: action.botId, task: action.task, group: action.task === 'render' ? 'video' : 'llm', payload: action.payload || {}, runAt: new Date().toISOString() }),
    }).catch(() => null);
    if (response?.ok) {
      queued += 1;
      note(ctx.db, `Queued ${action.botId} ${action.task}: ${action.reason}`);
    } else note(ctx.db, `Could not queue ${action.botId}. It may not have registered.`);
  }
  ctx.db.prepare(`INSERT INTO decisions (at, reasoning, actions_json, rejected_json) VALUES (?, ?, ?, ?)`)
    .run(new Date().toISOString(), prepared.reasoning, JSON.stringify(prepared.accepted), JSON.stringify(prepared.rejected));
  return { summary: `Plan queued ${queued} internal task${queued === 1 ? '' : 's'}. ${prepared.rejected.length} blocked.`, details: prepared };
}

async function summary(ctx: TaskContext): Promise<TaskResult> {
  note(ctx.db, 'Writing the end-of-day note from the decisions already logged.');
  const rows = ctx.db.prepare(`SELECT reasoning FROM decisions ORDER BY id DESC LIMIT 5`).all() as { reasoning: string }[];
  const reply = await ctx.llm('Summarize the day for the INDUS owner in under 120 words. Do not claim anything was published.', rows.map((row) => row.reasoning).join('\n') || 'No decisions today.');
  note(ctx.db, reply.text.slice(0, 700));
  return { summary: reply.text.slice(0, 280) };
}

svc.start().catch((error) => {
  console.error(error);
  process.exit(1);
});
