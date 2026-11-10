import { expect, it } from 'vitest';
import { summarizeRepos } from '../src/logic';

it('summarizes public repos without deploying', () => {
  expect(summarizeRepos([{ name: 'mailforge', open_issues_count: 2 }])).toContain('mailforge');
});
