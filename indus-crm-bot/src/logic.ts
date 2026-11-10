import { extractJson, type TaskContext, type TaskResult } from '@indus/bot-core';

export const STAGES = ['new', 'qualified', 'proposal', 'won', 'lost'] as const;

export function followUpDue(stage: string, lastTouch: string, now: Date): boolean {
  if (stage === 'won' || stage === 'lost') return false;
  const days = (now.getTime() - new Date(lastTouch).getTime()) / 86400000;
  return days >= (stage === 'proposal' ? 3 : 5);
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  ctx.db.exec(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, stage TEXT, note TEXT, touched_at TEXT
  )`);
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You are the INDUS CRM. Do not claim a proposal was sent.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 280) };
  }
  const headers = { authorization: `Bearer ${process.env.INDUS_BOT_TOKEN || 'dev-bot-token'}` };
  const hub = process.env.HUB_URL || 'http://127.0.0.1:41731';
  try {
    const fleet = await fetch(new URL('/api/internal/fleet', hub), { headers, signal: AbortSignal.timeout(3000) });
    const bots = fleet.ok ? ((await fleet.json()) as { bots: { id: string; base_url: string }[] }).bots : [];
    for (const bot of bots.filter((item) => item.id === 'inquiries' || item.id === 'leads')) {
      const state = await fetch(new URL('/api/internal/state', bot.base_url), { headers, signal: AbortSignal.timeout(2500) });
      if (!state.ok) continue;
      const body = await state.json() as { approvals?: { title: string; summary: string }[] };
      for (const item of body.approvals || []) {
        const email = `${bot.id}-${item.title}`.toLowerCase().replace(/\s+/g, '-').slice(0, 80) + '@lead.local';
        ctx.db.prepare(`INSERT OR IGNORE INTO clients (email, name, stage, note, touched_at) VALUES (?, ?, 'new', ?, ?)`).run(email, item.title, item.summary, ctx.now.toISOString());
      }
    }
  } catch { ctx.log('warn', 'Fleet was not reachable. CRM kept its own records.'); }
  const due = (ctx.db.prepare(`SELECT * FROM clients`).all() as { email: string; name: string; stage: string; touched_at: string }[])
    .filter((client) => followUpDue(client.stage, client.touched_at, ctx.now));
  if (due[0]) {
    const quote = await ctx.llm('Write quote JSON with a quote field. This is a quote draft.', due[0].name);
    let text = 'The first release covers the public site and the form behind it.';
    try { text = String((extractJson(quote.text) as { quote?: string }).quote || text); } catch { /* fallback */ }
    ctx.propose({ type: 'quote', title: `Quote for ${due[0].name}`, summary: `Stage ${due[0].stage}. Not sent.`, body: text, payload: { email: due[0].email } });
  }
  return { summary: `${due.length} follow-ups due. Quotes stay in the inbox.` };
}
