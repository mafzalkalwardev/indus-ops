import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { LlmConfig } from './env';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmResult = { text: string; model: string; durationMs: number };

const locks = new Map<string, Database.Database>();

function lockDb(dir: string): Database.Database {
  const existing = locks.get(dir);
  if (existing) return existing;
  mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'llm.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 8000');
  db.exec(`CREATE TABLE IF NOT EXISTS llm_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    holder TEXT NOT NULL,
    started INTEGER NOT NULL
  )`);
  locks.set(dir, db);
  return db;
}

export async function withLlmLock<T>(dir: string, holder: string, staleMs: number, fn: () => Promise<T>): Promise<T> {
  const db = lockDb(dir);
  const deadline = Date.now() + staleMs;
  while (Date.now() < deadline) {
    if (acquire(db, holder, staleMs)) {
      try { return await fn(); }
      finally { release(db, holder); }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('The shared LLM queue is busy.');
}

function acquire(db: Database.Database, holder: string, staleMs: number): boolean {
  try {
    db.prepare('BEGIN IMMEDIATE').run();
    const row = db.prepare('SELECT holder, started FROM llm_lock WHERE id = 1').get() as { holder: string; started: number } | undefined;
    const now = Date.now();
    if (row && row.holder !== holder && now - row.started < staleMs) {
      db.prepare('ROLLBACK').run();
      return false;
    }
    db.prepare(`INSERT INTO llm_lock (id, holder, started) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, started = excluded.started`).run(holder, now);
    db.prepare('COMMIT').run();
    return true;
  } catch {
    try { db.prepare('ROLLBACK').run(); } catch { /* already closed */ }
    return false;
  }
}

function release(db: Database.Database, holder: string): void {
  db.prepare('DELETE FROM llm_lock WHERE id = 1 AND holder = ?').run(holder);
}

export async function completeLlm(config: LlmConfig, messages: LlmMessage[]): Promise<LlmResult> {
  const started = Date.now();
  const text = config.provider === 'mock'
    ? mockText(messages)
    : config.provider === 'openai-compatible'
      ? await openAiText(config, messages)
      : await ollamaText(config, messages);
  return { text, model: config.provider === 'mock' ? 'mock' : config.model, durationMs: Date.now() - started };
}

export async function llmHealth(config: LlmConfig): Promise<{ ok: boolean; detail?: string }> {
  if (config.provider === 'mock') return { ok: true, detail: 'Mock model. No tokens, no network.' };
  if (config.provider === 'openai-compatible') return { ok: true, detail: 'Checked on the next completion.' };
  try {
    const response = await fetch(new URL('/api/tags', config.baseUrl), { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return { ok: false, detail: `Ollama returned ${response.status}.` };
    const data = await response.json() as { models?: { name: string }[] };
    const names = (data.models || []).map((model) => model.name);
    const present = names.some((name) => name === config.model || name.startsWith(`${config.model}:`));
    return present
      ? { ok: true }
      : { ok: false, detail: `Pull it with: ollama pull ${config.model}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Ollama is not reachable.' };
  }
}

function mockText(messages: LlmMessage[]): string {
  const blob = messages.map((message) => message.content).join('\n').toLowerCase();
  if (blob.includes('campaign')) {
    return JSON.stringify({
      subject: 'A note for {Name}',
      body: 'Hi {Name},\n\nWe build sites and the automation behind them.\n\n{SENDER_NAME}\nINDUS Web Agency',
    });
  }
  if (blob.includes('daily plan')) {
    return JSON.stringify({
      reasoning: 'Check the machines first. Drafts can wait for a person.',
      actions: [
        { botId: 'monitor', task: 'check', reason: 'Uptime before any writing.' },
        { botId: 'marketing', task: 'publish', reason: 'This must be dropped.' },
      ],
    });
  }
  return JSON.stringify({
    classification: 'sales',
    summary: 'Someone wants INDUS to build or explain a product.',
    replySubject: 'Re: your note to INDUS',
    reply: 'Thanks for writing to INDUS. A person will reply with the next step. Nothing here is sent automatically.',
    title: 'What the page should say before the demo',
    slug: 'before-the-demo',
    description: 'A short brief for a product page that already has a job to do.',
    body: 'Lead with the job the product does. Show one proof. Link back to the product.',
    post: 'The useful part of this product is the job it repeats.\n\n{{link}}',
    hashtags: ['#INDUS'],
    slides: ['The job', 'The proof', 'Try it'],
    subject: 'A note for {Name}',
    proposal: 'INDUS can scope the first release within a day of a clear brief.',
    x: 'Short version: it stays on your server.',
    facebook: 'We wrote down what the product actually does.',
    reddit: 'Notes from running this ourselves. Happy to hear what is missing.',
    tagline: 'Software that stays on your machine.',
    script: 'This product runs on your own server. You keep the data. Open the page, watch the first workflow, and decide if it belongs on your machine.',
    keywords: ['self hosted software', 'web agency', 'automation'],
    topics: ['What to publish first', 'What waits for approval'],
    reasoning: 'Check uptime, then draft only what a person can approve.',
    translation: 'Este es un borrador para revision. No se publica solo.',
    quote: 'The first release covers the public site and the form behind it.',
    answer: 'It runs on your server. Leave an email if you want a person at INDUS to reply.',
    escalate: false,
    changes: 'The public page changed enough to reread the pricing block.',
    actions: [],
  });
}

async function ollamaText(config: LlmConfig, messages: LlmMessage[]): Promise<string> {
  const response = await fetch(new URL('/api/chat', config.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      options: { temperature: 0.4, num_predict: 700 },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
  const data = await response.json() as { message?: { content?: string } };
  const text = data.message?.content?.trim();
  if (!text) throw new Error('Ollama returned an empty reply.');
  return text;
}

async function openAiText(config: LlmConfig, messages: LlmMessage[]): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: config.model, messages, temperature: 0.4, max_tokens: 700 }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`The LLM endpoint returned ${response.status}.`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('The LLM endpoint returned an empty reply.');
  return text;
}
