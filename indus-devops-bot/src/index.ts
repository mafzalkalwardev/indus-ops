import { createBotService } from '@indus/bot-core';
import { resolve, run } from './logic';

createBotService({
  id: 'devops',
  name: 'DevOps',
  description: 'Reads public GitHub state for mafzalkalwardev and redeploys only an allowlisted app after approval.',
  accent: '#b9a6e0',
  defaultPort: 41753,
  capabilities: ['github', 'deploy'],
  secretFields: ['token'],
  defaultSettings: { user: 'mafzalkalwardev', token: '', targets: [] as { key: string; cwd: string; service: string }[] },
  fields: [
    { key: 'user', label: 'GitHub user', type: 'text' },
    { key: 'token', label: 'Optional token', type: 'text', secret: true },
  ],
  desired: [{ key: 'triage', task: 'triage', cron: '0 */4 * * *', group: 'default' }],
  autoTask: 'triage',
  runTask: run,
  resolveApproval: resolve,
}).start().catch((error) => { console.error(error); process.exit(1); });
