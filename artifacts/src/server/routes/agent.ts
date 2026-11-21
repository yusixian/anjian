import fs from 'node:fs';
import type http from 'node:http';
import { requestStorageAdmission } from '../storage/request-admission';
import { RemoteTransferError } from '../remote-transfer';
import path from 'node:path';

import { artifactKeyOf, artifactSignature, resolveArtifactDir } from '../artifacts';
import { agentAddOnBoard, asBoardAgentOp, boardFiles, boardSpecs } from '../board-comments';
import type { ServerContext } from '../context';
import { parseDocument } from '../document-codec';
import { asAgentOp, isId } from '../document-comments';
import { artifactStateWarnings } from '../state';
import { sendJson } from '../http';
import { remoteCommentCursor } from '../remote-identity';
import { readCommentBody } from './comments';
import type { HttpRoute } from './table';

const API_AGENT_COMMENTS_ROUTE = /^\/api\/agent\/document\/([^/]+)\/comments$/;
const API_AGENT_BOARD_COMMENTS_ROUTE = /^\/api\/agent\/artboard\/([^/]+)\/comments$/;
const API_AGENT_CHECK_ROUTE = /^\/api\/agent\/([^/]+)\/([^/]+)\/check$/;
const CHECK_WATCH_WAIT_MS = 2_000;
const CHECK_MERGE_WAIT_MS = 60_000;
const COMMENT_SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RECEIPT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function receiptInput(req: http.IncomingMessage, fields: Record<string, unknown>) {
  if (fields.op !== 'receipt-list' && fields.op !== 'confirm-read') return null;
  if (typeof fields.session !== 'string' || !COMMENT_SESSION.test(fields.session))
    throw new RemoteTransferError(400, 'invalid_comment_session', 'A valid comment session is required');
  const reader = { scope: remoteCommentCursor(req, 'local'), session: fields.session };
  if (fields.op === 'receipt-list') return { reader, tokens: null };
  const tokens = fields.receipts;
  if (!Array.isArray(tokens) || !tokens.every((token) => typeof token === 'string' && RECEIPT_TOKEN.test(token)))
    throw new RemoteTransferError(400, 'invalid_comment_receipts', 'Expected comment receipt tokens');
  return { reader, tokens: tokens as string[], initialize: fields.initialize === true };
}

const agentName = (fields: Record<string, unknown>) =>
  typeof fields.agent === 'string' && fields.agent.length > 0 && fields.agent.length <= 100
    ? fields.agent
    : undefined;

const blockIdsOf = async (ctx: ServerContext, id: string, dir: string) => {
  await (await ctx.documents.open(id))?.flush();
  const state = parseDocument(fs.readFileSync(path.join(dir, 'doc.xml'), 'utf8'));
  return new Set(
    (state.root.children as { $?: { blockId?: string } }[]).flatMap((block) =>
      block.$?.blockId ? [block.$.blockId] : [],
    ),
  );
};

async function serveAgentComments(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
  id: string,
) {
  const { root, documents } = ctx;
  const dir = resolveArtifactDir(root, 'document', id);
  if (!dir) {
    sendJson(res, 404, { error: `document/${id} not found` });
    return;
  }
  const body = await readCommentBody(req);
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const agent = agentName(fields);
  const receipt = receiptInput(req, fields);
  if (receipt) {
    const admit = requestStorageAdmission(req);
    sendJson(res, 200, receipt.tokens
      ? { confirmed: documents.confirmCommentReads(id, receipt.reader, receipt.tokens, admit, receipt.initialize) }
      : documents.receiptSnapshot(id, receipt.reader, fields.all === true, admit));
    return;
  }
  if (fields.op === 'list') {
    sendJson(res, 200, {
      type: 'comments',
      artifact: `document/${id}`,
      threads: documents.listComments(id, remoteCommentCursor(req, agent ?? 'Agent'), fields.all === true, requestStorageAdmission(req)),
    });
    return;
  }
  const op = asAgentOp(body);
  if (!op) {
    sendJson(res, 400, {
      error:
        'not an agent comment op: use list, add {blockId, text}, reply {threadId, text} or resolve {threadId}; text must not be empty',
    });
    return;
  }
  if (op.op === 'add') {
    let blocks: Set<string>;
    try {
      blocks = await blockIdsOf(ctx, id, dir);
    } catch (err) {
      sendJson(res, 400, { error: `doc.xml could not be read: ${(err as Error).message}` });
      return;
    }
    const missing = (op.blockIds ?? [op.blockId]).find((blockId) => !blocks.has(blockId));
    if (missing) {
      sendJson(res, 400, { error: `no block ${missing} in document/${id}` });
      return;
    }
  }
  try {
    sendJson(res, 200, documents.applyAgentCommentOp(id, op, agent, requestStorageAdmission(req)));
  } catch (err) {
    sendJson(res, err instanceof RemoteTransferError ? err.status : 400, {
      ...(err instanceof RemoteTransferError ? { code: err.code } : {}), error: (err as Error).message,
    });
  }
}

async function serveAgentBoardComments(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
  id: string,
) {
  const { root, boardComments } = ctx;
  const dir = resolveArtifactDir(root, 'artboard', id);
  if (!dir) {
    sendJson(res, 404, { error: `artboard/${id} not found` });
    return;
  }
  const body = await readCommentBody(req);
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const agent = agentName(fields);
  const receipt = receiptInput(req, fields);
  if (receipt) {
    const admit = requestStorageAdmission(req);
    sendJson(res, 200, receipt.tokens
      ? { confirmed: boardComments.confirmCommentReads(id, receipt.reader, receipt.tokens, admit, receipt.initialize) }
      : {
          ...boardComments.receiptSnapshot(id, receipt.reader, fields.all === true, admit),
          groups: boardComments.groups(id),
          rounds: boardComments.rounds(id),
        });
    return;
  }
  if (fields.op === 'list') {
    const threads = boardComments.list(id, remoteCommentCursor(req, agent ?? 'Agent'), fields.all === true, requestStorageAdmission(req));
    sendJson(res, 200, {
      type: 'comments',
      artifact: `artboard/${id}`,
      threads,
      groups: boardComments.groups(id),
      rounds: boardComments.rounds(id),
    });
    return;
  }
  if (fields.op === 'choose' || fields.op === 'submit') {
    try {
      if (fields.op === 'choose') {
        if (!isId(fields.group) || (fields.board !== null && !isId(fields.board)))
          throw new Error('choose needs {group, board} with board a board id or null');
        sendJson(res, 200, boardComments.agentChoose(id, fields.group, fields.board, agent, requestStorageAdmission(req)));
      } else {
        if (!isId(fields.round) || typeof fields.submit !== 'boolean')
          throw new Error('submit needs {round, submit: true | false}');
        sendJson(res, 200, boardComments.agentSubmit(id, fields.round, fields.submit, agent, requestStorageAdmission(req)));
      }
    } catch (err) {
      sendJson(res, err instanceof RemoteTransferError ? err.status : 400, {
        ...(err instanceof RemoteTransferError ? { code: err.code } : {}), error: (err as Error).message,
      });
    }
    return;
  }
  const shorthand = agentAddOnBoard(body, boardSpecs(dir));
  if (shorthand && 'error' in shorthand) {
    sendJson(res, 400, { error: `${shorthand.error} in artboard/${id}` });
    return;
  }
  const op = shorthand ?? asBoardAgentOp(body);
  if (!op) {
    sendJson(res, 400, {
      error:
        'not an agent comment op: use list, add {anchor: {page, board, x, y}, text}, reply {threadId, text} or resolve {threadId}; text must not be empty',
    });
    return;
  }
  if (op.op === 'add' && op.anchor.board && !(op.anchor.board in boardFiles(dir))) {
    sendJson(res, 400, { error: `no board ${op.anchor.board} in artboard/${id}` });
    return;
  }
  try {
    sendJson(res, 200, boardComments.applyAgent(id, op, agent, requestStorageAdmission(req)));
  } catch (err) {
    sendJson(res, err instanceof RemoteTransferError ? err.status : 400, {
      ...(err instanceof RemoteTransferError ? { code: err.code } : {}), error: (err as Error).message,
    });
  }
}

// The watcher debounces and its backup poll can lag a second, and a document's warnings arrive only after its merge plays out.
async function serveAgentCheck(
  res: http.ServerResponse,
  ctx: ServerContext,
  type: string,
  id: string,
) {
  const { root, documents, signatures } = ctx;
  const ref = artifactKeyOf(`${type}/${id}`);
  const dir = ref && resolveArtifactDir(root, ref.type, ref.id);
  if (!ref || !dir) {
    sendJson(res, 404, { error: `${type}/${id} not found in ${root}` });
    return;
  }
  const key = `${ref.type}/${ref.id}`;
  for (
    let waited = 0;
    waited < CHECK_WATCH_WAIT_MS && signatures.get(key) !== artifactSignature(dir, ref.type);
    waited += 50
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  let merging = false;
  if (ref.type === 'document') {
    const session = await documents.open(ref.id);
    const text = await fs.promises.readFile(path.join(dir, 'doc.xml'), 'utf8').catch(() => null);
    if (session && text !== null) {
      session.onFileText(text);
      const timeout = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), CHECK_MERGE_WAIT_MS).unref(),
      );
      merging = (await Promise.race([session.settled(), timeout])) === 'timeout';
    }
  }
  ctx.writeState(ref, dir);
  const current = ctx.stateSnapshot(ref, dir);
  const state = artifactStateWarnings(current.payload, current.extra);
  sendJson(res, 200, merging ? { ...state, merging: true } : state);
}

export const agentCommentsRoute: HttpRoute<ServerContext> = {
  path: API_AGENT_COMMENTS_ROUTE,
  methods: ['POST'],
  auth: 'agent',
  handle: (req, res, ctx, { match }) => serveAgentComments(req, res, ctx, match[1]!),
};

export const agentBoardCommentsRoute: HttpRoute<ServerContext> = {
  path: API_AGENT_BOARD_COMMENTS_ROUTE,
  methods: ['POST'],
  auth: 'agent',
  handle: (req, res, ctx, { match }) => serveAgentBoardComments(req, res, ctx, match[1]!),
};

export const agentCheckRoute: HttpRoute<ServerContext> = {
  path: API_AGENT_CHECK_ROUTE,
  methods: ['POST'],
  auth: 'agent',
  handle: (_req, res, ctx, { match }) => serveAgentCheck(res, ctx, match[1]!, match[2]!),
};
