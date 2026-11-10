import { expect, it } from 'vitest';
import { brief } from '../src/logic';

it('names the language in the brief', () => {
  expect(brief('MailForge', 'Urdu')).toContain('Urdu');
  expect(brief('MailForge', 'Haitian Creole')).toContain('internal links');
});
