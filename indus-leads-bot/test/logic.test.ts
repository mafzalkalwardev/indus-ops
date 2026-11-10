import { expect, it } from 'vitest';
import { dedupeKey, scoreLead } from '../src/logic';

it('scores relevant work and ignores unpaid posts', () => {
  expect(scoreLead('React SEO automation', 'freelance website')).toBeGreaterThan(scoreLead('Unpaid internship', 'exposure'));
  expect(dedupeKey('https://Example.com/jobs/1?ref=1', 'Role')).toBe('example.com/jobs/1');
});
