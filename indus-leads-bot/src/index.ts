import { createBotService } from '@indus/bot-core';
import { run } from './logic';

createBotService({
  id: 'leads',
  name: 'Leads',
  description: 'Collects public freelance and agency listings that allow automated access, then drafts proposals.',
  accent: '#c9a27a',
  defaultPort: 41745,
  capabilities: ['leads'],
  defaultSettings: { minScore: 40 },
  fields: [{ key: 'minScore', label: 'Minimum score', type: 'number' }],
  desired: [{ key: 'check', task: 'check', cron: '10 8,14 * * *', group: 'llm' }],
  autoTask: 'check',
  runTask: run,
}).start().catch((error) => { console.error(error); process.exit(1); });
