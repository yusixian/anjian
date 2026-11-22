import path from 'node:path';

import { type AnchorSpec, isObject, waitingOn } from '../../shared/comments';
import { ARTIFACT_LOCATOR_SOURCE } from '../../shared/ids';
import type {
  anchoredComments} from '../anchored-artifact-comments';
import {
  asAnchoredAgentOp,
  asAnchoredHumanOp,
} from '../anchored-artifact-comments';
import { resolveArtifactAddress } from '../artifact-address';
import type { ServerContext } from '../context';
import { sendJson } from '../http';
import { listeningOn } from '../listening';
import { remoteCommentCursor } from '../remote-identity';
import { RemoteTransferError } from '../remote-transfer';
import {
  refreshRequestStorageAdmission,
  requestStorageAdmission,
} from '../storage/request-admission';
import { readCommentBody } from './comments';
import type { HttpRoute } from './table';

interface CommentRouteOptions<A> {
  anchors: AnchorSpec<A>;
  commentsOf: ReturnType<typeof anchoredComments<A>>;
  error: new (status: number, message: string) => Error & { status: number };
  label: string;
  readSource: (dir: string) => unknown;
  type: 'slides' | 'storyboard';
}

export function anchoredArtifactRoutes<A>(options: CommentRouteOptions<A>) {
  const { anchors, commentsOf, error: ErrorType, label, readSource, type } = options;
  const COMMENTS = new RegExp(`^/api/${type}/(${ARTIFACT_LOCATOR_SOURCE})/comments$`);
  const AGENT_COMMENTS = new RegExp(`^/api/agent/${type}/(${ARTIFACT_LOCATOR_SOURCE})/comments$`);

  function resolve(ctx: ServerContext, address: string) {
    const entry = resolveArtifactAddress(ctx.root, type, address);
    if (!entry) throw new ErrorType(404, `${label} not found`);
    return entry;
  }

  function commentState(ctx: ServerContext, dir: string) {
    const store = commentsOf(ctx, dir);
    store.sync();
    const warnings = store.warnings();
    return {
      comments: store.current(),
      listening: listeningOn(ctx.stateDir, `${type}/${path.basename(dir)}`),
      ...(warnings.length ? { commentsWarning: warnings.join('\n') } : {}),
    };
  }

  function fail(res: Parameters<typeof sendJson>[0], error: unknown) {
    if (error instanceof RemoteTransferError) {
      sendJson(res, error.status, { code: error.code, error: error.message });
    } else if (error instanceof ErrorType) {
      sendJson(res, error.status, { error: error.message });
    } else throw error;
  }

  const viewer: HttpRoute<ServerContext> = {
    path: COMMENTS,
    methods: ['POST'],
    auth: 'same-origin',
    async handle(req, res, ctx, { key, match }) {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const op = asAnchoredHumanOp(await readCommentBody(req), anchors);
        if (!op) throw new ErrorType(400, `Invalid ${label.toLowerCase()} comment operation`);
        await refreshRequestStorageAdmission(req);
        if (!ctx.isAuthorized(req, key)) throw new ErrorType(403, 'Forbidden');
        const { id, dir } = resolve(ctx, match[1]!);
        const store = commentsOf(ctx, dir);
        store.apply(op, requestStorageAdmission(req));
        ctx.broadcast({ type: 'change', artifact: `${type}/${id}`, files: ['comments.json'] });
        sendJson(res, 200, commentState(ctx, dir));
      } catch (error) {
        fail(res, error);
      }
    },
  };

  const agentRoute: HttpRoute<ServerContext> = {
    path: AGENT_COMMENTS,
    methods: ['POST'],
    auth: 'agent',
    async handle(req, res, ctx, { key, match }) {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const body = await readCommentBody(req);
        if (!isObject(body))
          throw new ErrorType(400, `Invalid ${label.toLowerCase()} agent comment operation`);
        await refreshRequestStorageAdmission(req);
        if (!ctx.isAuthorized(req, key) || !ctx.agentOk(req, key))
          throw new ErrorType(403, 'Forbidden');
        const { id, dir } = resolve(ctx, match[1]!);
        const agent =
          typeof body.agent === 'string' && body.agent.trim() && body.agent.length <= 100
            ? body.agent
            : undefined;
        const store = commentsOf(ctx, dir);
        const admit = requestStorageAdmission(req);
        if (body.op === 'list') {
          readSource(dir);
          sendJson(res, 200, {
            type: 'comments',
            artifact: `${type}/${id}`,
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
        const op = asAnchoredAgentOp(body, anchors);
        if (!op) throw new ErrorType(400, `Invalid ${label.toLowerCase()} agent comment operation`);
        const { threadId, messageId } = store.applyAgent(op, agent, admit);
        ctx.broadcast({ type: 'change', artifact: `${type}/${id}`, files: ['comments.json'] });
        sendJson(res, 200, { threadId, ...(messageId ? { messageId } : {}) });
      } catch (error) {
        fail(res, error);
      }
    },
  };

  return { agentRoute, commentState, viewer };
}
