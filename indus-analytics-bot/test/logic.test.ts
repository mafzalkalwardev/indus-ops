import { expect, it } from 'vitest';
import { parseNginx, rollup, visitorKey } from '../src/logic';

it('hashes visitors and never keeps the raw address', () => {
  const ip = '203.0.113.10';
  const key = visitorKey(ip, 'ua', '2026-11-10', 'salt');
  expect(key).not.toContain(ip);
  expect(key).toMatch(/^[a-f0-9]+$/);
  const hit = parseNginx('1.2.3.4 - - [10/Nov/2026] "GET /pricing HTTP/1.1" 200 100 "https://news.ycombinator.com"');
  expect(hit?.path).toBe('/pricing');
  expect(rollup([{ path: '/pricing', referrer: '', day: '2026-11-10' }, { path: '/pricing', referrer: '', day: '2026-11-10' }])[0]).toEqual({ path: '/pricing', views: 2 });
});
