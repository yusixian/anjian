import fs from 'node:fs';
import path from 'node:path';

import type { Thread } from '../../shared/comments';
import type { FeedbackArtifactType } from '../../shared/feedback-artifact';
import { slideAnchors } from '../../shared/slides';
import { storyboardAnchors } from '../../shared/storyboard';
import { MAX_WHITEBOARD_SCENE_BYTES, whiteboardAnchors } from '../../shared/whiteboard';
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
const nativeAnchors = {
  whiteboard: whiteboardAnchors,
  slides: slideAnchors,
  storyboard: storyboardAnchors,
};

/** Read the saved boundary without normalizing comments or consuming an agent cursor. */
export function readFeedbackComments(
  root: string,
  type: FeedbackArtifactType,
  id: string,
): Thread<unknown>[] {
  const file = path.join(root, type, id, 'comments.json');
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT') return [];
    if (code === 'ELOOP') feedbackError('unsafe_feedback_comments');
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    const maxBytes = type === 'whiteboard' ? MAX_WHITEBOARD_SCENE_BYTES : 4 * 1024 * 1024;
    if (!stat.isFile() || stat.size > maxBytes) feedbackError('unsafe_feedback_comments');
    const contents = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < contents.length) {
      const chunk = fs.readSync(fd, contents, length, contents.length - length, null);
      if (!chunk) break;
      length += chunk;
    }
    if (length !== stat.size) feedbackError('feedback_changed');
    const value = JSON.parse(contents.toString('utf8', 0, length));
    const anchors = type === 'artboard' || type === 'document' ? null : nativeAnchors[type];
    if (
      value?.version !== 1 ||
      !Array.isArray(value.threads) ||
      !value.threads.every(
        (thread: unknown) =>
          validThread(thread) && (anchors === null || anchors.read(thread.anchor) !== null),
      ) ||
      new Set(value.threads.map((t: Thread<unknown>) => t.id)).size !== value.threads.length
    )
      feedbackError('invalid_feedback_comments');
    return value.threads;
  } catch (error) {
    if (error instanceof SyntaxError) feedbackError('invalid_feedback_comments');
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}
