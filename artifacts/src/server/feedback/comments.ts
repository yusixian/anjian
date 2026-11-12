import fs from 'node:fs';
import path from 'node:path';

import type { Thread } from '../../shared/comments';
import { feedbackError, hash } from './store';

export function validThread(value: unknown): value is Thread<unknown> {
  const t = value as Thread<unknown>;
  return (
    !!t &&
    typeof t.id === 'string' &&
    !!t.anchor &&
    typeof t.statusAt === 'string' &&
    (t.status === 'open' || t.status === 'resolved') &&
    Array.isArray(t.messages) &&
    t.messages.every(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.text === 'string' &&
        typeof m.at === 'string' &&
        (m.author === 'human' || m.author === 'agent') &&
        (m.editedAt === undefined || typeof m.editedAt === 'string') &&
        (m.deleted === undefined || typeof m.deleted === 'boolean'),
    ) &&
    new Set(t.messages.map((m) => m.id)).size === t.messages.length
  );
}
export const feedbackSelection = (threads: Thread<unknown>[]) =>
  threads
    .filter((t) => t.status === 'open')
    .map((t) => ({
      threadId: t.id,
      messageIds: t.messages.filter((m) => !m.deleted).map((m) => m.id),
      version: hash(t),
    }));
/** Read the saved boundary without normalizing comments or consuming an agent cursor. */
export function readFeedbackComments(
  root: string,
  type: 'document' | 'artboard',
  id: string,
): Thread<unknown>[] {
  const file = path.join(root, type, id, 'comments.json');
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
      feedbackError('unsafe_feedback_comments');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      value.version !== 1 ||
      !Array.isArray(value.threads) ||
      !value.threads.every(validThread) ||
      new Set(value.threads.map((t: Thread<unknown>) => t.id)).size !== value.threads.length
    )
      feedbackError('invalid_feedback_comments');
    return value.threads;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
