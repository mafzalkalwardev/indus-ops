import { expect, it } from 'vitest';
import { classify } from '../src/logic';

it('classifies without sending', () => {
  expect(classify('Quote', 'We need a website')).toBe('sales');
  expect(classify('Guest post', 'crypto giveaway')).toBe('spam');
  expect(classify('Bug', 'the form is broken')).toBe('support');
});
