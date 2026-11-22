import type http from 'node:http';

import { ArtifactTrashError, assertArtifactNotTrashed } from '../artifact-trash';
import { sendJson } from '../http';
import { withProjectMutation } from '../project-mutations';
import {
  readRemoteArtifact,
  readRemoteArtifactAddress,
  RemoteTransferError,
} from '../remote-transfer';
import { localQuestionProof } from './local-question-recipients';
import { feedbackError, feedbackStore } from './store';

const PATH =
  /^\/api\/local\/projects\/([a-f0-9]{32})\/document\/([a-z0-9][a-z0-9-]*)\/questions\/([\w-]{43})(?:\/([a-f0-9-]{36}))?$/;
const OFFER_MS = 20_000;

interface Options {
  home: string;
  projects: () => { id: string; dir: string }[];
  upload: <T>(
    project: string,
    work: (prepare: () => Promise<(delta: number) => void>) => Promise<T>,
  ) => Promise<T>;
}

export function createLocalQuestionDelivery(options: Options) {
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const match = PATH.exec(url.pathname);
    if (!match) return false;
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'POST') return (sendJson(res, 405, { code: 'method_not_allowed' }), true);
      const [, projectId, slug, recipient, deliveryId] = match;
      const artifact = `document/${slug}`;
      const project = options.projects().find(({ id }) => id === projectId);
      const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!project || !token || req.headers.origin !== undefined || req.headers['sec-fetch-site'])
        return (sendJson(res, 404, { code: 'not_found' }), true);
      const proof = () => {
        if (!options.projects().some(({ id, dir }) => id === project.id && dir === project.dir))
          return feedbackError('not_found', undefined, 404);
        return (
          localQuestionProof(project.dir, artifact, recipient!, token) ??
          feedbackError('not_found', undefined, 404)
        );
      };
      proof();
      const store = feedbackStore(options.home, project.id);
      if (
        !deliveryId &&
        !store
          .load()
          .localQuestions?.some(
            (row) =>
              row.artifact === artifact && row.recipient === recipient && row.state === 'queued',
          )
      ) {
        sendJson(res, 200, { delivery: null });
        return true;
      }
      const result = await options.upload(project.dir, (prepare) =>
        withProjectMutation(project.dir, async () => {
          const credential = proof();
          assertArtifactNotTrashed(project.dir, 'document', slug!);
          const data = store.load();
          const address = readRemoteArtifactAddress(project.dir, artifact);
          const rows = (data.localQuestions ?? []).filter(
            (row) =>
              row.recipient === recipient &&
              row.artifact === artifact &&
              row.artifactAddress === address,
          );
          if (deliveryId) {
            const row = rows.find(({ id }) => id === deliveryId);
            if (!row || row.offer?.proof !== credential || row.state === 'cancelled')
              return feedbackError('delivery_changed');
            if (row.state !== 'delivered') {
              const admit = await prepare();
              proof();
              if (readRemoteArtifactAddress(project.dir, artifact) !== address)
                return feedbackError('artifact_identity_changed');
              row.state = 'delivered';
              store.save(data, admit);
            }
            return {};
          }
          const now = Date.now();
          const row = rows.find(
            (row) =>
              row.state === 'queued' &&
              ((row.offer?.until ?? 0) <= now || row.offer?.proof === credential),
          );
          if (!row) return { delivery: null };
          const admit = await prepare();
          proof();
          if (readRemoteArtifactAddress(project.dir, artifact) !== address)
            return feedbackError('artifact_identity_changed');
          if (readRemoteArtifact(project.dir, artifact).revision !== row.revision) {
            row.state = 'cancelled';
            store.save(data, admit);
            return { delivery: null };
          }
          row.offer = { until: Date.now() + OFFER_MS, proof: credential };
          store.save(data, admit);
          return { delivery: { id: row.id, artifact, revision: row.revision, ...row.input } };
        }),
      );
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof RemoteTransferError || error instanceof ArtifactTrashError)
        sendJson(res, error.status, { code: error.code });
      else sendJson(res, 500, { code: 'feedback_failed' });
    }
    return true;
  };
}
