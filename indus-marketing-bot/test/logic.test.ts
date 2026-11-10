import { expect, it } from 'vitest';
import { deliveryMode, withUtm } from '../src/logic';
import { captionCues, toSrt } from '../src/video';

it('tags links and refuses to auto-post reddit', () => {
  const url = withUtm('https://mailforge.induswebagency.com/pricing', 'linkedin', 'feature');
  expect(url).toContain('utm_source=linkedin');
  expect(url).toContain('utm_content=feature');
  expect(deliveryMode('reddit', { linkedin: true, x: true, facebook: true })).toBe('export');
  expect(deliveryMode('linkedin', { linkedin: false, x: false, facebook: false })).toBe('export');
});

it('builds caption cues and an srt', () => {
  const cues = captionCues('one two three four five six seven eight nine ten');
  expect(cues.length).toBeGreaterThan(1);
  expect(toSrt(cues)).toContain('-->');
});
