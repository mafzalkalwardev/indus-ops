import { expect, it } from 'vitest';
import { followUpDue } from '../src/logic';

it('reminds on quiet deals and leaves closed ones alone', () => {
  const now = new Date('2026-11-10T00:00:00.000Z');
  expect(followUpDue('proposal', '2026-11-01T00:00:00.000Z', now)).toBe(true);
  expect(followUpDue('won', '2026-01-01T00:00:00.000Z', now)).toBe(false);
});
