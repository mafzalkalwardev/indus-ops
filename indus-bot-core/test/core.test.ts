import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBotService, encryptString, decryptString, nextCron, sanitizePlan, signSso, verifySso, withLlmLock } from '../src/index';

describe('cron', () => {
  it('finds the next UTC minute and treats day-of-month and weekday as either', () => {
    const from = new Date(Date.UTC(2026, 10, 10, 12, 0, 30));
    const next = nextCron('15 * * * *', from);
    expect(next.toISOString()).toBe('2026-11-10T12:15:00.000Z');
    const friday = new Date(Date.UTC(2026, 10, 13, 9, 0, 0));
    expect(nextCron('0 9 1 * 5', new Date(friday.getTime() - 1000)).toISOString()).toBe('2026-11-13T09:00:00.000Z');
  });
});

describe('plan safety', () => {
  it('drops public actions a commander must not fire', () => {
    const result = sanitizePlan([
      { botId: 'monitor', task: 'check', reason: 'Look first.' },
      { botId: 'marketing', task: 'publish', reason: 'Post it.' },
      { botId: 'devops', task: 'deploy', reason: 'Ship it.' },
      { botId: 'seo', task: 'check', reason: 'Audit.', payload: { shell: 'rm' } },
    ], { monitor: ['check'], marketing: ['draft'], devops: ['triage'], seo: ['check'] });
    expect(result.accepted.map((action) => action.task)).toEqual(['check']);
    expect(result.rejected).toHaveLength(3);
  });
});

describe('secrets and sso', () => {
  it('round-trips encryption and expires hub passes', () => {
    const key = Buffer.alloc(32, 7);
    expect(decryptString(encryptString('imap-secret', key), key)).toBe('imap-secret');
    const token = signSso('sso', { id: 1, username: 'tony' }, 60);
    expect(verifySso(token, 'sso')?.username).toBe('tony');
    expect(verifySso(token, 'other')).toBeNull();
    const expired = signSso('sso', { id: 1, username: 'tony' }, -10);
    expect(verifySso(expired, 'sso')).toBeNull();
  });
});

describe('shared llm lock', () => {
  it('runs one completion at a time', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'indus-llm-'));
    let active = 0;
    let max = 0;
    await Promise.all([0, 1].map(async (n) => withLlmLock(dir, `holder-${n}`, 5000, async () => {
      active += 1;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active -= 1;
    })));
    expect(max).toBe(1);
  });
});

describe('bot service', () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(stops.splice(0).map((stop) => stop()));
  });

  it('serves health, refuses token-only approval, and sends only after an SSO approval', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'indus-bot-'));
    const sent: string[] = [];
    const svc = createBotService({
      id: 'demo',
      name: 'Demo',
      description: 'Test bot',
      accent: '#e0b15c',
      defaultPort: 0,
      capabilities: ['draft'],
      defaultSettings: {},
      dataDir: dir,
      env: {
        PORT: '0',
        HOST: '127.0.0.1',
        INDUS_BOT_TOKEN: 'bot-token',
        INDUS_SSO_SECRET: 'sso-secret',
        INDUS_LLM_PROVIDER: 'mock',
        INDUS_SHARED_DIR: path.join(dir, 'shared'),
      },
      runTask: async (ctx) => {
        ctx.propose({ type: 'inquiry_reply', title: 'Reply', summary: 'A sales note', body: 'Thanks', payload: { to: 'a@example.com' } });
        return { summary: 'Drafted a reply.' };
      },
      resolveApproval: async (item) => {
        sent.push(item.body);
        return { delivered: true };
      },
    });
    const server = await svc.start({ register: false });
    stops.push(() => svc.stop());
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/healthz`);
    expect((await health.json()).ok).toBe(true);

    const ran = await fetch(`${base}/api/internal/tasks`, {
      method: 'POST',
      headers: { authorization: 'Bearer bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'check', dryRun: true }),
    });
    expect((await ran.json()).summary).toMatch(/Drafted/);
    expect(sent).toEqual([]);

    const blocked = await fetch(`${base}/api/approvals/1/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer bot-token', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(blocked.status).toBe(401);
    expect(sent).toEqual([]);

    const sso = signSso('sso-secret', { id: 1, username: 'tony' }, 60);
    const approved = await fetch(`${base}/api/approvals/1/approve`, {
      method: 'POST',
      headers: { 'x-indus-sso': sso, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Thanks, we can scope this.' }),
    });
    expect(approved.status).toBe(200);
    expect(sent).toEqual(['Thanks, we can scope this.']);
  });
});
