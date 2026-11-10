import { extractJson, fetchText, type TaskContext, type TaskResult } from '@indus/bot-core';

export function scoreLead(title: string, description: string): number {
  const hay = `${title}\n${description}`;
  let score = 10;
  if (/react|next\.?js|seo|automat/i.test(hay)) score += 30;
  if (/website|web app|freelance/i.test(hay)) score += 15;
  if (/unpaid|internship/i.test(hay)) score -= 25;
  return Math.max(0, Math.min(100, score));
}

export function dedupeKey(url: string, title: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return title.toLowerCase().replace(/\s+/g, ' ').trim();
  }
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You are the INDUS leads bot. Do not claim a proposal was sent.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 280) };
  }
  const found: { title: string; url: string; description: string; source: string }[] = [];
  const remotive = await fetchText('https://remotive.com/api/remote-jobs?category=software-dev', ctx.fetch, 8000);
  if (remotive.ok) {
    const jobs = (JSON.parse(remotive.text) as { jobs?: { title?: string; url?: string; description?: string }[] }).jobs || [];
    for (const job of jobs.slice(0, 15)) found.push({ title: String(job.title || ''), url: String(job.url || ''), description: String(job.description || '').replace(/<[^>]+>/g, ' ').slice(0, 500), source: 'remotive' });
  }
  const rss = await fetchText('https://weworkremotely.com/categories/remote-programming-jobs.rss', ctx.fetch, 8000);
  for (const item of rss.text.match(/<item[\s\S]*?<\/item>/gi)?.slice(0, 10) || []) {
    const title = /<title>([\s\S]*?)<\/title>/i.exec(item)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
    const link = /<link>([\s\S]*?)<\/link>/i.exec(item)?.[1]?.trim() || '';
    if (title) found.push({ title, url: link, description: '', source: 'weworkremotely' });
  }
  ctx.db.exec(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY, dedupe TEXT UNIQUE, title TEXT, url TEXT, score INTEGER, created_at TEXT)`);
  let fresh = 0;
  for (const lead of found) {
    const score = scoreLead(lead.title, lead.description);
    if (score < 40) continue;
    const key = dedupeKey(lead.url, lead.title);
    const inserted = ctx.db.prepare(`INSERT OR IGNORE INTO leads (dedupe, title, url, score, created_at) VALUES (?, ?, ?, ?, ?)`).run(key, lead.title, lead.url, score, ctx.now.toISOString());
    if (!inserted.changes || fresh >= 2) continue;
    fresh += 1;
    const proposal = await ctx.llm('Write proposal JSON with a proposal field. This is a proposal draft for a lead.', `${lead.title}\n${lead.url}`);
    let text = 'INDUS can scope this within a day.';
    try { text = String((extractJson(proposal.text) as { proposal?: string }).proposal || text); } catch { /* fallback */ }
    ctx.propose({ type: 'lead_proposal', title: lead.title, summary: `${lead.source} · score ${score}`, body: text, payload: { url: lead.url, source: lead.source } });
  }
  return { summary: fresh ? `Drafted ${fresh} proposal${fresh === 1 ? '' : 's'} from public listings.` : 'No new leads above the score line.' };
}
