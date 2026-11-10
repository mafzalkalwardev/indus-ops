import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = '/workspace/docs/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:41731/', { waitUntil: 'networkidle' });
await page.fill('#user', 'tony');
await page.fill('#pass', 'indus-ops-owner');
await page.click('button[type=submit]');
await page.waitForSelector('text=Ops', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/hub-overview.png`, fullPage: true });
await page.click('button[data-go=inbox]');
await page.waitForSelector('text=Inbox', { timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/hub-inbox.png`, fullPage: true });
await page.goto('http://127.0.0.1:41731/bots/commander/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/commander.png`, fullPage: false });
await page.goto('http://127.0.0.1:41731/bots/monitor/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/monitor.png`, fullPage: true });
await page.goto('http://127.0.0.1:41731/bots/marketing/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/marketing.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto('http://127.0.0.1:41731/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/hub-mobile.png`, fullPage: true });
await browser.close();
console.log('shots written');
