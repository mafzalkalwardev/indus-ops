import { createBotService, safeEqual } from '@indus/bot-core';
import { ensureTable, resolve, run } from './logic';

createBotService({
  id: 'inquiries',
  name: 'Inquiries',
  description: 'Reads a mailbox and the contact form. Replies are drafted here and sent only when you approve.',
  accent: '#e07a6a',
  defaultPort: 41744,
  capabilities: ['inbox', 'webhook'],
  secretFields: ['imapPass', 'webhookSecret'],
  defaultSettings: { imapHost: '', imapPort: 993, imapUser: '', imapPass: '', webhookSecret: '' },
  fields: [
    { key: 'imapHost', label: 'IMAP host', type: 'text' },
    { key: 'imapPort', label: 'IMAP port', type: 'number' },
    { key: 'imapUser', label: 'IMAP user', type: 'text' },
    { key: 'imapPass', label: 'IMAP password', type: 'text', secret: true },
    { key: 'webhookSecret', label: 'Contact form secret', type: 'text', secret: true },
  ],
  desired: [{ key: 'check', task: 'check', cron: '*/15 * * * *', group: 'llm' }],
  autoTask: 'check',
  publicRoutes: (app, deps) => {
    app.post('/hooks/contact', (req, res) => {
      const secret = String(deps.settings().webhookSecret || deps.env.WEBHOOK_SECRET || '');
      const got = req.get('x-indus-webhook-secret') || String(req.body?.secret || '');
      if (!secret || !safeEqual(got, secret)) return res.status(401).json({ error: 'Webhook secret required.' });
      if (req.body?.company_website) return res.json({ ok: true });
      const email = String(req.body?.email || '');
      const message = String(req.body?.message || req.body?.body || '');
      if (!email || !message) return res.status(400).json({ error: 'email and message are required.' });
      ensureTable(deps.db);
      deps.db.prepare(`INSERT OR IGNORE INTO inbox (source, external_id, from_email, subject, body, created_at) VALUES ('webhook', ?, ?, ?, ?, ?)`)
        .run(`${email}:${message.slice(0, 40)}`, email, String(req.body?.subject || 'Website form'), message.slice(0, 8000), new Date().toISOString());
      res.status(202).json({ ok: true });
    });
  },
  runTask: run,
  resolveApproval: resolve,
}).start().catch((error) => { console.error(error); process.exit(1); });
