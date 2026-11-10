import { expect, it } from 'vitest';
import { hubPage } from '../src/page';

it('renders the owner board', () => {
  const html = hubPage();
  expect(html).toContain('INDUS Ops');
  expect(html).toContain('Nothing public leaves without an approval');
});
