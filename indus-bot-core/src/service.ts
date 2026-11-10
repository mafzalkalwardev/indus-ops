import { mkdirSync } from 'node:fs';
import path from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import Database from 'better-sqlite3';
import { decryptString, encryptString, loadKey, safeEqual, verifySso, type SsoUser } from './crypto';
import { llmConfig, loopbackHost, smtpConfig, type LlmConfig, type SmtpConfig } from './env';
import { bearer } from './http';
import { completeLlm, llmHealth, withLlmLock } from './llm';
import type { FieldSpec } from './protocol';
import { renderBotPage } from './ui';

export type { FieldSpec };

export type DesiredJob = {
  key: string;
  task: string;
  cron?: string;
  everyMs?: number;
  group: 'default' | 'llm' | 'video';
};

export type Proposal = {
  type: string;
  title: string;
  summary: string;
  body: string;
  payload?: Record<string, unknown>;
};

export type Sql = Database.Database;

export type TaskContext = {
  task: string;
  payload: Record<string, unknown>;
  dryRun: boolean;
  settings: Record<string, unknown>;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  llm: (system: string, user: string) => Promise<{ text: string; model: string; durationMs: number }>;
  propose: (draft: Proposal) => number;
  fetch: typeof fetch;
  now: Date;
  db: Sql;
  dataDir: string;
};

export type TaskResult = { summary: string; details?: unknown };

export type ApprovalItem = {
  id: number;
  type: string;
  title: string;
  summary: string;
  body: string;
  payload: Record<string, unknown>;
  status: string;
};

export type BotDeps = {
  db: Sql;
  dataDir: string;
  env: NodeJS.ProcessEnv;
  settings: () => Record<string, unknown>;
  fetchImpl: typeof fetch;
  smtp: () => SmtpConfig;
  llm: () => LlmConfig;
};

type BotOptions = {
  id: string;
  name: string;
  description: string;
  accent: string;
  defaultPort: number;
  capabilities: string[];
  defaultSettings: Record<string, unknown>;
  secretFields?: string[];
  fields?: FieldSpec[];
  desired?: DesiredJob[];
  version?: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  fetchImpl?: typeof fetch;
  autoTask?: string;
  runTask: (ctx: TaskContext) => Promise<TaskResult>;
  resolveApproval?: (item: ApprovalItem, input: Record<string, unknown>, deps: BotDeps) => Promise<Record<string, unknown> | void>;
  collect?: (deps: BotDeps) => unknown;
  publicRoutes?: (app: Express, deps: BotDeps) => void;
  routes?: (app: Express, deps: BotDeps) => void;
  page?: (deps: BotDeps) => string;
  extraHtml?: string;
};

type JobRow = {
  id: number;
  task: string;
  status: string;
  dry_run: number;
  payload_json: string;
  summary: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export function createBotService(opts: BotOptions) {
  const env = opts.env || process.env;
  const dataDir = opts.dataDir || path.resolve(env.DATA_DIR || path.join(process.cwd(), 'data'));
  mkdirSync(dataDir, { recursive: true });
  const sharedDir = path.resolve(env.INDUS_SHARED_DIR || path.join(dataDir, 'shared'));
  mkdirSync(sharedDir, { recursive: true });
  const db = new Database(path.join(dataDir, `${opts.id}.sqlite`));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      summary TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY,
      job_id INTEGER,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT,
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
  `);

  const key = loadKey(env.INDUS_ENCRYPTION_KEY || env.SETTINGS_ENCRYPTION_KEY, sharedDir);
  const secretFields = opts.secretFields || [];
  const token = env.INDUS_BOT_TOKEN || 'dev-bot-token';
  const ssoSecret = env.INDUS_SSO_SECRET || 'dev-sso-secret';
  const host = loopbackHost(env.HOST);
  const port = Number(env.PORT || opts.defaultPort);
  const fetchImpl = opts.fetchImpl || fetch;
  const llm = () => llmConfig(env);
  const smtp = () => smtpConfig(env);
  let health = { ok: null as boolean | null, detail: null as string | null };
  let pumping = false;
  const waiters = new Map<number, { resolve: (value: TaskResult) => void; reject: (error: Error) => void }>();

  function readSettings(): Record<string, unknown> {
    const row = db.prepare(`SELECT value_json FROM kv WHERE key = 'settings'`).get() as { value_json: string } | undefined;
    const saved = row ? JSON.parse(row.value_json) as Record<string, unknown> : {};
    const merged = { ...opts.defaultSettings, ...saved };
    for (const field of secretFields) {
      const value = merged[field];
      if (typeof value === 'string' && value.startsWith('enc:v1:')) {
        try { merged[field] = decryptString(value, key); } catch { merged[field] = ''; }
      }
    }
    return merged;
  }

  function writeSettings(next: Record<string, unknown>): void {
    const prev = readSettings();
    const stored: Record<string, unknown> = { ...prev, ...next };
    for (const field of secretFields) {
      const value = stored[field];
      if (typeof value !== 'string' || value.trim() === '') stored[field] = prev[field] || '';
      if (typeof stored[field] === 'string' && stored[field]) stored[field] = encryptString(String(stored[field]), key);
    }
    db.prepare(`INSERT INTO kv (key, value_json) VALUES ('settings', ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`).run(JSON.stringify(stored));
  }

  function maskedSettings() {
    const settings = readSettings();
    const secretsSet: Record<string, boolean> = {};
    const copy = { ...settings };
    for (const field of secretFields) {
      secretsSet[field] = Boolean(copy[field]);
      copy[field] = '';
    }
    return { settings: copy, secretsSet };
  }

  const deps: BotDeps = { db, dataDir, env, settings: readSettings, fetchImpl, smtp, llm };

  function log(jobId: number | null, level: 'info' | 'warn' | 'error', message: string) {
    db.prepare('INSERT INTO logs (job_id, level, message, created_at) VALUES (?, ?, ?, ?)').run(jobId, level, message.slice(0, 2000), new Date().toISOString());
  }

  function propose(draft: Proposal): number {
    return Number(db.prepare(`INSERT INTO approvals (type, title, summary, body, payload_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`).run(
      draft.type,
      draft.title,
      draft.summary,
      draft.body,
      JSON.stringify(draft.payload || {}),
      new Date().toISOString(),
    ).lastInsertRowid);
  }

  function enqueue(task: string, payload: Record<string, unknown>, dryRun: boolean): number {
    const id = Number(db.prepare(`INSERT INTO jobs (task, status, dry_run, payload_json, created_at) VALUES (?, 'queued', ?, ?, ?)`)
      .run(task, dryRun ? 1 : 0, JSON.stringify(payload), new Date().toISOString()).lastInsertRowid);
    void pump();
    return id;
  }

  function enqueueAndWait(task: string, payload: Record<string, unknown>, dryRun: boolean): Promise<TaskResult> {
    const id = enqueue(task, payload, dryRun);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(new Error('The task took too long.'));
      }, llm().timeoutMs + 30_000);
      waiters.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const job = db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1`).get() as JobRow | undefined;
        if (!job) break;
        const claimed = db.prepare(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`).run(new Date().toISOString(), job.id);
        if (claimed.changes !== 1) continue;
        await execute(job);
      }
    } finally {
      pumping = false;
    }
  }

  async function execute(job: JobRow): Promise<void> {
    const payload = JSON.parse(job.payload_json || '{}') as Record<string, unknown>;
    const task = job.task === 'auto' ? (opts.autoTask || 'check') : job.task;
    const ctx: TaskContext = {
      task,
      payload,
      dryRun: job.dry_run === 1,
      settings: readSettings(),
      log: (level, message) => log(job.id, level, message),
      llm: async (system, user) => withLlmLock(sharedDir, `${opts.id}:${process.pid}`, llm().timeoutMs, () => completeLlm(llm(), [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ])),
      propose,
      fetch: fetchImpl,
      now: new Date(),
      db,
      dataDir,
    };
    try {
      log(job.id, 'info', `Started ${task}${job.dry_run ? ' (dry run)' : ''}.`);
      const result = await opts.runTask(ctx);
      db.prepare(`UPDATE jobs SET status = 'done', summary = ?, result_json = ?, finished_at = ? WHERE id = ?`)
        .run(result.summary, JSON.stringify(result.details || {}), new Date().toISOString(), job.id);
      log(job.id, 'info', result.summary);
      waiters.get(job.id)?.resolve(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare(`UPDATE jobs SET status = 'error', error = ?, finished_at = ? WHERE id = ?`).run(message, new Date().toISOString(), job.id);
      log(job.id, 'error', message);
      waiters.get(job.id)?.reject(error instanceof Error ? error : new Error(message));
    } finally {
      waiters.delete(job.id);
      db.prepare(`DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 800)`).run();
      db.prepare(`DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY id DESC LIMIT 150)`).run();
    }
  }

  function state() {
    const jobs = db.prepare(`SELECT id, task, status, dry_run AS dryRun, summary, error, created_at AS createdAt, finished_at AS finishedAt
      FROM jobs ORDER BY id DESC LIMIT 12`).all();
    const logs = db.prepare(`SELECT level, message, created_at AS createdAt FROM logs ORDER BY id DESC LIMIT 40`).all().reverse();
    const approvals = db.prepare(`SELECT id, type, title, summary, body, payload_json, status, created_at AS createdAt
      FROM approvals WHERE status = 'pending' ORDER BY id DESC LIMIT 20`).all() as { payload_json: string }[];
    const queued = db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'`).get() as { n: number };
    const running = db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'`).get() as { n: number };
    const pending = db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`).get() as { n: number };
    const last = db.prepare(`SELECT summary, error, finished_at, status FROM jobs WHERE status IN ('done','error') ORDER BY id DESC LIMIT 1`).get() as
      | { summary: string | null; error: string | null; finished_at: string | null; status: string }
      | undefined;
    return {
      id: opts.id,
      name: opts.name,
      description: opts.description,
      status: running.n ? 'running' : last?.status === 'error' ? 'error' : 'idle',
      lastRunAt: last?.finished_at || null,
      lastSummary: last?.summary || null,
      lastError: last?.error || null,
      pendingApprovals: pending.n,
      queue: { queued: queued.n, running: running.n > 0 },
      jobs,
      logs,
      approvals: approvals.map((row) => ({ ...row, payload: JSON.parse(row.payload_json || '{}') })),
      llm: { ...llm(), reachable: health.ok, detail: health.detail },
      extras: opts.collect?.(deps) ?? null,
    };
  }

  async function resolve(id: number, action: 'approve' | 'reject' | 'edit', input: Record<string, unknown>) {
    const row = db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(id) as {
      id: number; type: string; title: string; summary: string; body: string; payload_json: string; status: string;
    } | undefined;
    if (!row || row.status !== 'pending') throw httpError(404, 'That approval is no longer pending.');
    if (action === 'edit') {
      db.prepare(`UPDATE approvals SET body = ? WHERE id = ?`).run(String(input.body ?? row.body), id);
      return { ok: true, status: 'pending' };
    }
    if (action === 'reject') {
      db.prepare(`UPDATE approvals SET status = 'rejected', resolution_note = ?, resolved_at = ? WHERE id = ?`)
        .run(String(input.note || ''), new Date().toISOString(), id);
      return { ok: true, status: 'rejected' };
    }
    const item: ApprovalItem = {
      id: row.id,
      type: row.type,
      title: row.title,
      summary: row.summary,
      body: String(input.body ?? row.body),
      payload: JSON.parse(row.payload_json || '{}') as Record<string, unknown>,
      status: row.status,
    };
    db.prepare(`UPDATE approvals SET body = ? WHERE id = ?`).run(item.body, id);
    const result = (await opts.resolveApproval?.(item, input, deps)) || { ok: true };
    db.prepare(`UPDATE approvals SET status = 'approved', result_json = ?, resolution_note = ?, resolved_at = ? WHERE id = ?`)
      .run(JSON.stringify(result), String(input.note || ''), new Date().toISOString(), id);
    return { ok: true, status: 'approved', result };
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));
  app.get('/healthz', (_req, res) => {
    const queued = db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'`).get() as { n: number };
    res.json({ ok: true, service: opts.id, version: opts.version || '1.0.0', queue: queued.n });
  });
  opts.publicRoutes?.(app, deps);

  const internal = express.Router();
  internal.use((req, res, next) => {
    if (!safeEqual(bearer(req.get('authorization')), token)) {
      res.status(401).json({ error: 'Missing bot token.' });
      return;
    }
    next();
  });
  internal.get('/state', (_req, res) => res.json(state()));
  internal.get('/approvals', (_req, res) => {
    const rows = db.prepare(`SELECT id, type, title, summary, body, payload_json, status, created_at AS createdAt FROM approvals ORDER BY id DESC LIMIT 50`).all() as { payload_json: string }[];
    res.json(rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json || '{}'), botId: opts.id })));
  });
  internal.post('/tasks', async (req, res) => {
    try {
      const result = await enqueueAndWait(String(req.body?.task || opts.autoTask || 'check'), req.body?.payload || {}, Boolean(req.body?.dryRun));
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  internal.post('/ingest', (req, res) => {
    const id = propose({
      type: String(req.body?.type || 'note'),
      title: String(req.body?.title || 'Handed off'),
      summary: String(req.body?.summary || ''),
      body: String(req.body?.body || ''),
      payload: { ...(req.body?.payload || {}), from: req.body?.from || 'bot' },
    });
    res.status(201).json({ ok: true, id });
  });
  app.use('/api/internal', internal);

  app.use((req, res, next) => {
    const user = verifySso(req.get('x-indus-sso') || '', ssoSecret);
    if (!user) {
      res.status(401).json({ error: 'Open this bot through the hub.' });
      return;
    }
    (req as Request & { indusUser?: SsoUser }).indusUser = user;
    next();
  });

  app.get('/', (_req, res) => {
    const mask = maskedSettings();
    res.type('html').send(opts.page?.(deps) || renderBotPage({
      id: opts.id,
      name: opts.name,
      description: opts.description,
      accent: opts.accent,
      fields: opts.fields || [],
      settings: mask.settings,
      secretsSet: mask.secretsSet,
      extraHtml: opts.extraHtml,
    }));
  });
  app.get('/api/status', (_req, res) => res.json(state()));
  app.get('/api/jobs', (_req, res) => res.json(state().jobs));
  app.get('/api/logs', (_req, res) => res.json(state().logs));
  app.get('/api/approvals', (_req, res) => res.json(state().approvals));
  app.post('/api/jobs/run', (req, res) => {
    const id = enqueue(String(req.body?.task || 'auto'), req.body?.payload || {}, req.body?.dryRun !== false);
    res.status(202).json({ ok: true, id });
  });
  app.put('/api/settings', (req, res) => {
    writeSettings(req.body || {});
    res.json({ ok: true, ...maskedSettings() });
  });
  app.post('/api/approvals/:id/:action', async (req, res) => {
    const action = req.params.action;
    if (action !== 'approve' && action !== 'reject' && action !== 'edit') {
      res.status(404).json({ error: 'Unknown action.' });
      return;
    }
    try {
      res.json(await resolve(Number(req.params.id), action, req.body || {}));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  opts.routes?.(app, deps);

  let server: ReturnType<Express['listen']> | null = null;
  let timer: NodeJS.Timeout | null = null;

  async function announce() {
    const base = `http://127.0.0.1:${port}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    if (env.HUB_URL) {
      await fetch(new URL('/api/internal/register', env.HUB_URL), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: opts.id,
          name: opts.name,
          description: opts.description,
          baseUrl: base,
          version: opts.version || '1.0.0',
          capabilities: opts.capabilities,
          accent: opts.accent,
        }),
        signal: AbortSignal.timeout(4000),
      }).catch(() => undefined);
    }
    if (env.SCHEDULER_URL && opts.desired?.length) {
      await fetch(new URL('/api/internal/desired', env.SCHEDULER_URL), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ botId: opts.id, baseUrl: base, jobs: opts.desired }),
        signal: AbortSignal.timeout(4000),
      }).catch(() => undefined);
    }
  }

  return {
    app,
    db,
    deps,
    id: opts.id,
    port,
    enqueue,
    propose,
    readSettings,
    async start(options?: { register?: boolean }) {
      health = await llmHealth(llm());
      server = app.listen(port, host);
      await new Promise<void>((resolve) => server?.once('listening', () => resolve()));
      if (options?.register !== false) {
        void announce();
        timer = setInterval(() => void announce(), 20_000);
        timer.unref?.();
      }
      const probe = setInterval(() => void llmHealth(llm()).then((next) => { health = next; }), 120_000);
      probe.unref?.();
      return server;
    },
    async stop() {
      if (timer) clearInterval(timer);
      if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
      db.close();
    },
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function httpError(status: number, message: string): Error {
  return new HttpError(status, message);
}

export function hubUser(req: Request): SsoUser | undefined {
  return (req as Request & { indusUser?: SsoUser }).indusUser;
}

export function sendJson(res: Response, body: unknown, status = 200): void {
  res.status(status).json(body);
}
