import { execCommand, fetchText, readFileSyncMaybe, type TaskContext, type TaskResult } from './runtime';
import tls from 'node:tls';

const UNIT = /^[a-zA-Z0-9][a-zA-Z0-9:@._-]{0,80}$/;

export function planRestart(unit: string, state: string, allowlist: string[], auto: boolean): 'restart' | 'propose' | 'ignore' {
  if (!UNIT.test(unit) || state !== 'failed') return 'ignore';
  return auto && allowlist.includes(unit) ? 'restart' : 'propose';
}

export function parseMeminfo(text: string): number | null {
  const total = /MemTotal:\s+(\d+)/.exec(text);
  const available = /MemAvailable:\s+(\d+)/.exec(text);
  if (!total || !available) return null;
  return ((Number(total[1]) - Number(available[1])) / Number(total[1])) * 100;
}

export function parseDf(text: string): number | null {
  const cap = text.split('\n')[1]?.trim().split(/\s+/).find((part) => part.endsWith('%'));
  return cap ? Number(cap.replace('%', '')) : null;
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task === 'instruct') return reply(ctx, 'monitor');
  const sites = asList(ctx.settings.sites);
  const checks = [];
  for (const site of sites) {
    const result = await fetchText(site, ctx.fetch, 8000);
    const host = safeHost(site);
    const tlsExpiry = host ? await certExpiry(host) : null;
    checks.push({ site, ok: result.ok, status: result.status, ms: result.ms, error: result.error, tlsExpiry });
    ctx.db.prepare(`CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY, target TEXT, ok INTEGER, status INTEGER, latency INTEGER, tls TEXT, checked_at TEXT)`).run();
    ctx.db.prepare(`INSERT INTO checks (target, ok, status, latency, tls, checked_at) VALUES (?, ?, ?, ?, ?, ?)`).run(site, result.ok ? 1 : 0, result.status, result.ms, tlsExpiry, ctx.now.toISOString());
    if (!result.ok) ctx.propose({ type: 'note', title: `${host} is down`, summary: result.error || `HTTP ${result.status}`, body: `${site} failed a check.`, payload: { site } });
  }
  const mem = parseMeminfo(readFileSyncMaybe('/proc/meminfo'));
  const df = await execCommand('df', ['-Pk', '/']);
  const disk = parseDf(df.stdout);
  const failed = await execCommand('systemctl', ['--failed', '--no-legend', '--plain']);
  const units = failed.stdout.split('\n').map((line) => line.trim().split(/\s+/)[0]?.replace(/\.service$/, '') || '').filter((unit) => UNIT.test(unit));
  const allow = asList(ctx.settings.restartAllowlist);
  const auto = Boolean(ctx.settings.autoRestart) && !ctx.dryRun;
  for (const unit of units) {
    const action = planRestart(unit, 'failed', allow, auto);
    if (action === 'restart') await execCommand('sudo', ['-n', 'systemctl', 'restart', unit]);
    if (action === 'propose') ctx.propose({ type: 'systemd_restart', title: `Restart ${unit}?`, summary: `${unit} is failed.`, body: `Restart ${unit} once.`, payload: { unit } });
  }
  const down = checks.filter((check) => !check.ok).length;
  return { summary: `${checks.length - down}/${checks.length} sites up. Disk ${disk ?? 'unknown'}%.`, details: { checks, mem, disk, units } };
}

export async function resolve(item: { payload: Record<string, unknown> }, _input: Record<string, unknown>, deps: { settings: () => Record<string, unknown> }) {
  const unit = String(item.payload.unit || '');
  if (!UNIT.test(unit)) throw new Error('That unit name is not safe to restart.');
  await execCommand('sudo', ['-n', 'systemctl', 'restart', unit]);
  return { restarted: unit };
}

function safeHost(site: string): string {
  try { return new URL(site).hostname; } catch { return ''; }
}

function certExpiry(host: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const when = cert?.valid_to ? new Date(cert.valid_to) : null;
      resolvePromise(when && !Number.isNaN(when.getTime()) ? when.toISOString() : null);
    });
    socket.on('error', () => resolvePromise(null));
    socket.on('timeout', () => { socket.destroy(); resolvePromise(null); });
  });
}

async function reply(ctx: TaskContext, who: string): Promise<TaskResult> {
  const result = await ctx.llm(`You are the INDUS ${who} bot. Do not claim you sent mail, posted, or restarted anything.`, String(ctx.payload.message || 'Status?'));
  return { summary: prose(result.text) };
}

export function prose(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return String(parsed.answer || parsed.summary || parsed.reply || raw).slice(0, 400);
  } catch {
    return raw.slice(0, 400);
  }
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split('\n').map((item) => item.trim()).filter(Boolean);
  return [];
}

export { asList };
