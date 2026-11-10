export { execCommand, fetchText } from '@indus/bot-core';
export type { TaskContext, TaskResult } from '@indus/bot-core';
import { readFileSync } from 'node:fs';

export function readFileSyncMaybe(file: string): string {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}
