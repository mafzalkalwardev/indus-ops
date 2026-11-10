import { spawn } from 'node:child_process';
import path from 'node:path';

const root = '/workspace';
const shared = {
  HOST: '127.0.0.1',
  INDUS_BOT_TOKEN: 'dev-bot-token',
  INDUS_SSO_SECRET: 'dev-sso-secret',
  INDUS_LLM_PROVIDER: 'mock',
  INDUS_SHARED_DIR: path.join(root, 'data', 'shared'),
  HUB_URL: 'http://127.0.0.1:41731',
  SCHEDULER_URL: 'http://127.0.0.1:41748',
  COOKIE_SECURE: '0',
  WEBHOOK_SECRET: 'dev-webhook',
};
const services = [
  ['indus-ops', 41731],
  ['indus-scheduler-bot', 41748],
  ['indus-commander-bot', 41749],
  ['indus-monitor-bot', 41741],
  ['indus-seo-bot', 41742],
  ['indus-mailforge-bot', 41743],
  ['indus-inquiries-bot', 41744],
  ['indus-leads-bot', 41745],
  ['indus-reports-bot', 41746],
  ['indus-marketing-bot', 41747],
  ['indus-security-bot', 41751],
  ['indus-backup-bot', 41752],
  ['indus-devops-bot', 41753],
  ['indus-content-bot', 41754],
  ['indus-translator-bot', 41755],
  ['indus-crm-bot', 41756],
  ['indus-invoice-bot', 41757],
  ['indus-support-bot', 41758],
  ['indus-competitor-bot', 41759],
  ['indus-analytics-bot', 41760],
];

for (const [folder, port] of services) {
  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.join(root, folder),
    env: { ...process.env, ...shared, PORT: String(port) },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (code) console.error(`${folder} exited ${code}`);
  });
}
