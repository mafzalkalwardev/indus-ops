import { expect, it } from 'vitest';
import { parseDf, parseMeminfo, planRestart } from '../src/logic';

it('restarts only an allowlisted failed unit', () => {
  expect(planRestart('nginx', 'failed', ['nginx'], true)).toBe('restart');
  expect(planRestart('nginx', 'failed', [], false)).toBe('propose');
  expect(planRestart('nginx', 'active', ['nginx'], true)).toBe('ignore');
  expect(planRestart('nginx;rm', 'failed', ['nginx;rm'], true)).toBe('ignore');
});

it('reads memory and disk text', () => {
  expect(parseMeminfo('MemTotal: 1000 kB\nMemAvailable: 250 kB\n')).toBe(75);
  expect(parseDf('Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/root 100 40 60 40% /\n')).toBe(40);
});
