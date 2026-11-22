import type { IncomingMessage } from 'node:http';

import type { CommentsFile } from '../../shared/comments';
import { ARTIFACT_LOCATOR_SOURCE } from '../../shared/ids';
import { resolveArtifactAddress } from '../artifact-address';
import type { ServerContext } from '../context';
import { type CommentAdmission, InvalidCommentBackup } from '../document-comments';
import { sendJson } from '../http';
import { SlideDeckError } from '../slides';
import { slidesCommentsOf } from '../slides-comments';
import {
  refreshRequestStorageAdmission,
  requestStorageAdmission,
} from '../storage/request-admission';
import { storyboardCommentsOf } from '../storyboard-comments';
import { StoryboardError } from '../storyboard-source';
import { whiteboardCommentsOf,WhiteboardError } from '../whiteboard';
import { readCommentBody } from './comments';
import type { HttpRoute } from './table';

const MAX_COMMENT_BACKUP = 4 * 1024 * 1024;
const RECOVERY_PATH = new RegExp(
  `^/api/(document|artboard|slides|storyboard|whiteboard)/(${ARTIFACT_LOCATOR_SOURCE})/comments/(restore|recovery/review|recovery/apply)$`,
);

const stores = {
  slides: slidesCommentsOf,
  storyboard: storyboardCommentsOf,
  whiteboard: whiteboardCommentsOf,
};
type RecoveryType = 'document' | 'artboard' | keyof typeof stores;
interface RecoveryStore {
  current: () => CommentsFile<unknown>;
  recovery: () => { backup: CommentsFile<unknown>; revision: string } | null;
  restore: (text: string, admit?: CommentAdmission) => unknown;
  restoreRecovery: (revision: string, admit?: CommentAdmission) => boolean;
}

async function readBackup(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_COMMENT_BACKUP) chunks.push(chunk);
  }
  return size <= MAX_COMMENT_BACKUP ? Buffer.concat(chunks).toString('utf8') : null;
}

export const commentRecoveryRoute: HttpRoute<ServerContext> = {
  path: RECOVERY_PATH,
  methods: ['POST'],
  auth: 'same-origin',
  async handle(req, res, ctx, { key, match }) {
    res.setHeader('Cache-Control', 'no-store');
    const type = match[1]! as RecoveryType;
    const action = match[3]!;
    const review = action === 'recovery/review';
    let text: string | null = null;
    let revision: unknown;
    if (action === 'restore') {
      if (req.headers['content-type']?.split(';', 1)[0]?.trim() !== 'application/json') {
        sendJson(res, 415, { error: 'Expected a JSON comment backup' });
        return;
      }
      text = await readBackup(req);
      if (text === null) {
        sendJson(res, 413, { error: 'Comment backup exceeds 4 MiB' });
        return;
      }
    } else if (!review) {
      const body = (await readCommentBody(req)) as { revision?: unknown } | null;
      revision = body?.revision;
      if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
        sendJson(res, 400, { error: 'Invalid comment recovery revision' });
        return;
      }
    }
    if (!review) await refreshRequestStorageAdmission(req);
    if (!ctx.isAuthorized(req, key)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    const entry = resolveArtifactAddress(ctx.root, type, match[2]!, { mintMissing: false });
    if (!entry) {
      sendJson(res, 404, { error: 'Artifact not found' });
      return;
    }
    const { id, dir } = entry;
    try {
      const store: RecoveryStore =
        type === 'artboard'
          ? {
              current: () => ctx.boardComments.viewerComments(id),
              recovery: () => ctx.boardComments.commentRecovery(id),
              restore: (backup, admit) => ctx.boardComments.restoreComments(id, backup, admit),
              restoreRecovery: (expected, admit) =>
                ctx.boardComments.restoreCommentRecovery(id, expected, admit),
            }
          : type === 'document'
            ? {
                current: () => ctx.documents.viewerComments(id),
                recovery: () => ctx.documents.commentRecovery(id),
                restore: (backup, admit) => ctx.documents.restoreComments(id, backup, admit),
                restoreRecovery: (expected, admit) =>
                  ctx.documents.restoreCommentRecovery(id, expected, admit),
              }
            : stores[type](ctx, dir);
      if (review) {
        sendJson(res, 200, { recovery: store.recovery() });
        return;
      }
      const admit = requestStorageAdmission(req);
      if (text !== null) store.restore(text, admit);
      else if (!store.restoreRecovery(revision as string, admit)) {
        sendJson(res, 409, { error: 'Comment recovery changed. Review it again.' });
        return;
      }
      if (type !== 'document' && type !== 'artboard')
        ctx.broadcast({ type: 'change', artifact: `${type}/${id}`, files: ['comments.json'] });
      sendJson(res, 200, { comments: store.current() });
    } catch (error) {
      if (error instanceof InvalidCommentBackup) sendJson(res, 400, { error: error.message });
      else if (
        error instanceof SlideDeckError ||
        error instanceof StoryboardError ||
        error instanceof WhiteboardError
      )
        sendJson(res, error.status, { error: error.message });
      else throw error;
    }
  },
};
