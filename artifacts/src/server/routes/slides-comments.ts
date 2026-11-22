import path from 'node:path';

import { isObject, waitingOn } from '../../shared/comments';
import { ARTIFACT_LOCATOR_SOURCE } from '../../shared/ids';
import { resolveArtifactAddress } from '../artifact-address';
import type { ServerContext } from '../context';
import { sendJson } from '../http';
import { listeningOn } from '../listening';
import { remoteCommentCursor } from '../remote-identity';
import { RemoteTransferError } from '../remote-transfer';
import { readSlideDeck, SlideDeckError } from '../slides';
import { asSlideAgentOp, asSlideHumanOp, slidesCommentsOf } from '../slides-comments';
import {
  refreshRequestStorageAdmission,
  requestStorageAdmission,
} from '../storage/request-admission';
import { readCommentBody } from './comments';
import type { HttpRoute } from './table';

const COMMENTS = new RegExp(`^/api/slides/(${ARTIFACT_LOCATOR_SOURCE})/comments$`);
const AGENT_COMMENTS = new RegExp(`^/api/agent/slides/(${ARTIFACT_LOCATOR_SOURCE})/comments$`);

function resolveSlides(ctx: ServerContext, address: string) {
  const entry = resolveArtifactAddress(ctx.root, 'slides', address);
  if (!entry) throw new SlideDeckError(404, 'Slide deck not found');
  return entry;
}

export function slideCommentState(ctx: ServerContext, dir: string) {
  const store = slidesCommentsOf(ctx, dir);
  store.sync();
  const warnings = store.warnings();
  return {
    comments: store.current(),
    listening: listeningOn(ctx.stateDir, `slides/${path.basename(dir)}`),
    ...(warnings.length ? { commentsWarning: warnings.join('\n') } : {}),
  };
}

function fail(res: Parameters<typeof sendJson>[0], error: unknown) {
  if (error instanceof RemoteTransferError) {
    sendJson(res, error.status, { code: error.code, error: error.message });
  } else if (error instanceof SlideDeckError) {
    sendJson(res, error.status, { error: error.message });
  } else throw error;
}

export const slidesCommentRoute: HttpRoute<ServerContext> = {
  path: COMMENTS,
  methods: ['POST'],
  auth: 'same-origin',
  async handle(req, res, ctx, { key, match }) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const op = asSlideHumanOp(await readCommentBody(req));
      if (!op) throw new SlideDeckError(400, 'Invalid slide comment operation');
      await refreshRequestStorageAdmission(req);
      if (!ctx.isAuthorized(req, key)) throw new SlideDeckError(403, 'Forbidden');
      const { id, dir } = resolveSlides(ctx, match[1]!);
      const store = slidesCommentsOf(ctx, dir);
      store.apply(op, requestStorageAdmission(req));
      ctx.broadcast({ type: 'change', artifact: `slides/${id}`, files: ['comments.json'] });
      sendJson(res, 200, slideCommentState(ctx, dir));
    } catch (error) {
      fail(res, error);
    }
  },
};

export const slidesAgentCommentRoute: HttpRoute<ServerContext> = {
  path: AGENT_COMMENTS,
  methods: ['POST'],
  auth: 'agent',
  async handle(req, res, ctx, { key, match }) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const body = await readCommentBody(req);
      if (!isObject(body)) throw new SlideDeckError(400, 'Invalid slide agent comment operation');
      await refreshRequestStorageAdmission(req);
      if (!ctx.isAuthorized(req, key) || !ctx.agentOk(req, key))
        throw new SlideDeckError(403, 'Forbidden');
      const { id, dir } = resolveSlides(ctx, match[1]!);
      const agent =
        typeof body.agent === 'string' && body.agent.trim() && body.agent.length <= 100
          ? body.agent
          : undefined;
      const store = slidesCommentsOf(ctx, dir);
      const admit = requestStorageAdmission(req);
      if (body.op === 'list') {
        readSlideDeck(dir);
        sendJson(res, 200, {
          type: 'comments',
          artifact: `slides/${id}`,
          threads: store
            .list(remoteCommentCursor(req, agent ?? 'Agent'), body.all === true, admit)
            .map((thread) => ({
              ...thread,
              waitingOn: waitingOn(thread),
              messages: thread.messages.map(({ avatar: _avatar, ...message }) => message),
            })),
        });
        return;
      }
      const op = asSlideAgentOp(body);
      if (!op) throw new SlideDeckError(400, 'Invalid slide agent comment operation');
      const { threadId, messageId } = store.applyAgent(op, agent, admit);
      ctx.broadcast({ type: 'change', artifact: `slides/${id}`, files: ['comments.json'] });
      sendJson(res, 200, { threadId, ...(messageId ? { messageId } : {}) });
    } catch (error) {
      fail(res, error);
    }
  },
};
