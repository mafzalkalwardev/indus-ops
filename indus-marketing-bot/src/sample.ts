import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { renderReel } from './video';

const outDir = process.argv[2] || '/tmp/indus-sample';
mkdirSync(outDir, { recursive: true });
const result = await renderReel({
  workDir: outDir,
  title: 'MailForge',
  script: 'MailForge keeps list checks and campaigns on your own server. You upload a list, verify it, and send only to addresses that passed. Replies land in one inbox. The data stays with you.',
  aspect: '9:16',
});
console.log(JSON.stringify(result));
