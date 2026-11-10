import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { preparePlan } from '../src/plan';

it('drops public work and falls back to checks', () => {
  const result = preparePlan({
    reasoning: 'Ship it.',
    actions: [{ botId: 'marketing', task: 'publish', reason: 'now' }, { botId: 'monitor', task: 'check', reason: 'look' }],
  }, ['monitor', 'marketing']);
  expect(result.accepted.map((action) => action.task)).toEqual(['check']);
  expect(result.rejected).toHaveLength(1);
});

it('does not call the approval API', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  expect(source.includes('/api/approvals')).toBe(false);
  expect(source.includes('apply-fix')).toBe(false);
});
