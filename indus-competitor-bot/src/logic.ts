import { createHash } from 'node:crypto';
import { fetchText, type TaskContext, type TaskResult } from '@indus/bot-core';

export function robotsAllows(robots: string, pathName: string): boolean {
  const lines = robots.split('\n').map((line) => line.trim());
  let star = false;
  const disallows: string[] = [];
  for (const line of lines) {
    if (/^user-agent:\s*\*/i.test(line)) star = true;
    else if (/^user-agent:/i.test(line)) star = false;
    else if (star && /^disallow:/i.test(line)) disallows.push(line.split(':').slice(1).join(':').trim());
  }
  return !disallows.some((rule) => rule && pathName.startsWith(rule));
}

export function hashText(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You compare public competitor pages for INDUS. Do not invent prices you did not read.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 280) };
  }
  const pages = (Array.isArray(ctx.settings.pages) ? ctx.settings.pages : []) as string[];
  ctx.db.exec(`CREATE TABLE IF NOT EXISTS pages (url TEXT PRIMARY KEY, hash TEXT, excerpt TEXT, checked_at TEXT)`);
  const changes: string[] = [];
  for (const pageUrl of pages) {
    const url = new URL(pageUrl);
    const robots = await fetchText(new URL('/robots.txt', url.origin).toString(), ctx.fetch, 8000);
    if (robots.ok && !robotsAllows(robots.text, url.pathname)) {
      ctx.log('info', `Skipped ${pageUrl} because robots.txt disallows it.`);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    const page = await fetchText(pageUrl, ctx.fetch, 8000);
    if (!page.ok) continue;
    const hash = hashText(page.text.slice(0, 20000));
    const prev = ctx.db.prepare(`SELECT hash FROM pages WHERE url = ?`).get(pageUrl) as { hash: string } | undefined;
    ctx.db.prepare(`INSERT INTO pages (url, hash, excerpt, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET hash = excluded.hash, excerpt = excluded.excerpt, checked_at = excluded.checked_at`).run(pageUrl, hash, page.text.slice(0, 280), ctx.now.toISOString());
    if (prev && prev.hash !== hash) changes.push(pageUrl);
  }
  if (changes.length) {
    const summary = await ctx.llm('Summarize public page changes in under 80 words. This is a competitor note.', changes.join('\n'));
    ctx.propose({ type: 'note', title: 'Competitor pages changed', summary: summary.text.slice(0, 240), body: summary.text, payload: { pages: changes } });
  }
  return { summary: changes.length ? `${changes.length} page${changes.length === 1 ? '' : 's'} changed.` : `Checked ${pages.length} pages. No change.` };
}
