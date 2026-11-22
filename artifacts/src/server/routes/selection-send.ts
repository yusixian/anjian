import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isArtifactId } from '../../shared/ids';
import {
  PREVIEW_SELECTION_SELECTOR,
  PREVIEW_SELECTION_TEXT,
  PREVIEW_SELECTION_TTL,
  type PreviewSelection,
  type SelectionRecipient,
} from '../../shared/selection-send';
import { resolveArtifactDir } from '../artifacts';
import type { ServerContext } from '../context';
import { readHtml } from '../html';
import { sendJson } from '../http';
import { writeJsonFiles } from '../storage/json-files';
import { requestStorageAdmission } from '../storage/request-admission';
import { readCommentBody } from './comments';
import type { HttpRoute } from './table';

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const HEARTBEAT_TTL = 10_000;
const DELIVERY_TTL = 5 * 60_000;
const RETAIN_EXPIRED = 60 * 60_000;

interface Recipient extends SelectionRecipient {
  session: string;
}

interface SelectionSend {
  artifact: string;
  expiresAt: number;
  host: Recipient['host'];
  id: string;
  selection: PreviewSelection;
  session: string;
  version: 1;
}

function readJson(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SelectionSend;
  } catch {
    return null;
  }
}

function filenames(dir: string) {
  try {
    return fs.readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return [];
  }
}

const recipientId = (host: Recipient['host'], session: string) =>
  createHash('sha256')
    .update(host + ':' + session)
    .digest('base64url');

function recipients(stateDir: string, artifact: string, now: number): Recipient[] {
  const results: Recipient[] = [];
  for (const host of ['claude', 'codex'] as const) {
    const dir = path.join(stateDir, `${host}-comment-watch`, 'opened', artifact);
    for (const file of filenames(dir)) {
      if (!file.endsWith('.alive')) continue;
      const session = file.slice(0, -'.alive'.length);
      if (!UUID.test(session)) continue;
      let stamp: number;
      try {
        stamp = Number(fs.readFileSync(path.join(dir, file), 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        continue;
      }
      if (!Number.isFinite(stamp) || stamp > now || now - stamp >= HEARTBEAT_TTL) continue;
      results.push({ host, session, id: recipientId(host, session), label: session.slice(-6) });
    }
  }
  return results;
}

function selectionOf(value: unknown): PreviewSelection | null {
  if (!value || typeof value !== 'object') return null;
  const { text, selector, revision, capturedAt } = value as Record<string, unknown>;
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > PREVIEW_SELECTION_TEXT ||
    typeof selector !== 'string' ||
    selector.length > PREVIEW_SELECTION_SELECTOR ||
    typeof revision !== 'number' ||
    !Number.isFinite(revision) ||
    typeof capturedAt !== 'number' ||
    !Number.isSafeInteger(capturedAt)
  )
    return null;
  return { text, selector, revision, capturedAt };
}

function status(dir: string, event: SelectionSend, now: number) {
  if (fs.existsSync(path.join(dir, `${event.id}.delivered`))) return 'delivered';
  return event.expiresAt <= now ? 'expired' : 'queued';
}

function prune(dir: string, now: number) {
  for (const name of filenames(dir)) {
    const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
    if (!UUID.test(id)) continue;
    const file = path.join(dir, name);
    const event = readJson(file);
    if (!event || event.expiresAt >= now - RETAIN_EXPIRED) continue;
    fs.rmSync(file, { force: true });
    fs.rmSync(path.join(dir, `${id}.delivered`), { force: true });
  }
}

export const selectionSendRoute: HttpRoute<ServerContext> = {
  auth: 'viewer',
  path: /^\/api\/html\/([^/]+)\/selection-send$/,
  methods: ['GET', 'POST'],
  async handle(req, res, ctx, { match, url }) {
    res.setHeader('Cache-Control', 'no-store');
    const id = match[1]!;
    const source = isArtifactId(id) && resolveArtifactDir(ctx.root, 'html', id);
    if (!ctx.loopback || !source) {
      sendJson(res, 404, { code: 'selection_unavailable' });
      return;
    }
    const artifact = `html/${id}`;
    const dir = path.join(ctx.stateDir, artifact, 'selection-sends');
    if (req.method === 'GET') {
      const request = url.searchParams.get('request');
      if (request !== null) {
        const event = UUID.test(request) ? readJson(path.join(dir, `${request}.json`)) : null;
        if (!event || event.artifact !== artifact || event.id !== request) {
          sendJson(res, 404, { code: 'selection_unavailable' });
          return;
        }
        sendJson(res, 200, { status: status(dir, event, Date.now()) });
        return;
      }
      sendJson(res, 200, {
        recipients: recipients(ctx.stateDir, artifact, Date.now()).map(({ host, id, label }) => ({
          host,
          id,
          label,
        })),
      });
      return;
    }
    if (!ctx.sameOrigin(req)) {
      sendJson(res, 403, { code: 'selection_unavailable' });
      return;
    }
    const body = (await readCommentBody(req)) as Record<string, unknown> | null;
    const request = body?.id;
    const recipient = body?.recipient;
    const selection = selectionOf(body?.selection);
    if (
      typeof request !== 'string' ||
      !UUID.test(request) ||
      typeof recipient !== 'string' ||
      !selection
    ) {
      sendJson(res, 400, { code: 'invalid_selection' });
      return;
    }
    const now = Date.now();
    const file = path.join(dir, `${request}.json`);
    const existing = readJson(file);
    if (existing) {
      if (
        recipientId(existing.host, existing.session) !== recipient ||
        JSON.stringify(existing.selection) !== JSON.stringify(selection)
      ) {
        sendJson(res, 409, { code: 'selection_conflict' });
        return;
      }
      sendJson(res, 200, { status: status(dir, existing, now) });
      return;
    }
    const current = readHtml(source, id);
    if (
      selection.capturedAt > now ||
      now - selection.capturedAt >= PREVIEW_SELECTION_TTL ||
      current.warnings.length > 0 ||
      current.version !== selection.revision
    ) {
      sendJson(res, 409, { code: 'selection_expired' });
      return;
    }
    const target = recipients(ctx.stateDir, artifact, now).find(({ id }) => id === recipient);
    if (!target) {
      sendJson(res, 409, { code: 'recipient_unavailable' });
      return;
    }
    prune(dir, now);
    const event: SelectionSend = {
      version: 1,
      id: request,
      artifact,
      host: target.host,
      session: target.session,
      expiresAt: now + DELIVERY_TTL,
      selection,
    };
    writeJsonFiles(ctx.stateDir, [{ file, value: event }], requestStorageAdmission(req));
    sendJson(res, 202, { status: 'queued' });
  },
};
