import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createBotService } from '@indus/bot-core';
import { createDocument, run } from './logic';

const svc = createBotService({
  id: 'invoice',
  name: 'Invoices',
  description: 'Quotes and invoices as PDFs. You mark them paid by hand. Nothing here charges a card.',
  accent: '#c7d0b0',
  defaultPort: 41757,
  capabilities: ['invoice'],
  defaultSettings: {},
  fields: [],
  desired: [{ key: 'report', task: 'report', cron: '0 8 * * 1', group: 'default' }],
  autoTask: 'report',
  routes: (app, deps) => {
    app.post('/api/documents', (req, res) => {
      const doc = createDocument(deps.db, { kind: req.body?.kind === 'quote' ? 'quote' : 'invoice', client: String(req.body?.client || 'Client'), lines: req.body?.lines || [{ qty: 1, price: 0, label: 'Work' }] });
      const dir = path.join(deps.dataDir, 'pdf');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${doc.number}.pdf`), doc.pdf);
      res.status(201).json({ ok: true, number: doc.number });
    });
    app.post('/api/documents/:number/paid', (req, res) => {
      deps.db.prepare(`UPDATE docs SET status = 'paid' WHERE number = ?`).run(req.params.number);
      res.json({ ok: true });
    });
  },
  runTask: run,
});

svc.db.exec(`CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, kind TEXT, number TEXT, client TEXT, total INTEGER, status TEXT, created_at TEXT)`);
svc.start().catch((error) => { console.error(error); process.exit(1); });
