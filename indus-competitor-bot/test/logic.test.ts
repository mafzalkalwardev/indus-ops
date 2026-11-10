import { expect, it } from 'vitest';
import { hashText, robotsAllows } from '../src/logic';

it('skips paths robots.txt disallows', () => {
  const robots = 'User-agent: *\nDisallow: /private\nAllow: /';
  expect(robotsAllows(robots, '/private/pricing')).toBe(false);
  expect(robotsAllows(robots, '/pricing')).toBe(true);
  expect(hashText('A  b')).toBe(hashText('A b'));
});
