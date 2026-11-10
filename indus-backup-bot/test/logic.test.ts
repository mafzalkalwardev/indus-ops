import { expect, it } from 'vitest';
import { filesToDelete, sha256 } from '../src/logic';

it('rotates old copies and hashes bytes', () => {
  expect(filesToDelete(['b', 'a', 'c', 'd'], 2)).toEqual(['a', 'b']);
  expect(sha256(Buffer.from('indus'))).toHaveLength(64);
});
