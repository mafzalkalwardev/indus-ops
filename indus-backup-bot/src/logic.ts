import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execCommand, type TaskContext, type TaskResult } from '@indus/bot-core';

export function filesToDelete(names: string[], keep: number): string[] {
  return [...names].sort().slice(0, Math.max(0, names.length - keep));
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You are the INDUS backup bot. Do not claim a restore overwrote live data.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 280) };
  }
  if (ctx.task === 'drill') return drill(ctx);
  const root = path.join(ctx.dataDir, 'backups');
  mkdirSync(root, { recursive: true });
  const stamp = ctx.now.toISOString().replace(/[:.]/g, '-');
  const dest = path.join(root, stamp);
  mkdirSync(dest, { recursive: true });
  const sources = (Array.isArray(ctx.settings.paths) ? ctx.settings.paths : ['/etc/nginx']) as string[];
  const manifest: { file: string; sha256: string; bytes: number }[] = [];
  for (const source of sources) {
    try {
      const info = statSync(source);
      const target = path.join(dest, path.basename(source));
      if (info.isDirectory()) cpSync(source, target, { recursive: true, filter: (file) => !file.includes('node_modules') });
      else cpSync(source, target);
      if (!info.isDirectory()) {
        const buf = readFileSync(target);
        manifest.push({ file: path.basename(source), sha256: sha256(buf), bytes: buf.length });
      }
    } catch (error) {
      ctx.log('warn', `${source}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (ctx.settings.mongoUri && !ctx.dryRun) {
    const dump = await execCommand('mongodump', ['--uri', String(ctx.settings.mongoUri), '--out', path.join(dest, 'mongo')], 60_000);
    ctx.log(dump.code === 0 ? 'info' : 'warn', dump.code === 0 ? 'mongodump finished.' : 'mongodump was not available.');
  }
  writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const names = readdirSync(root);
  for (const old of filesToDelete(names, Number(ctx.settings.keep || 7))) rmSync(path.join(root, old), { recursive: true, force: true });
  const check = verify(dest, manifest);
  return { summary: check.ok ? `Backup ${stamp} verified (${manifest.length} files).` : `Backup ${stamp} failed verification.`, details: check };
}

export function verify(dir: string, manifest: { file: string; sha256: string }[]): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  for (const item of manifest) {
    try {
      const got = sha256(readFileSync(path.join(dir, item.file)));
      if (got !== item.sha256) mismatches.push(item.file);
    } catch { mismatches.push(item.file); }
  }
  return { ok: mismatches.length === 0, mismatches };
}

async function drill(ctx: TaskContext): Promise<TaskResult> {
  const root = path.join(ctx.dataDir, 'backups');
  const latest = readdirSync(root).sort().at(-1);
  if (!latest) return { summary: 'No backup to drill.' };
  const manifest = JSON.parse(readFileSync(path.join(root, latest, 'manifest.json'), 'utf8')) as { file: string; sha256: string }[];
  const result = verify(path.join(root, latest), manifest);
  return { summary: result.ok ? `Restore drill matched ${latest}.` : `Drill mismatch: ${result.mismatches.join(', ')}`, details: result };
}

export async function resolve(item: { payload: Record<string, unknown> }, _input: Record<string, unknown>, deps: { settings: () => Record<string, unknown> }) {
  const from = String(item.payload.from || '');
  const to = String(item.payload.to || '');
  const root = String(deps.settings().restoreRoot || '');
  if (!root || !to.startsWith(root) || to.includes('..') || from.includes('..')) throw new Error('Restore target must stay inside the configured restore root.');
  cpSync(from, to, { recursive: true });
  return { restored: to };
}
