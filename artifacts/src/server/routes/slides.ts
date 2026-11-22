import type http from 'node:http';

import {
  MAX_SLIDE_DECK_BYTES,
  parseSlideDeck,
  SLIDE_DECK_FILE,
  type SlideDeckSnapshot,
} from '../../shared/slides';
import { resolveArtifactAddress } from '../artifact-address';
import { isArtifactLocator } from '../artifacts';
import type { ServerContext } from '../context';
import { sendJson } from '../http';
import { readSlideDeck, SlideDeckError, writeSlideDeck } from '../slides';
import {
  refreshRequestStorageAdmission,
  requestStorageAdmission,
} from '../storage/request-admission';
import { slideCommentState } from './slides-comments';
import type { HttpRoute } from './table';

async function readSlideWrite(req: http.IncomingMessage) {
  const limit = MAX_SLIDE_DECK_BYTES + 256;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) {
      req.resume();
      throw new SlideDeckError(413, 'Slide deck is too large');
    }
    chunks.push(bytes);
  }
  try {
    const raw: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (
      raw &&
      typeof raw === 'object' &&
      'deck' in raw &&
      'revision' in raw &&
      typeof raw.revision === 'string' &&
      /^(?:empty|[a-f0-9]{64})$/.test(raw.revision)
    ) {
      const deck = parseSlideDeck(raw.deck);
      if (deck) return { deck, revision: raw.revision };
    }
  } catch {
    // Report malformed JSON and invalid deck fields with the same request error.
  }
  throw new SlideDeckError(400, 'Slide save needs a valid deck and its current revision');
}

export const slideDeckRoute: HttpRoute<ServerContext> = {
  path: /^\/api\/slides\/([^/]+)$/,
  methods: ['GET', 'POST'],
  auth: 'viewer',
  async handle(req, res, ctx, { key, match }) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const id = match[1];
      if (!isArtifactLocator(id ?? '')) throw new SlideDeckError(404, 'Slide deck not found');
      let body: Awaited<ReturnType<typeof readSlideWrite>> | undefined;
      if (req.method === 'POST') {
        if (!ctx.sameOrigin(req)) throw new SlideDeckError(403, 'Forbidden');
        body = await readSlideWrite(req);
        await refreshRequestStorageAdmission(req);
        if (!ctx.isAuthorized(req, key)) throw new SlideDeckError(403, 'Forbidden');
      }
      const artifact = resolveArtifactAddress(ctx.root, 'slides', id!);
      if (!artifact) throw new SlideDeckError(404, 'Slide deck not found');
      const { dir } = artifact;
      let commentState: Pick<SlideDeckSnapshot, 'comments' | 'listening' | 'commentsWarning'>;
      try {
        commentState = slideCommentState(ctx, dir);
      } catch (error) {
        if (!(error instanceof SlideDeckError)) throw error;
        commentState = {
          comments: { threads: [], version: 1 },
          commentsWarning: error.message,
          listening: false,
        };
      }
      const { deck, revision } = body
        ? writeSlideDeck(dir, body.deck, body.revision, requestStorageAdmission(req))
        : readSlideDeck(dir);
      if (body)
        ctx.broadcast({
          type: 'change',
          artifact: `slides/${artifact.id}`,
          files: [SLIDE_DECK_FILE],
        });
      const result: SlideDeckSnapshot = { deck, revision, ...commentState };
      sendJson(res, 200, result);
    } catch (error) {
      if (!(error instanceof SlideDeckError)) throw error;
      sendJson(res, error.status, { error: error.message });
    }
  },
};
