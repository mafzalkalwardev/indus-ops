import { createBotService, PRODUCT_SITES } from '@indus/bot-core';
import { resolve, run } from './logic';

createBotService({
  id: 'translator',
  name: 'Translator',
  description: 'Drafts localized pages with hreflang. Files are written only after approval.',
  accent: '#f0d7a4',
  defaultPort: 41755,
  capabilities: ['i18n'],
  defaultSettings: { pages: [...PRODUCT_SITES], publishDir: '' },
  fields: [
    { key: 'pages', label: 'Pages', type: 'lines' },
    { key: 'publishDir', label: 'Publish directory', type: 'text' },
  ],
  desired: [{ key: 'translate', task: 'translate', cron: '0 12 * * 3', group: 'llm' }],
  autoTask: 'translate',
  runTask: run,
  resolveApproval: resolve,
}).start().catch((error) => { console.error(error); process.exit(1); });
