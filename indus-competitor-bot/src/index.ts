import { createBotService } from '@indus/bot-core';
import { run } from './logic';

createBotService({
  id: 'competitor',
  name: 'Competitors',
  description: 'Fetches public pages that robots.txt allows, and summarizes what changed.',
  accent: '#d0b48a',
  defaultPort: 41759,
  capabilities: ['watch'],
  defaultSettings: { pages: [] as string[] },
  fields: [{ key: 'pages', label: 'Public URLs', type: 'lines' }],
  desired: [{ key: 'scan', task: 'scan', cron: '0 8 * * 1', group: 'llm' }],
  autoTask: 'scan',
  runTask: run,
}).start().catch((error) => { console.error(error); process.exit(1); });
