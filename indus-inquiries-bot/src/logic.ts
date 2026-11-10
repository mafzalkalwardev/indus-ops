import { extractJson, type TaskContext, type TaskResult } from '@indus/bot-core';

export type InquiryClass = 'sales' | 'support' | 'spam' | 'partnership' | 'other';

export function classify(subject: string, body: string): InquiryClass {
  const text = `${subject}\n${body}`.toLowerCase();
  if (/viagra|crypto giveaway|guest post/.test(text)) return 'spam';
  if (/partner|affiliate/.test(text)) return 'partnership';
  if (/bug|broken|refund|invoice/.test(text)) return 'support';
  if (/quote|pricing|website|project/.test(text)) return 'sales';
  return 'other';
}

export function ensureTable(db: TaskContext['db']) {
  db.exec(`CREATE TABLE IF NOT EXISTS inbox (
    id INTEGER PRIMARY KEY, source TEXT, external_id TEXT, from_email TEXT, subject TEXT, body TEXT,
    draft_status TEXT DEFAULT 'new', created_at TEXT, UNIQUE(source, external_id)
  )`);
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  ensureTable(ctx.db);
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You are the INDUS inquiries bot. Never say a reply was sent.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 300) };
  }
  if (ctx.dryRun) {
    const existing = ctx.db.prepare(`SELECT COUNT(*) AS n FROM inbox`).get() as { n: number };
    if (!existing.n) {
      ctx.db.prepare(`INSERT INTO inbox (source, external_id, from_email, subject, body, created_at) VALUES ('sample', 'sample', 'studio@example.com', 'A dispatch CRM', 'We need a quote for a dispatch CRM.', ?)`).run(ctx.now.toISOString());
    }
  }
  const rows = ctx.db.prepare(`SELECT * FROM inbox WHERE draft_status = 'new' LIMIT 5`).all() as { id: number; from_email: string; subject: string; body: string }[];
  for (const row of rows) {
    const reply = await ctx.llm('Classify this inquiry as JSON with classification, summary, replySubject, reply. This is an inquiry.', `${row.subject}\n${row.body}`);
    let draft = { classification: classify(row.subject, row.body), summary: row.subject, replySubject: `Re: ${row.subject}`, reply: 'Thanks for writing to INDUS. A person will follow up.' };
    try { draft = { ...draft, ...(extractJson(reply.text) as typeof draft) }; } catch { /* heuristic stays */ }
    ctx.propose({ type: 'inquiry_reply', title: row.subject || 'Inquiry', summary: draft.summary, body: draft.reply, payload: { to: row.from_email, subject: draft.replySubject } });
    ctx.db.prepare(`UPDATE inbox SET draft_status = 'drafted' WHERE id = ?`).run(row.id);
  }
  return { summary: rows.length ? `Drafted ${rows.length} repl${rows.length === 1 ? 'y' : 'ies'}. None were sent.` : 'No new inquiries.' };
}

export async function resolve(item: { body: string; payload: Record<string, unknown> }, _input: Record<string, unknown>, deps: { smtp: () => { host: string; from: string; port: number; secure: boolean; user: string; pass: string } }) {
  const { sendMail } = await import('@indus/bot-core');
  await sendMail(deps.smtp(), { to: String(item.payload.to || ''), subject: String(item.payload.subject || 'Re: your note'), text: item.body });
  return { sent: true };
}
