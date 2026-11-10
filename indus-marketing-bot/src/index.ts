import { createBotService, PRODUCT_SITES } from '@indus/bot-core';
import { resolve, run } from './logic';

createBotService({
  id: 'marketing',
  name: 'Marketing',
  description: 'LinkedIn and social drafts, local product videos, and an organic plan. Publishing waits for approval.',
  accent: '#e0b15c',
  defaultPort: 41747,
  capabilities: ['linkedin', 'video', 'organic'],
  secretFields: ['linkedinToken'],
  defaultSettings: { products: [...PRODUCT_SITES], postsPerWeek: 3, linkedinToken: '' },
  fields: [
    { key: 'products', label: 'Product URLs', type: 'lines' },
    { key: 'postsPerWeek', label: 'Posts per week across products', type: 'number' },
    { key: 'linkedinToken', label: 'LinkedIn access token', type: 'text', secret: true },
  ],
  desired: [
    { key: 'draft', task: 'draft', cron: '0 9 * * 1,3,5', group: 'llm' },
  ],
  autoTask: 'draft',
  extraHtml: '<article><h2>Media</h2><p class="sub">Rendered reels show up after a render job. Download stays on this machine until you approve a post that uses one.</p><div id="media"></div></article>',
  runTask: run,
  resolveApproval: resolve,
}).start().catch((error) => { console.error(error); process.exit(1); });
