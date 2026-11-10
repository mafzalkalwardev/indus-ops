import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = '/workspace';
const pkgs = [
  ['indus-ops', '@indus/ops', 41731, 'Hub dashboard and the only login.', []],
  ['indus-scheduler-bot', '@indus/scheduler-bot', 41748, 'Single clock for every bot.', []],
  ['indus-commander-bot', '@indus/commander-bot', 41749, 'Morning planner. It cannot approve public work.', []],
  ['indus-monitor-bot', '@indus/monitor-bot', 41741, 'Uptime, TLS, and host health.', []],
  ['indus-seo-bot', '@indus/seo-bot', 41742, 'Sitemaps, metadata, IndexNow, and draft briefs.', ['cheerio']],
  ['indus-mailforge-bot', '@indus/mailforge-bot', 41743, 'MailForge stats, list cleaning, campaign drafts.', ['mongodb']],
  ['indus-inquiries-bot', '@indus/inquiries-bot', 41744, 'IMAP and contact-form drafts. Sends only after approval.', ['imapflow', 'mailparser']],
  ['indus-leads-bot', '@indus/leads-bot', 41745, 'Public job leads and proposal drafts.', []],
  ['indus-reports-bot', '@indus/reports-bot', 41746, 'Daily digest across the fleet.', []],
  ['indus-marketing-bot', '@indus/marketing-bot', 41747, 'LinkedIn drafts, local videos, and the organic plan.', []],
  ['indus-security-bot', '@indus/security-bot', 41751, 'VPS audit and allowlisted fixes after approval.', []],
  ['indus-backup-bot', '@indus/backup-bot', 41752, 'Backups, checksums, and restore drills.', []],
  ['indus-devops-bot', '@indus/devops-bot', 41753, 'GitHub triage and approved redeploys.', []],
  ['indus-content-bot', '@indus/content-bot', 41754, 'Long-form drafts in the agency languages.', []],
  ['indus-translator-bot', '@indus/translator-bot', 41755, 'Localized pages with hreflang, published only after approval.', []],
  ['indus-crm-bot', '@indus/crm-bot', 41756, 'Pipeline, reminders, and proposal drafts.', []],
  ['indus-invoice-bot', '@indus/invoice-bot', 41757, 'Quotes and invoices as PDFs. No payment processing.', []],
  ['indus-support-bot', '@indus/support-bot', 41758, 'Embeddable product chat that escalates to Inquiries.', []],
  ['indus-competitor-bot', '@indus/competitor-bot', 41759, 'Polite change tracking of public competitor pages.', []],
  ['indus-analytics-bot', '@indus/analytics-bot', 41760, 'First-party beacon and nginx log rollups.', []],
];

for (const [folder, name, port, blurb, extras] of pkgs) {
  const dir = path.join(root, folder);
  mkdirSync(path.join(dir, 'deploy'), { recursive: true });
  const deps = {
    '@indus/bot-core': 'file:../indus-bot-core',
    ...Object.fromEntries(extras.map((dep) => [dep, dep === 'cheerio' ? '^1.0.0' : dep === 'mongodb' ? '^6.15.0' : dep === 'imapflow' ? '^1.0.184' : '^3.7.2'])),
  };
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: { start: 'tsx src/index.ts', test: 'vitest run' },
    dependencies: deps,
    devDependencies: { tsx: '^4.19.3', typescript: '^5.8.3', vitest: '^3.1.1' },
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true,
      noEmit: true, skipLibCheck: true, esModuleInterop: true, types: ['node'],
    },
    include: ['src', 'test'],
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ndata/\ndist/\n.env\n*.sqlite\n*.sqlite-*\n');
  writeFileSync(path.join(dir, '.env.example'), `HOST=127.0.0.1
PORT=${port}
INDUS_BOT_TOKEN=
INDUS_SSO_SECRET=
INDUS_ENCRYPTION_KEY=
INDUS_SHARED_DIR=/opt/indus/shared
HUB_URL=http://127.0.0.1:41731
SCHEDULER_URL=http://127.0.0.1:41748
INDUS_LLM_PROVIDER=ollama
LLM_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://127.0.0.1:11434
LLM_TIMEOUT_MS=240000
DATA_DIR=./data
`);
  const unit = folder.replace('indus-', '').replace('-bot', '');
  writeFileSync(path.join(dir, 'deploy', `${folder}.service`), `[Unit]
Description=${name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=indus
Group=indus
WorkingDirectory=/opt/indus/${folder}
EnvironmentFile=/opt/indus/.env
ExecStart=/usr/bin/node --import tsx src/index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`);
  writeFileSync(path.join(dir, 'deploy', 'nginx-snippet.conf'), `# Do not publish this port. The hub at ops.induswebagency.com proxies /bots/${unit === 'ops' ? '' : unit}/ 
# after the owner signs in. This block is only for debugging on the VPS itself.
# server 127.0.0.1:${port};
`);
  writeFileSync(path.join(dir, 'README.md'), `# ${name}

${blurb}

This service binds to 127.0.0.1:${port}. The hub is the only public site. It reverse-proxies the UI at \`/bots/${folder.replace('indus-', '').replace('-bot', '')}/\` after login.

\`\`\`bash
npm install
cp .env.example .env
npm test
npm start
\`\`\`

The shared SDK is \`@indus/bot-core\` (sibling folder, or \`github:mafzalkalwardev/indus-bot-core\` once that private repo exists). Secrets stay in \`.env\`. The model is whatever \`LLM_MODEL\` points at in Ollama. Nothing public is sent from this process without an approval recorded by the hub.

Idle cost is one small Node process. LLM calls take the shared lock in \`INDUS_SHARED_DIR\` so only one model run happens on the box.
`);
}
console.log('wrote', pkgs.length);
