import { createBotService, PRODUCT_SITES } from '@indus/bot-core';
import { resolve, run } from './logic';

createBotService({
  id: 'monitor',
  name: 'Monitor',
  description: 'Uptime, certificates, and the health of this VPS.',
  accent: '#d08b4c',
  defaultPort: 41741,
  capabilities: ['uptime', 'tls', 'host'],
  defaultSettings: {
    sites: [...PRODUCT_SITES],
    autoRestart: false,
    restartAllowlist: [] as string[],
  },
  fields: [
    { key: 'sites', label: 'Sites, one URL per line', type: 'lines' },
    { key: 'autoRestart', label: 'Auto-restart failed units on the allowlist', type: 'bool' },
    { key: 'restartAllowlist', label: 'systemd units that may restart themselves', type: 'lines' },
  ],
  desired: [{ key: 'check', task: 'check', cron: '*/10 * * * *', group: 'default' }],
  autoTask: 'check',
  runTask: run,
  resolveApproval: resolve,
}).start().catch((error) => {
  console.error(error);
  process.exit(1);
});
