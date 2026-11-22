import { createHash } from 'node:crypto';
import type http from 'node:http';
import path from 'node:path';

import { isObject, waitingOn } from '../../shared/comments';
import { ARTIFACT_LOCATOR_SOURCE } from '../../shared/ids';
import {
  isWhiteboardPageId,
  MAX_WHITEBOARD_SCENE_BYTES,
  parseWhiteboardScene,
  WHITEBOARD_DEFAULT_PAGE,
  WHITEBOARD_PAGES_FILE,
  whiteboardPageFile,
  type WhiteboardScene,
  type WhiteboardSnapshot,
} from '../../shared/whiteboard';
import { resolveArtifactAddress } from '../artifact-address';
import type { ServerContext } from '../context';
import { send, sendJson } from '../http';
import { listeningOn } from '../listening';
import { remoteCommentCursor } from '../remote-identity';
import {
  refreshRequestStorageAdmission,
  requestStorageAdmission,
} from '../storage/request-admission';
import {
  assertWhiteboardElements,
  asWhiteboardAgentOp,
  asWhiteboardHumanOp,
  editWhiteboardPages,
  readWhiteboardPages,
  readWhiteboardScene,
  whiteboardCommentsOf,
  WhiteboardError,
  whiteboardTitle,
  writeWhiteboardScene,
} from '../whiteboard';
import { readCommentBody } from './comments';
import type { HttpRoute } from './table';

const SCENE = new RegExp(`^/api/whiteboard/(${ARTIFACT_LOCATOR_SOURCE})$`);
const PAGES = new RegExp(`^/api/whiteboard/(${ARTIFACT_LOCATOR_SOURCE})/pages$`);
const COMMENTS = new RegExp(`^/api/(agent/)?whiteboard/(${ARTIFACT_LOCATOR_SOURCE})/comments$`);
const MAX_WRITE_BODY = MAX_WHITEBOARD_SCENE_BYTES + 1024;

function resolveWhiteboard(ctx: ServerContext, id: string) {
  const entry = resolveArtifactAddress(ctx.root, 'whiteboard', id);
  if (!entry) throw new WhiteboardError(404, 'Whiteboard not found');
  return entry;
}

async function readWriteBody(req: http.IncomingMessage, limit = MAX_WRITE_BODY): Promise<unknown> {
  if (Number(req.headers['content-length'] ?? 0) > limit) {
    req.resume();
    throw new WhiteboardError(413, 'Whiteboard request is too large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      req.resume();
      throw new WhiteboardError(413, 'Whiteboard request is too large');
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new WhiteboardError(400, 'Whiteboard request must be JSON');
  }
}

function commentState(ctx: ServerContext, dir: string) {
  const comments = whiteboardCommentsOf(ctx, dir);
  comments.sync();
  const warnings = comments.warnings();
  return {
    comments: comments.current(),
    listening: listeningOn(ctx.stateDir, `whiteboard/${path.basename(dir)}`),
    ...(warnings.length ? { commentsWarning: warnings.join('\n') } : {}),
  };
}

function boardTitle(dir: string, page: string, scene: WhiteboardScene) {
  if (page === WHITEBOARD_DEFAULT_PAGE) return whiteboardTitle(scene, dir);
  try {
    return whiteboardTitle(readWhiteboardScene(dir).scene, dir);
  } catch (error) {
    if (!(error instanceof WhiteboardError)) throw error;
    return path.basename(dir);
  }
}

function requestedPage(url: URL) {
  const page = url.searchParams.get('page') ?? WHITEBOARD_DEFAULT_PAGE;
  if (!isWhiteboardPageId(page)) throw new WhiteboardError(400, 'Invalid whiteboard page id');
  return page;
}

function snapshot(ctx: ServerContext, dir: string, page: string): WhiteboardSnapshot {
  const pages = readWhiteboardPages(dir);
  const { scene, revision } = readWhiteboardScene(dir, page);
  return {
    page,
    pages,
    scene,
    revision,
    title: boardTitle(dir, page, scene),
    ...commentState(ctx, dir),
  };
}

function sendSnapshot(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  view: WhiteboardSnapshot,
) {
  const { scene: _scene, ...metadata } = view;
  const tag = `"${createHash('sha256').update(JSON.stringify(metadata)).digest('hex')}"`;
  res.setHeader('ETag', tag);
  if (req.method === 'GET' && req.headers['if-none-match'] === tag) send(res, 304, '');
  else sendJson(res, 200, view);
}

function fail(res: http.ServerResponse, error: unknown) {
  if (error instanceof WhiteboardError) sendJson(res, error.status, { error: error.message });
  else throw error;
}

export const whiteboardSceneRoute: HttpRoute<ServerContext> = {
  path: SCENE,
  methods: ['GET', 'POST'],
  auth: 'viewer',
  async handle(req, res, ctx, { key, match, url }) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const page = requestedPage(url);
      if (req.method === 'GET') {
        const { dir } = resolveWhiteboard(ctx, match[1]!);
        sendSnapshot(req, res, snapshot(ctx, dir, page));
        return;
      }
      if (!ctx.sameOrigin(req)) throw new WhiteboardError(403, 'Forbidden');
      const body = await readWriteBody(req);
      const scene = isObject(body) && parseWhiteboardScene(body.scene);
      if (!scene || !isObject(body) || typeof body.revision !== 'string')
        throw new WhiteboardError(400, 'Whiteboard save needs a scene and its current revision');
      await refreshRequestStorageAdmission(req);
      if (!ctx.isAuthorized(req, key)) throw new WhiteboardError(403, 'Forbidden');
      const { dir } = resolveWhiteboard(ctx, match[1]!);
      const comments = commentState(ctx, dir);
      const pages = readWhiteboardPages(dir);
      const title = boardTitle(dir, page, scene);
      const { revision } = writeWhiteboardScene(
        dir,
        scene,
        body.revision,
        requestStorageAdmission(req),
        page,
      );
      sendSnapshot(req, res, { page, pages, scene, revision, title, ...comments });
    } catch (error) {
      fail(res, error);
    }
  },
};

export const whiteboardPagesRoute: HttpRoute<ServerContext> = {
  path: PAGES,
  methods: ['POST'],
  auth: 'same-origin',
  async handle(req, res, ctx, { key, match }) {
    try {
      const body = await readWriteBody(req, 4096);
      if (!isObject(body) || typeof body.title !== 'string' || !body.title.trim())
        throw new WhiteboardError(400, 'Whiteboard page needs a title');
      if (
        body.page !== undefined &&
        (!isWhiteboardPageId(body.page) || body.page === WHITEBOARD_DEFAULT_PAGE)
      )
        throw new WhiteboardError(400, 'Only additional whiteboard pages can be renamed');
      await refreshRequestStorageAdmission(req);
      if (!ctx.isAuthorized(req, key)) throw new WhiteboardError(403, 'Forbidden');
      const { dir, id } = resolveWhiteboard(ctx, match[1]!);
      const comments = commentState(ctx, dir);
      const { page, pages, scene, revision } = editWhiteboardPages(
        dir,
        body.title.trim(),
        body.page,
        requestStorageAdmission(req),
      );
      const files =
        body.page === undefined
          ? [WHITEBOARD_PAGES_FILE, whiteboardPageFile(page)]
          : [WHITEBOARD_PAGES_FILE];
      ctx.broadcast({ type: 'change', artifact: `whiteboard/${id}`, files });
      sendSnapshot(req, res, {
        page,
        pages,
        scene,
        revision,
        title: boardTitle(dir, page, scene),
        ...comments,
      });
    } catch (error) {
      fail(res, error);
    }
  },
};

export const whiteboardCommentRoute: HttpRoute<ServerContext> = {
  path: (pathname) => {
    const match = COMMENTS.exec(pathname);
    return match && !match[1] ? match : null;
  },
  methods: ['POST'],
  auth: 'same-origin',
  async handle(req, res, ctx, { key, match }) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const op = asWhiteboardHumanOp(await readCommentBody(req));
      if (!op) throw new WhiteboardError(400, 'Invalid whiteboard comment operation');
      await refreshRequestStorageAdmission(req);
      if (!ctx.isAuthorized(req, key)) throw new WhiteboardError(403, 'Forbidden');
      const { id, dir } = resolveWhiteboard(ctx, match[2]!);
      const store = whiteboardCommentsOf(ctx, dir);
      if (op.op === 'create') assertWhiteboardElements(dir, op);
      else {
        store.sync();
        if (!store.current().threads.some((thread) => thread.id === op.threadId))
          throw new WhiteboardError(404, 'Whiteboard comment thread not found');
      }
      const comments = store.apply(op, requestStorageAdmission(req));
      ctx.broadcast({ type: 'change', artifact: `whiteboard/${id}`, files: ['comments.json'] });
      sendJson(res, 200, comments);
    } catch (error) {
      fail(res, error);
    }
  },
};

export const whiteboardAgentCommentRoute: HttpRoute<ServerContext> = {
  path: (pathname) => {
    const match = COMMENTS.exec(pathname);
    return match?.[1] ? match : null;
  },
  methods: ['POST'],
  auth: 'agent',
  async handle(req, res, ctx, { key, match }) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const body = await readCommentBody(req);
      if (!isObject(body))
        throw new WhiteboardError(400, 'Invalid whiteboard agent comment operation');
      await refreshRequestStorageAdmission(req);
      if (!ctx.isAuthorized(req, key) || !ctx.agentOk(req, key))
        throw new WhiteboardError(403, 'Forbidden');
      const { id, dir } = resolveWhiteboard(ctx, match[2]!);
      const agent =
        typeof body.agent === 'string' && body.agent.trim() && body.agent.length <= 100
          ? body.agent
          : undefined;
      const store = whiteboardCommentsOf(ctx, dir);
      const admit = requestStorageAdmission(req);
      if (body.op === 'list') {
        sendJson(res, 200, {
          type: 'comments',
          artifact: `whiteboard/${id}`,
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
      const op = asWhiteboardAgentOp(body);
      if (!op) throw new WhiteboardError(400, 'Invalid whiteboard agent comment operation');
      if (op.op === 'add') assertWhiteboardElements(dir, op);
      else {
        store.sync();
        if (!store.current().threads.some((thread) => thread.id === op.threadId))
          throw new WhiteboardError(404, 'Whiteboard comment thread not found');
      }
      const { threadId, messageId } = store.applyAgent(op, agent, admit);
      ctx.broadcast({ type: 'change', artifact: `whiteboard/${id}`, files: ['comments.json'] });
      sendJson(res, 200, { threadId, ...(messageId ? { messageId } : {}) });
    } catch (error) {
      fail(res, error);
    }
  },
};
