import type http from 'node:http';

import { DOCUMENT_FEATURES_HEADER } from '../../shared/document-features';
import { resolveArtifactDir } from '../artifacts';
import type { ServerContext } from '../context';
import { asHumanOp } from '../document-comments';
import { DocumentPersistenceError, OutdatedClient } from '../document-session';
import { send, sendJson } from '../http';
import { MAX_DOCUMENT_UPDATE } from '../limits';
import { readCommentBody } from './comments';
import { RemoteTransferError } from '../remote-transfer';
import { refreshRequestStorageAdmission, requestStorageAdmission } from '../storage/request-admission';
import type { HttpRoute } from './table';

const API_DOCUMENT_STATE_ROUTE = /^\/api\/document\/([^/]+)\/state$/;
const API_DOCUMENT_WRITE_ROUTE = /^\/api\/document\/([^/]+)\/(update|comments)$/;

async function serveDocumentState(res: http.ServerResponse, ctx: ServerContext, id: string) {
  const session = resolveArtifactDir(ctx.root, 'document', id)
    ? await ctx.documents.open(id)
    : null;
  if (!session) {
    sendJson(res, 404, { error: `document/${id} has no doc.xml` });
    return;
  }
  sendJson(res, 200, ctx.documentState(id, session));
}

async function serveDocumentComments(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
  id: string,
) {
  if (!resolveArtifactDir(ctx.root, 'document', id)) {
    sendJson(res, 404, { error: `document/${id} not found` });
    return;
  }
  const op = asHumanOp(await readCommentBody(req));
  if (!op) {
    sendJson(res, 400, { error: 'not a comment op' });
    return;
  }
  sendJson(res, 200, { comments: ctx.documents.applyCommentOp(id, op, requestStorageAdmission(req)) });
}

async function serveDocumentUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
  id: string,
) {
  const session = resolveArtifactDir(ctx.root, 'document', id)
    ? await ctx.documents.open(id)
    : null;
  if (!session) {
    sendJson(res, 404, { error: `document/${id} has no doc.xml` });
    return;
  }
  if (Number(req.headers['content-length'] ?? 0) > MAX_DOCUMENT_UPDATE) {
    req.resume();
    send(res, 413, 'Update too large');
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= MAX_DOCUMENT_UPDATE) chunks.push(chunk as Buffer);
  }
  if (size > MAX_DOCUMENT_UPDATE) {
    send(res, 413, 'Update too large');
    return;
  }
  const header = req.headers[DOCUMENT_FEATURES_HEADER];
  const features =
    typeof header === 'string' ? header.split(',').map((feature) => feature.trim()) : [];
  const sourceRejected = () => session.outcome().kind === 'rejected';
  if (sourceRejected()) {
    sendJson(res, 409, { error: 'Document source is invalid. Repair it before saving edits.' });
    return;
  }
  try {
    await session.readyForRemoteUpload(requestStorageAdmission(req));
    await refreshRequestStorageAdmission(req);
  } catch (error) {
    if (error instanceof RemoteTransferError)
      sendJson(res, error.status, { code: error.code, error: error.message });
    else sendJson(res, 503, { error: 'Document could not be saved. Please retry.' });
    return;
  }
  if (sourceRejected()) {
    sendJson(res, 409, { error: 'Document source changed to invalid content. Repair it and retry.' });
    return;
  }
  try {
    session.saveUpdate(new Uint8Array(Buffer.concat(chunks)), features, requestStorageAdmission(req));
  } catch (err) {
    sendJson(res, err instanceof RemoteTransferError ? err.status : err instanceof OutdatedClient ? 409 : err instanceof DocumentPersistenceError ? 503 : 400, { error: (err as Error).message, ...(err instanceof RemoteTransferError ? { code: err.code } : {}) });
    return;
  }
  try {
    await session.flush(requestStorageAdmission(req));
    if (sourceRejected()) {
      sendJson(res, 409, { error: 'Document source changed to invalid content. Repair it and retry.' });
      return;
    }
    send(res, 204, '');
  } catch {
    sendJson(res, 503, { error: 'Document could not be saved. Please retry.' });
  }
}

export const documentStateRoute: HttpRoute<ServerContext> = {
  path: API_DOCUMENT_STATE_ROUTE,
  auth: 'viewer',
  handle: (_req, res, ctx, { match }) => serveDocumentState(res, ctx, match[1]!),
};

export const documentWriteRoute: HttpRoute<ServerContext> = {
  path: API_DOCUMENT_WRITE_ROUTE,
  methods: ['POST'],
  auth: 'same-origin',
  handle: (req, res, ctx, { match }) =>
    match[2] === 'comments'
      ? serveDocumentComments(req, res, ctx, match[1]!)
      : serveDocumentUpdate(req, res, ctx, match[1]!),
};
