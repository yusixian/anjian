import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

import { isObject } from '../../shared/comments';
import { ARTIFACT_LOCATOR_SOURCE } from '../../shared/ids';
import {
  MAX_STORYBOARD_ASSET_BYTES,
  MAX_STORYBOARD_TIMELINE_BYTES,
  parseStoryboard,
  STORYBOARD_FILE,
  type StoryboardSnapshot,
} from '../../shared/storyboard';
import { isNarrationLocale, MAX_NARRATION_TEXT } from '../../shared/storyboard-narration';
import { resolveArtifactAddress } from '../artifact-address';
import type { ServerContext } from '../context';
import { mimeOf, send, sendFile, sendJson } from '../http';
import {
  refreshRequestStorageAdmission,
  requestStorageAdmission,
} from '../storage/request-admission';
import { storyboardJobsOf } from '../storyboard-jobs';
import { narrationAvailable, synthesizeNarration } from '../storyboard-narration';
import {
  listStoryboardAssets,
  openStoryboardAsset,
  readStoryboard,
  StoryboardError,
  uploadStoryboardAsset,
  writeStoryboard,
} from '../storyboard-source';
import { storyboardCommentState } from './storyboard-comments';
import type { HttpRoute } from './table';

const PATH = `/api/storyboard/(${ARTIFACT_LOCATOR_SOURCE})`;
const RENDER = `${PATH}/render`;
const JOB = `${RENDER}/([a-f0-9]{64})`;
const REVISION = /^(?:empty|[a-f0-9]{64})$/;
const mediaHeaders = {
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
};
const audioTypes: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function artifactOf(ctx: ServerContext, locator: string) {
  const directory = path.join(ctx.root, 'storyboard');
  if (!fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory())
    throw new StoryboardError(404, 'Storyboard not found');
  const artifact = resolveArtifactAddress(ctx.root, 'storyboard', locator);
  if (artifact) {
    try {
      if (
        fs.realpathSync(artifact.dir) ===
        path.join(fs.realpathSync(ctx.root), 'storyboard', artifact.id)
      )
        return artifact;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new StoryboardError(404, 'Storyboard not found');
}

async function readBytes(req: http.IncomingMessage, limit: number) {
  function tooLarge(): never {
    req.resume();
    throw new StoryboardError(413, 'Storyboard request is too large');
  }
  if (Number(req.headers['content-length']) > limit) tooLarge();
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) tooLarge();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

async function readJson(req: http.IncomingMessage, limit: number): Promise<unknown> {
  const bytes = await readBytes(req, limit);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new StoryboardError(400, 'Invalid storyboard request');
  }
}

function requireOrigin(req: http.IncomingMessage, ctx: ServerContext) {
  if (!ctx.sameOrigin(req)) throw new StoryboardError(403, 'Forbidden');
}

function requireAuthorization(req: http.IncomingMessage, ctx: ServerContext, key: string | null) {
  if (!ctx.isAuthorized(req, key)) throw new StoryboardError(403, 'Forbidden');
}

function errorResponse(res: http.ServerResponse, error: unknown) {
  if (!(error instanceof StoryboardError)) throw error;
  sendJson(res, error.status, { error: error.message });
}

export const storyboardRoute: HttpRoute<ServerContext> = {
  path: new RegExp(`^${PATH}$`),
  methods: ['GET', 'POST'],
  auth: 'viewer',
  async handle(req, res, ctx, { key, match }) {
    try {
      const { dir, id } = artifactOf(ctx, match[1]!);
      let timeline: ReturnType<typeof readStoryboard>;
      let assets: StoryboardSnapshot['assets'];
      if (req.method === 'POST') {
        requireOrigin(req, ctx);
        const body = await readJson(req, MAX_STORYBOARD_TIMELINE_BYTES + 256);
        if (!isObject(body) || typeof body.revision !== 'string' || !REVISION.test(body.revision))
          throw new StoryboardError(400, 'Storyboard save needs its current revision');
        const storyboard = parseStoryboard(body.storyboard);
        if (!storyboard) throw new StoryboardError(400, 'Storyboard save needs a valid timeline');
        await refreshRequestStorageAdmission(req);
        requireAuthorization(req, ctx, key);
        const saved = writeStoryboard(dir, storyboard, body.revision, requestStorageAdmission(req));
        timeline = saved;
        assets = saved.assets;
        ctx.broadcast({ type: 'change', artifact: `storyboard/${id}`, files: [STORYBOARD_FILE] });
      } else {
        timeline = readStoryboard(dir);
        assets = listStoryboardAssets(dir);
      }
      let comments: Pick<StoryboardSnapshot, 'comments' | 'commentsWarning' | 'listening'>;
      try {
        comments = storyboardCommentState(ctx, dir);
      } catch (error) {
        if (!(error instanceof StoryboardError)) throw error;
        comments = {
          comments: { threads: [], version: 1 },
          commentsWarning: error.message,
          listening: false,
        };
      }
      const snapshot: StoryboardSnapshot = {
        storyboard: timeline.storyboard,
        revision: timeline.revision,
        ...(narrationAvailable(ctx.loopback) && { narrationAvailable: true }),
        assets,
        ...comments,
      };
      sendJson(res, 200, snapshot);
    } catch (error) {
      errorResponse(res, error);
    }
  },
};

export const storyboardAssetsRoute: HttpRoute<ServerContext> = {
  path: new RegExp(`^${PATH}/assets$`),
  methods: ['GET', 'POST'],
  auth: 'viewer',
  async handle(req, res, ctx, { key, match, url }) {
    try {
      const { dir, id } = artifactOf(ctx, match[1]!);
      const name = url.searchParams.get('name') ?? '';
      if (req.method === 'GET') {
        const { asset, fd, file } = openStoryboardAsset(dir, name);
        sendFile(
          res,
          file,
          {
            ...mediaHeaders,
            'Content-Type': audioTypes[path.extname(file)] ?? mimeOf(file),
          },
          req.headers.range,
          { fd, size: asset.bytes },
        );
        return;
      }
      requireOrigin(req, ctx);
      if (!name || name.length > 255)
        throw new StoryboardError(400, 'Storyboard media needs a file name');
      const data = await readBytes(req, MAX_STORYBOARD_ASSET_BYTES);
      await refreshRequestStorageAdmission(req);
      requireAuthorization(req, ctx, key);
      const asset = uploadStoryboardAsset(dir, name, data, requestStorageAdmission(req));
      ctx.broadcast({ type: 'change', artifact: `storyboard/${id}`, files: [asset.path] });
      sendJson(res, 201, { asset });
    } catch (error) {
      errorResponse(res, error);
    }
  },
};

export const storyboardNarrationRoute: HttpRoute<ServerContext> = {
  path: new RegExp(`^${PATH}/narration$`),
  methods: ['POST'],
  auth: 'viewer',
  async handle(req, res, ctx, { key, match }) {
    try {
      requireOrigin(req, ctx);
      requireAuthorization(req, ctx, key);
      if (!narrationAvailable(ctx.loopback))
        throw new StoryboardError(404, 'Local system narration is unavailable.');
      artifactOf(ctx, match[1]!);
      const body = await readJson(req, MAX_NARRATION_TEXT * 8 + 128);
      if (
        !isObject(body) ||
        !isNarrationLocale(body.locale) ||
        typeof body.text !== 'string' ||
        !body.text.trim() ||
        body.text.length > MAX_NARRATION_TEXT ||
        Array.from(body.text).some((char) => char.charCodeAt(0) < 32 && !'\n\r\t'.includes(char))
      )
        throw new StoryboardError(400, 'Use a non-empty narration line within the length limit.');
      const audio = await synthesizeNarration(body.text.trim(), body.locale);
      if (res.destroyed) return;
      send(res, 200, audio, { ...mediaHeaders, 'Content-Type': 'audio/wav' });
    } catch (error) {
      errorResponse(res, error);
    }
  },
};

export const storyboardRenderRoute: HttpRoute<ServerContext> = {
  path: new RegExp(`^${RENDER}$`),
  methods: ['POST'],
  auth: 'same-origin',
  async handle(req, res, ctx, { key, match }) {
    try {
      const body = await readJson(req, 256);
      if (!isObject(body) || typeof body.revision !== 'string' || !REVISION.test(body.revision))
        throw new StoryboardError(400, 'Storyboard render needs its current revision');
      requireAuthorization(req, ctx, key);
      const artifact = artifactOf(ctx, match[1]!);
      const job = await storyboardJobsOf(ctx).start(artifact, body.revision);
      sendJson(res, job.status === 'ready' ? 200 : 202, job);
    } catch (error) {
      errorResponse(res, error);
    }
  },
};

export const storyboardJobRoute: HttpRoute<ServerContext> = {
  path: new RegExp(`^${JOB}$`),
  methods: ['GET'],
  auth: 'viewer',
  handle(_req, res, ctx, { match }) {
    try {
      const job = storyboardJobsOf(ctx).status(artifactOf(ctx, match[1]!), match[2]!);
      if (!job) throw new StoryboardError(404, 'Storyboard render not found');
      sendJson(res, 200, job);
    } catch (error) {
      errorResponse(res, error);
    }
  },
};

export const storyboardVideoRoute: HttpRoute<ServerContext> = {
  path: new RegExp(`^${JOB}/video$`),
  methods: ['GET'],
  auth: 'viewer',
  handle(req, res, ctx, { match, url }) {
    try {
      const artifact = artifactOf(ctx, match[1]!);
      const video = storyboardJobsOf(ctx).video(artifact, match[2]!);
      if (!video) throw new StoryboardError(404, 'Storyboard video not found');
      sendFile(
        res,
        video.file,
        {
          ...mediaHeaders,
          ...(url.searchParams.get('download') === '1'
            ? { 'Content-Disposition': `attachment; filename="${artifact.id}.mp4"` }
            : {}),
        },
        req.headers.range,
        { fd: video.fd, size: video.stat.size },
      );
    } catch (error) {
      errorResponse(res, error);
    }
  },
};
