import { extractJson, fetchText, type TaskContext, type TaskResult } from '@indus/bot-core';

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'yopmail.com', 'tempmail.com']);

export function cleanEmails(values: string[]): { kept: string[]; removed: number } {
  const seen = new Set<string>();
  const kept: string[] = [];
  let removed = 0;
  for (const raw of values) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL.test(email) || seen.has(email) || DISPOSABLE.has(email.split('@')[1] || '')) {
      removed += 1;
      continue;
    }
    seen.add(email);
    kept.push(email);
  }
  return { kept, removed };
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You are the INDUS MailForge bot. Do not claim a campaign was scheduled.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 300) };
  }
  const base = String(ctx.settings.baseUrl || 'http://127.0.0.1:5000');
  const email = String(ctx.settings.email || '');
  const password = String(ctx.settings.password || '');
  let snapshot = 'MailForge API was not called.';
  let bulkJobId = '';
  if (email && password) {
    const login = await fetchText(new URL('/api/auth/login', base).toString(), ctx.fetch, 8000, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    const token = login.ok ? (JSON.parse(login.text) as { token?: string }).token : '';
    if (token) {
      const overview = await fetchText(new URL('/api/dashboard/overview', base).toString(), ctx.fetch, 8000, { headers: { authorization: `Bearer ${token}` } });
      snapshot = overview.ok ? 'Pulled the MailForge overview.' : `Overview failed (${overview.status}).`;
      const jobs = await fetchText(new URL('/api/history/bulk-jobs', base).toString(), ctx.fetch, 8000, { headers: { authorization: `Bearer ${token}` } });
      if (jobs.ok) {
        const parsed = JSON.parse(jobs.text) as { _id?: string }[] | { jobs?: { _id?: string }[] };
        const list = Array.isArray(parsed) ? parsed : parsed.jobs || [];
        bulkJobId = String(list[0]?._id || '');
      }
    } else snapshot = 'MailForge login failed. Checked nothing remote.';
  }
  const sample = cleanEmails(['A@Example.com', 'a@example.com', 'nope', 'spam@mailinator.com']);
  const copy = await ctx.llm('Write campaign JSON with subject and body. Use {Name} and {SENDER_NAME}. This is a campaign draft.', 'Draft a short MailForge campaign for INDUS.');
  let subject = 'A note for {Name}';
  let body = 'Hi {Name},\n\nWe build sites and the automation behind them.\n\n{SENDER_NAME}';
  try {
    const parsed = extractJson(copy.text) as { subject?: string; body?: string };
    subject = parsed.subject || subject;
    body = parsed.body || body;
  } catch { /* keep fallback */ }
  ctx.propose({
    type: 'mailforge_campaign',
    title: 'Campaign draft',
    summary: `${snapshot} Local clean kept ${sample.kept.length}, removed ${sample.removed}.`,
    body: `Subject: ${subject}\n\n${body}`,
    payload: { bulkJobId, subject, baseUrl: base },
  });
  return { summary: snapshot, details: { sample } };
}

export async function resolve(item: { body: string; payload: Record<string, unknown> }, input: Record<string, unknown>, deps: { settings: () => Record<string, unknown>; fetchImpl: typeof fetch }) {
  const when = String(input.scheduledAt || '');
  if (!when || new Date(when).getTime() <= Date.now()) {
    return { exported: true, note: 'No future time was set, so the copy was saved and the campaign was not scheduled.' };
  }
  const bulkJobId = String(item.payload.bulkJobId || '');
  if (!bulkJobId) return { exported: true, note: 'No MailForge list was attached, so the copy was saved and nothing was scheduled.' };
  const settings = deps.settings();
  const base = String(item.payload.baseUrl || settings.baseUrl || 'http://127.0.0.1:5000');
  const login = await fetchText(new URL('/api/auth/login', base).toString(), deps.fetchImpl, 8000, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: settings.email, password: settings.password }),
  });
  if (!login.ok) throw new Error('MailForge login failed. The draft is still pending if you retry.');
  const token = (JSON.parse(login.text) as { token?: string }).token;
  const created = await fetchText(new URL('/api/campaigns/from-bulk-job', base).toString(), deps.fetchImpl, 8000, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      bulkJobId,
      name: `INDUS ${new Date().toISOString().slice(0, 10)}`,
      subjectTemplates: [String(item.payload.subject || 'A note for {Name}')],
      bodyTemplates: [item.body],
      validOnly: true,
      dedupe: true,
      scheduledAt: when,
      companyName: 'INDUS Web Agency',
    }),
  });
  if (!created.ok) throw new Error(`MailForge did not accept the campaign (${created.status}).`);
  return { scheduled: true, at: when };
}
