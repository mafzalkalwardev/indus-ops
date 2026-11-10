import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import {
  bearer,
  hashPassword,
  loopbackHost,
  safeEqual,
  signSso,
  verifyPassword,
} from '@indus/bot-core';
import { hubPage } from './page';

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR || path.join(process.cwd(), 'data'));
mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'hub.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS registry (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, base_url TEXT NOT NULL,
    version TEXT, capabilities TEXT, accent TEXT, seen_at TEXT NOT NULL
  );
`);

const token = env.INDUS_BOT_TOKEN || 'dev-bot-token';
const ssoSecret = env.INDUS_SSO_SECRET || 'dev-sso-secret';
const host = loopbackHost(env.HOST);
const port = Number(env.PORT || 41731);
const attempts = new Map<string, number[]>();

function cookie(req: express.Request): string {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('indus.sid='));
  return hit ? decodeURIComponent(hit.slice('indus.sid='.length)) : '';
}

function sessionOf(req: express.Request) {
  const id = cookie(req);
  if (!id) return null;
  const row = db.prepare(`SELECT id, user_id, csrf, expires_at FROM sessions WHERE id = ?`).get(id) as
    | { id: string; user_id: number; csrf: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  const user = db.prepare(`SELECT id, username FROM users WHERE id = ?`).get(row.user_id) as { id: number; username: string } | undefined;
  return user ? { ...user, csrf: row.csrf, sid: row.id } : null;
}

function setCookie(res: express.Response, sid: string) {
  const secure = env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('set-cookie', `indus.sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
}

function allowLogin(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((stamp) => now - stamp < 15 * 60_000);
  if (recent.length >= 8) return false;
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}

function bots() {
  return db.prepare(`SELECT * FROM registry ORDER BY id`).all() as {
    id: string; name: string; description: string; base_url: string; seen_at: string; accent: string;
  }[];
}

async function fleetState() {
  const rows = bots();
  const detailed = await Promise.all(rows.map(async (bot) => {
    const online = Date.now() - new Date(bot.seen_at).getTime() < 45_000;
    try {
      const response = await fetch(new URL('/api/internal/state', bot.base_url), {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return { ...bot, online, pendingApprovals: 0, lastSummary: null };
      const state = await response.json() as { pendingApprovals?: number; lastSummary?: string | null; status?: string };
      return { id: bot.id, name: bot.name, description: bot.description, accent: bot.accent, online: true, pendingApprovals: state.pendingApprovals || 0, lastSummary: state.lastSummary, status: state.status };
    } catch {
      return { id: bot.id, name: bot.name, description: bot.description, accent: bot.accent, online, pendingApprovals: 0, lastSummary: null, status: 'offline' };
    }
  }));
  return detailed;
}

function proxy(req: express.Request, res: express.Response, target: string, user?: { id: number; username: string }) {
  const url = new URL(target);
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: url.host };
  delete headers['content-length'];
  if (user) headers['x-indus-sso'] = signSso(ssoSecret, user, 90);
  const upstream = http.request(url, { method: req.method, headers }, (upstreamRes) => {
    const type = String(upstreamRes.headers['content-type'] || '');
    if (type.includes('text/html') && user) {
      const chunks: Buffer[] = [];
      upstreamRes.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      upstreamRes.on('end', () => {
        const session = sessionOf(req);
        let html = Buffer.concat(chunks).toString('utf8');
        if (session) html = html.replace('<head>', `<head><script>window.__INDUS_CSRF__=${JSON.stringify(session.csrf)};</script>`);
        res.status(upstreamRes.statusCode || 200);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.send(html);
      });
      return;
    }
    const outHeaders = { ...upstreamRes.headers };
    if (req.originalUrl.startsWith('/public/')) outHeaders['access-control-allow-origin'] = '*';
    res.writeHead(upstreamRes.statusCode || 502, outHeaders);
    upstreamRes.pipe(res);
  });
  upstream.on('error', () => res.status(502).json({ error: 'That bot is not answering.' }));
  req.pipe(upstream);
}

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'indus-ops' }));

app.use('/public/support', (req, res) => {
  const bot = db.prepare(`SELECT base_url FROM registry WHERE id = 'support'`).get() as { base_url: string } | undefined;
  if (!bot) return res.status(503).json({ error: 'Support bot is not registered.' });
  const rest = req.originalUrl.replace(/^\/public\/support/, '') || '/';
  res.setHeader('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  proxy(req, res, new URL(rest, bot.base_url).toString());
});

app.use('/public/analytics', (req, res) => {
  const bot = db.prepare(`SELECT base_url FROM registry WHERE id = 'analytics'`).get() as { base_url: string } | undefined;
  if (!bot) return res.status(503).end();
  const rest = req.originalUrl.replace(/^\/public\/analytics/, '') || '/';
  if (req.method === 'OPTIONS') return res.status(204).end();
  proxy(req, res, new URL(rest, bot.base_url).toString());
});

app.use('/api/hooks/contact', (req, res) => {
  const bot = db.prepare(`SELECT base_url FROM registry WHERE id = 'inquiries'`).get() as { base_url: string } | undefined;
  if (!bot) return res.status(503).json({ error: 'Inquiries bot is not registered.' });
  proxy(req, res, new URL('/hooks/contact', bot.base_url).toString());
});

app.use('/bots/:name', (req, res) => {
  const user = sessionOf(req);
  if (!user) return res.status(401).type('html').send('<p>Sign in at the hub first.</p>');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const sent = req.get('x-csrf-token') || '';
    if (!sent || !safeEqual(sent, user.csrf)) return res.status(403).json({ error: 'Missing CSRF token.' });
  }
  const name = req.params.name;
  const bot = db.prepare(`SELECT base_url FROM registry WHERE id = ?`).get(name) as { base_url: string } | undefined;
  if (!bot) return res.status(404).type('html').send(`<p>${name} has not registered yet.</p>`);
  const rest = req.originalUrl.replace(new RegExp(`^/bots/${name}`), '') || '/';
  if (rest === '') return res.redirect(`/bots/${name}/`);
  proxy(req, res, new URL(rest, bot.base_url).toString(), user);
});

app.use(express.json({ limit: '256kb' }));

app.post('/api/internal/register', (req, res) => {
  if (!safeEqual(bearer(req.get('authorization')), token)) return res.status(401).json({ error: 'Missing bot token.' });
  const body = req.body || {};
  db.prepare(`INSERT INTO registry (id, name, description, base_url, version, capabilities, accent, seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, base_url=excluded.base_url,
      version=excluded.version, capabilities=excluded.capabilities, accent=excluded.accent, seen_at=excluded.seen_at`)
    .run(body.id, body.name, body.description, body.baseUrl, body.version || '', JSON.stringify(body.capabilities || []), body.accent || '', new Date().toISOString());
  res.json({ ok: true });
});

app.get('/api/internal/fleet', (req, res) => {
  if (!safeEqual(bearer(req.get('authorization')), token)) return res.status(401).json({ error: 'Missing bot token.' });
  res.json({ bots: bots() });
});

app.get('/api/session', (req, res) => {
  const user = sessionOf(req);
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  res.json({
    setupRequired: count === 0,
    setupTokenRequired: Boolean(env.INDUS_SETUP_TOKEN),
    user: user ? { username: user.username } : null,
    csrf: user?.csrf || '',
  });
});

app.post('/api/setup', async (req, res) => {
  if ((db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n > 0) return res.status(409).json({ error: 'The owner already exists.' });
  if (!allowLogin(req.ip || 'local')) return res.status(429).json({ error: 'Too many attempts. Wait and try again.' });
  if (env.INDUS_SETUP_TOKEN && !safeEqual(String(req.body?.token || ''), env.INDUS_SETUP_TOKEN)) return res.status(403).json({ error: 'Setup token does not match.' });
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username) || password.length < 10) return res.status(400).json({ error: 'Use a username of 3–32 letters and a password of at least 10 characters.' });
  const id = Number(db.prepare(`INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`).run(username, await hashPassword(password), new Date().toISOString()).lastInsertRowid);
  const sid = randomBytes(24).toString('hex');
  const csrf = randomBytes(18).toString('hex');
  db.prepare(`INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)`).run(sid, id, csrf, Date.now() + 7 * 864e5);
  setCookie(res, sid);
  res.json({ ok: true, csrf, username });
});

app.post('/api/login', async (req, res) => {
  if (!allowLogin(req.ip || 'local')) return res.status(429).json({ error: 'Too many attempts. Wait and try again.' });
  const user = db.prepare(`SELECT id, username, password_hash FROM users WHERE username = ?`).get(String(req.body?.username || '')) as
    | { id: number; username: string; password_hash: string }
    | undefined;
  const ok = user ? await verifyPassword(user.password_hash, String(req.body?.password || '')) : false;
  if (!user || !ok) return res.status(401).json({ error: 'Those credentials do not match.' });
  const sid = randomBytes(24).toString('hex');
  const csrf = randomBytes(18).toString('hex');
  db.prepare(`INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)`).run(sid, user.id, csrf, Date.now() + 7 * 864e5);
  setCookie(res, sid);
  res.json({ ok: true, csrf, username: user.username });
});

app.post('/api/logout', (req, res) => {
  const user = sessionOf(req);
  if (user) db.prepare(`DELETE FROM sessions WHERE id = ?`).run(user.sid);
  res.json({ ok: true });
});

function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = sessionOf(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });
  if (!['GET', 'HEAD'].includes(req.method) && !safeEqual(req.get('x-csrf-token') || '', user.csrf)) return res.status(403).json({ error: 'Missing CSRF token.' });
  (req as express.Request & { user: typeof user }).user = user;
  next();
}

app.get('/api/overview', requireUser, async (_req, res) => {
  const list = await fleetState();
  let paused = false;
  const scheduler = db.prepare(`SELECT base_url FROM registry WHERE id = 'scheduler'`).get() as { base_url: string } | undefined;
  if (scheduler) {
    try {
      const response = await fetch(new URL('/api/internal/state', scheduler.base_url), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
      if (response.ok) paused = Boolean((await response.json() as { paused?: boolean }).paused);
    } catch { /* scheduler can be down */ }
  }
  res.json({ bots: list, pending: list.reduce((sum, bot) => sum + (bot.pendingApprovals || 0), 0), paused });
});

app.get('/api/inbox', requireUser, async (_req, res) => {
  const approvals = [];
  for (const bot of bots()) {
    try {
      const response = await fetch(new URL('/api/internal/approvals', bot.base_url), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2500) });
      if (!response.ok) continue;
      const rows = await response.json() as { status: string }[];
      approvals.push(...rows.filter((row) => row.status === 'pending'));
    } catch { /* skip */ }
  }
  res.json({ approvals });
});

app.post('/api/inbox/:botId/:id/:action', requireUser, async (req, res) => {
  const bot = db.prepare(`SELECT base_url FROM registry WHERE id = ?`).get(req.params.botId) as { base_url: string } | undefined;
  if (!bot) return res.status(404).json({ error: 'Bot is not registered.' });
  const user = (req as express.Request & { user: { id: number; username: string } }).user;
  const response = await fetch(new URL(`/api/approvals/${req.params.id}/${req.params.action}`, bot.base_url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-indus-sso': signSso(ssoSecret, user, 60) },
    body: JSON.stringify(req.body || {}),
  });
  const body = await response.json().catch(() => ({}));
  res.status(response.status).json(body);
});

app.post('/api/instruct', requireUser, async (req, res) => {
  const scheduler = db.prepare(`SELECT base_url FROM registry WHERE id = 'scheduler'`).get() as { base_url: string } | undefined;
  if (!scheduler) return res.status(503).json({ error: 'Scheduler is not registered yet.' });
  const response = await fetch(new URL('/api/internal/jobs', scheduler.base_url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      botId: req.body?.botId,
      task: 'instruct',
      group: 'llm',
      payload: { message: String(req.body?.message || '').slice(0, 4000) },
    }),
  });
  const body = await response.json().catch(() => ({}));
  res.status(response.status).json(body);
});

app.get('/', (_req, res) => res.type('html').send(hubPage()));

app.listen(port, host, () => {
  console.log(`INDUS Ops hub on http://${host}:${port}`);
});
