import { createBotService } from '@indus/bot-core';
import { resolve, run } from './logic';

createBotService({
  id: 'backup',
  name: 'Backup',
  description: 'Copies app dirs, nginx, and optional Mongo dumps. A drill checks checksums. Live restore needs approval.',
  accent: '#9bb7c9',
  defaultPort: 41752,
  capabilities: ['backup'],
  secretFields: ['mongoUri'],
  defaultSettings: { paths: ['/etc/nginx'], keep: 7, mongoUri: '', restoreRoot: '' },
  fields: [
    { key: 'paths', label: 'Paths to copy', type: 'lines' },
    { key: 'keep', label: 'Copies to keep', type: 'number' },
    { key: 'mongoUri', label: 'Mongo URI for mongodump', type: 'text', secret: true },
    { key: 'restoreRoot', label: 'Only restore under this directory', type: 'text' },
  ],
  desired: [
    { key: 'backup', task: 'backup', cron: '30 2 * * *', group: 'default' },
    { key: 'drill', task: 'drill', cron: '0 4 * * 1', group: 'default' },
  ],
  autoTask: 'backup',
  runTask: run,
  resolveApproval: resolve,
}).start().catch((error) => { console.error(error); process.exit(1); });
