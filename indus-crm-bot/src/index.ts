import { createBotService } from '@indus/bot-core';
import { run } from './logic';

createBotService({
  id: 'crm',
  name: 'CRM',
  description: 'A small pipeline fed by inquiries and leads, with follow-ups and quote drafts.',
  accent: '#d98b6a',
  defaultPort: 41756,
  capabilities: ['pipeline'],
  defaultSettings: {},
  fields: [],
  desired: [{ key: 'sync', task: 'sync', cron: '0 9 * * 1-5', group: 'llm' }],
  autoTask: 'sync',
  collect: (deps) => {
    deps.db.exec(`CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, stage TEXT, note TEXT, touched_at TEXT)`);
    return { clients: deps.db.prepare(`SELECT name, stage, touched_at FROM clients ORDER BY id DESC LIMIT 12`).all() };
  },
  runTask: run,
}).start().catch((error) => { console.error(error); process.exit(1); });
