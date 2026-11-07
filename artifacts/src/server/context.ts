import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';

import type { CanvasPayload, DocumentPayload, HtmlPayload, ServerMessage } from '../shared/types';
import { accessPolicy, isLoopbackHost } from './access';
import {
  type ArtifactRef,
  artifactSignature,
  resolveArtifactDir,
} from './artifacts';
import { createAvatars } from './avatars';
import { type asBoardHumanOp, createBoardCommentRegistry } from './board-comments';
import { originsFor } from './board-port';
import { commentNames } from './comment-names';
import { ensureConfig } from './config';
import { readDocument } from './document';
import { createDocumentRegistry, type DocumentTiming } from './documents';
import { createDynamicBlocks } from './dynamic-blocks';
import { readHtml } from './html';
import { parseCookies, randomToken, readPersisted, safeEqual } from './http';
import { MAX_RUNTIME_WARNINGS } from './limits';
import { createSelectionStore } from './selection';
import { readCanvas, writeArtifactState } from './state';
import { createVerifyRecordings } from './verify-recordings';
import { textFrame } from './ws';

export interface ServerOptions {
  configFile?: string;
  debounceMs?: number;
  documentTiming?: DocumentTiming;
  fetch?: typeof fetch;
  host: string;
  mount?: MountSettings;
  publicOrigin?: string;
  boardOrigin?: string;
  root: string;
  runtimeDir?: string;
  urlHost: string;
  viewerDir: string;
}

export interface MountSettings {
  boardPort: number;
  port: number;
  token: string;
  version: string;
}

export type ArtifactPayload = (CanvasPayload | HtmlPayload | DocumentPayload) & {
  warnings: string[];
};

export type ChangeListener = (ref: ArtifactRef, payload: ArtifactPayload, files: string[]) => void;

export function readArtifactSource(
  dir: string,
  ref: ArtifactRef,
  runtime: string[] = [],
): ArtifactPayload {
  if (ref.type === 'artboard') return readCanvas(dir);
  if (ref.type === 'document') {
    const payload = readDocument(dir, ref.id);
    return { ...payload, warnings: [...payload.warnings, ...runtime] };
  }
  const payload = readHtml(dir, ref.id);
  return {
    ...payload,
    warnings: [...payload.warnings, ...runtime.map((message) => `runtime: ${message}`)],
  };
}

export function titleOf(payload: ArtifactPayload) {
  if ('title' in payload && typeof payload.title === 'string' && payload.title.trim())
    return payload.title.trim();
  if ('canvas' in payload) {
    const title = payload.canvas?.title;
    if (typeof title === 'string' && title.trim()) return title.trim();
  }
  return 'Untitled artifact';
}

export function createServerContext(options: ServerOptions) {
  const root = path.resolve(options.root);
  const viewerDir = path.resolve(options.viewerDir);
  const runtimeDir = options.runtimeDir ? path.resolve(options.runtimeDir) : null;
  const stateDir = path.join(root, '.state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stateDir, '.gitignore'), '*\n');
  if (options.configFile) ensureConfig(options.configFile);

  const portFile = path.join(stateDir, '.last-port');
  const tokenFile = path.join(stateDir, '.last-token');
  const mount = options.mount;
  const token = mount?.token ?? (readPersisted(tokenFile) || randomToken());
  if (!mount) fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  const contentToken = randomToken();
  const loopback = isLoopbackHost(options.host) && !options.publicOrigin;
  const keyOk = (key: string | null) => loopback || (key !== null && safeEqual(key, token));
  const agentOk = (req: http.IncomingMessage, key: string | null) =>
    loopback ? req.headers.origin === undefined : key !== null && safeEqual(key, token);
  const runtimeWarnings = new Map<string, string[]>();
  const ranVersions = new Map<string, number>();
  const dynamicBlocks = createDynamicBlocks({ maxErrors: MAX_RUNTIME_WARNINGS });
  const runtimeOf = (ref: ArtifactRef, dir: string) =>
    ref.type === 'document'
      ? [...documents.warnings(ref.id), ...dynamicBlocks.state(ref.id, dir).warnings]
      : (runtimeWarnings.get(`${ref.type}/${ref.id}`) ?? []);
  const contentPrefix = `/c/${contentToken}/`;

  const clients = new Set<Duplex>();
  const selections = createSelectionStore(
    stateDir,
    (kind, id) => resolveArtifactDir(root, kind, id) !== null,
  );
  selections.clearAll();
  const changeListeners: ChangeListener[] = [];
  const activityListeners: (() => void)[] = [];
  const startedAt = Date.now();
  const touch = () => {
    ctx.lastActivity = Date.now();
    activityListeners.forEach((listener) => listener());
  };
  const boardOrigins = () => options.boardOrigin
    ? [options.boardOrigin]
    : (ctx.boardPort ? originsFor(options.urlHost, ctx.boardPort) : []);

  const broadcast = (message: ServerMessage) => {
    const frame = textFrame(JSON.stringify(message));
    for (const socket of clients) socket.write(frame);
  };
  const avatars = createAvatars(options.fetch);
  const names = commentNames({ agentFile: path.join(stateDir, 'agent'), projectDir: path.resolve(root, '../..') });
  const recordings = createVerifyRecordings({
    stateDir,
    onChange: (id) => {
      const ref: ArtifactRef = { type: 'artboard', id };
      const dir = resolveArtifactDir(root, ref.type, id);
      if (!dir) return;
      const payload = refreshState(ref, dir);
      boardComments.boardsChanged(id);
      const key = `artboard/${id}`;
      broadcast({ type: 'change', artifact: key, files: [] });
      changeListeners.forEach((listener) => listener(ref, payload, []));
    },
  });
  const readArtifact = (dir: string, ref: ArtifactRef, runtime: string[] = []): ArtifactPayload => {
    const payload = readArtifactSource(dir, ref, runtime);
    return ref.type === 'artboard'
      ? recordings.project(ref.id, dir, payload as CanvasPayload)
      : payload;
  };
  const boardComments = createBoardCommentRegistry({
    root,
    stateDir,
    broadcast,
    names,
    evidenceHash: recordings.evidenceHash,
  });
  const listeningTimer = setInterval(() => boardComments.refreshListening(), 3000);
  listeningTimer.unref();
  const documents = createDocumentRegistry({
    root,
    stateDir,
    timing: options.documentTiming,
    broadcast,
    names,
    onWarningsChange: (id) => {
      const dir = resolveArtifactDir(root, 'document', id);
      if (!dir) return;
      writeState({ type: 'document', id }, dir);
      broadcast({ type: 'change', artifact: `document/${id}`, files: [] });
    },
    log: (line) => console.info(JSON.stringify({ type: 'document-log', line })),
  });

  const sameOrigin = (req: http.IncomingMessage) => {
    const origin = req.headers.origin;
    const host = req.headers.host ?? '';
    return origin === `http://${host}` || origin === `https://${host}`;
  };

  const documentState = (
    id: string,
    session: NonNullable<Awaited<ReturnType<typeof documents.open>>>,
  ) => ({
    snapshot: Buffer.from(session.snapshot()).toString('base64'),
    lineage: session.lineage(),
    outcome: session.outcome(),
    streaming: session.streaming(),
    agentActiveAt: session.agentActiveAt(),
    now: Date.now(),
    comments: documents.comments(id),
  });

  const verdictPreparing = (id: string, op: NonNullable<ReturnType<typeof asBoardHumanOp>>) => {
    if (op.op !== 'create' || !op.anchor.verdict) return false;
    const dir = resolveArtifactDir(root, 'artboard', id);
    if (!dir) return false;
    const payload = readArtifact(dir, { type: 'artboard', id }) as CanvasPayload;
    const members = payload.canvas?.groups?.[op.anchor.group!]?.boards ?? [];
    return members.some((board) => payload.pending.includes(board));
  };

  const isAuthorized = (req: http.IncomingMessage, keyFromQuery: string | null) =>
    loopback ||
    (keyFromQuery !== null && safeEqual(keyFromQuery, token)) ||
    safeEqual(parseCookies(req.headers.cookie)[ctx.cookieName] ?? '', token);

  const artifactMeta = (ref: ArtifactRef, dir: string, contentOrigin = '') => ({
    ...readArtifact(dir, ref, runtimeOf(ref, dir)),
    ...(ref.type !== 'html' ? { agent: names.agent() } : {}),
    ...(ref.type === 'artboard'
      ? {
          comments: boardComments.comments(ref.id),
          staleThreads: boardComments.stale(ref.id),
          listening: boardComments.listening(ref.id),
        }
      : {}),
    contentBase: `${contentOrigin}${contentPrefix}${ref.type}/${ref.id}/`,
  });

  const signatures = new Map<string, string>();
  const writeState = (ref: ArtifactRef, dir: string) => {
    const payload = readArtifact(dir, ref, runtimeOf(ref, dir));
    const extra =
      ref.type === 'document'
        ? { dynamic: dynamicBlocks.state(ref.id, dir).dynamic }
        : ref.type === 'html' && 'version' in payload
          ? { ran: ranVersions.get(`${ref.type}/${ref.id}`) === payload.version }
          : 'recordings' in payload
            ? { recordings: payload.recordings }
            : {};
    try {
      writeArtifactState(stateDir, ref, payload, extra);
    } catch (err) {
      console.error(JSON.stringify({ type: 'state-write-error', error: (err as Error).message }));
    }
    return payload;
  };
  const refreshState = (ref: ArtifactRef, dir: string) => {
    signatures.set(`${ref.type}/${ref.id}`, artifactSignature(dir, ref.type));
    return writeState(ref, dir);
  };

  const ctx = {
    options,
    root,
    viewerDir,
    runtimeDir,
    stateDir,
    portFile,
    mount,
    token,
    contentToken,
    contentPrefix,
    loopback,
    policy: accessPolicy({
      host: options.host,
      urlHost: options.urlHost,
      ports: [],
      publicOrigin: options.publicOrigin,
    }),
    port: 0,
    boardPort: 0,
    cookieName: '',
    startedAt,
    lastActivity: startedAt,
    keyOk,
    agentOk,
    isAuthorized,
    sameOrigin,
    touch,
    boardOrigins,
    runtimeWarnings,
    ranVersions,
    dynamicBlocks,
    runtimeOf,
    clients,
    selections,
    changeListeners,
    activityListeners,
    broadcast,
    avatars,
    names,
    recordings,
    readArtifact,
    boardComments,
    listeningTimer,
    documents,
    documentState,
    verdictPreparing,
    artifactMeta,
    signatures,
    writeState,
    refreshState,
  };
  return ctx;
}

export type ServerContext = ReturnType<typeof createServerContext>;

export const projectName = (ctx: ServerContext) =>
  path.basename(path.dirname(path.dirname(ctx.root)));
