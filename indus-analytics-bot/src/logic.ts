import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TaskContext, TaskResult } from '@indus/bot-core';

export function visitorKey(ip: string, ua: string, day: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${day}|${ip}|${ua}`).digest('hex').slice(0, 20);
}

export function parseNginx(line: string): { path: string; referrer: string; status: number } | null {
  const match = /"\w+ ([^ ]+) [^"]+" (\d{3})/.exec(line);
  if (!match) return null;
  const ref = /"([^"]*)"\s*$/.exec(line);
  return { path: match[1], status: Number(match[2]), referrer: ref?.[1] && ref[1] !== '-' ? ref[1] : '' };
}

export function rollup(rows: { path: string; referrer: string; day: string }[]): { path: string; views: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.path, (counts.get(row.path) || 0) + 1);
  return [...counts.entries()].map(([pathName, views]) => ({ path: pathName, views })).sort((a, b) => b.views - a.views);
}

export function ensure(db: TaskContext['db']) {
  db.exec(`CREATE TABLE IF NOT EXISTS hits (
    id INTEGER PRIMARY KEY, site TEXT, path TEXT, referrer TEXT, day TEXT, visitor TEXT, created_at TEXT
  )`);
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  ensure(ctx.db);
  if (ctx.task === 'instruct') return { summary: 'Analytics stores paths and a daily hash, never a raw IP.' };
  const file = String(ctx.settings.nginxLog || '');
  let imported = 0;
  if (file) {
    try {
      const lines = readFileSync(file, 'utf8').split('\n').slice(-5000);
      for (const line of lines) {
        const hit = parseNginx(line);
        if (!hit || hit.status >= 400) continue;
        ctx.db.prepare(`INSERT INTO hits (site, path, referrer, day, visitor, created_at) VALUES ('nginx', ?, ?, ?, '', ?)`).run(hit.path, hit.referrer, ctx.now.toISOString().slice(0, 10), ctx.now.toISOString());
        imported += 1;
      }
    } catch (error) {
      ctx.log('warn', error instanceof Error ? error.message : String(error));
    }
  }
  const rows = ctx.db.prepare(`SELECT path, referrer, day FROM hits WHERE day = ?`).all(ctx.now.toISOString().slice(0, 10)) as { path: string; referrer: string; day: string }[];
  return { summary: `${rows.length} hits today. Imported ${imported} log lines.`, details: { top: rollup(rows).slice(0, 8) } };
}
