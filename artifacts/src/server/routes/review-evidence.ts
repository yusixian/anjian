import { ARTIFACT_LOCATOR_SOURCE } from '../../shared/ids';
import { resolveArtifactAddress } from '../artifact-address';
import type { ServerContext } from '../context';
import { documentChanges } from '../document-changes';
import { sendJson } from '../http';
import { RemoteTransferError } from '../remote-transfer';
import { reviewSummary } from '../review-summary';
import { readCommentBody } from './comments';
import type { HttpRoute } from './table';

function changesQuery(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { versions, from, to } = value as Record<string, unknown>;
  if (
    (versions !== undefined && typeof versions !== 'boolean') ||
    (from !== undefined && (typeof from !== 'string' || !from)) ||
    (to !== undefined && (typeof to !== 'string' || !to)) ||
    (versions ? from !== undefined || to !== undefined : from === undefined)
  )
    return null;
  return { versions, from, to };
}

export const reviewEvidenceRoute: HttpRoute<ServerContext> = {
  path: new RegExp(
    `^/api/agent/(document|artboard)/(${ARTIFACT_LOCATOR_SOURCE})/(changes|review)$`,
  ),
  methods: ['POST'],
  auth: 'agent',
  async handle(req, res, ctx, { match }) {
    const type = match[1] === 'document' ? 'document' : 'artboard';
    const id = match[2]!;
    const action = match[3];
    const artifact = `${type}/${id}`;
    const target = resolveArtifactAddress(ctx.root, type, id, { mintMissing: false });
    if (!target) {
      sendJson(res, 404, { error: `${artifact} not found` });
      return;
    }
    try {
      if (action === 'review') {
        sendJson(res, 200, {
          ...reviewSummary(target.dir, type, target.id, ctx.recordings.evidenceHash),
          artifact,
        });
        return;
      }
      if (type !== 'document') {
        sendJson(res, 400, { error: 'Change history is available for documents.' });
        return;
      }
      const query = changesQuery(await readCommentBody(req));
      if (!query) {
        sendJson(res, 400, {
          error: 'Specify versions, or a starting version and an optional ending version.',
        });
        return;
      }
      const snapshot = await ctx.documents.historySnapshot(target.id);
      if (!snapshot) {
        throw new RemoteTransferError(
          409,
          'unavailable_document_history',
          'Document has no retained history.',
        );
      }
      sendJson(res, 200, {
        type: 'document-changes',
        artifact,
        ...(await documentChanges(snapshot, query)),
      });
    } catch (error) {
      if (!(error instanceof RemoteTransferError)) throw error;
      sendJson(res, error.status, { code: error.code, error: error.message });
    }
  },
};
