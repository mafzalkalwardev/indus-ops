import { createBotService, PRODUCT_SITES } from '@indus/bot-core';
import { run } from './logic';

createBotService({
  id: 'content',
  name: 'Content',
  description: 'Long-form drafts in English, Spanish, French, Urdu, Punjabi, Sindhi, and Haitian Creole.',
  accent: '#e6d3a3',
  defaultPort: 41754,
  capabilities: ['articles'],
  defaultSettings: { products: [...PRODUCT_SITES] },
  fields: [{ key: 'products', label: 'Products', type: 'lines' }],
  desired: [{ key: 'draft', task: 'draft', cron: '0 11 * * 2,4', group: 'llm' }],
  autoTask: 'draft',
  runTask: run,
}).start().catch((error) => { console.error(error); process.exit(1); });
