import { expect, it } from 'vitest';
import { cleanEmails } from '../src/logic';

it('dedupes and drops disposable addresses', () => {
  const result = cleanEmails(['A@Example.com', 'a@example.com', 'nope', 'spam@mailinator.com']);
  expect(result.kept).toEqual(['a@example.com']);
  expect(result.removed).toBe(3);
});
