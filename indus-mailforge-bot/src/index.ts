import { createBotService } from '@indus/bot-core';
import { resolve, run } from './logic';

createBotService({
  id: 'mailforge',
  name: 'MailForge',
  description: 'Reads the local MailForge API, cleans lists, and will not schedule a campaign until you approve a time.',
  accent: '#7eb6d6',
  defaultPort: 41743,
  capabilities: ['campaigns', 'lists'],
  secretFields: ['password', 'mongoUri'],
  defaultSettings: { baseUrl: 'http://127.0.0.1:5000', email: '', password: '', mongoUri: '' },
  fields: [
    { key: 'baseUrl', label: 'MailForge URL', type: 'text' },
    { key: 'email', label: 'MailForge login email', type: 'text' },
    { key: 'password', label: 'MailForge password', type: 'text', secret: true },
    { key: 'mongoUri', label: 'Read-only Mongo fallback', type: 'text', secret: true },
  ],
  desired: [{ key: 'check', task: 'check', cron: '30 */4 * * *', group: 'llm' }],
  autoTask: 'check',
  runTask: run,
  resolveApproval: resolve,
}).start().catch((error) => { console.error(error); process.exit(1); });
