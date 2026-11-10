import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';

import type { ArtifactType, ServerMessage } from '../shared/types';
import { accessPolicy, isLoopbackHost } from './access';
import { artifactPath, resolveArtifactAddress } from './artifact-address';
import { watchArtifacts } from './artifact-watcher';
import { type ArtifactRef, isArtifactLocator, listArtifacts } from './artifacts';
import { BOARD_PORT_FILE } from './board-port';
import { createBrowserAuth } from './browser-auth';
import { createGitHubAuth, readGitHubConfig } from './github-auth';
import { prepareNewRemoteDocument, type PreparedRemoteDocument } from './document-session';
import type { PreparedStorageState } from './remote-transfer';
import {
  type ArtifactPayload,
  type ChangeListener,
  createServerContext,
  type MountSettings,
  type ServerOptions,
} from './context';
import { listen, readPersisted, send, urlHostForHttp } from './http';
import { createBoardRequestHandler, serveContent } from './routes/content';
import { HTTP_ROUTES, UPGRADE_ROUTES } from './routes/index';
import { dispatchHttp, dispatchUpgrade } from './routes/table';
import { writeJsonAtomic } from './state';
import { rejectUpgrade } from './ws';

export type { ArtifactPayload, MountSettings, ServerOptions } from './context';

export interface ArtifactsServer {
  boardPort: number;
  close: () => Promise<void>;
  /** Caller excludes direct project mutations; external filesystem changes still need source validation. */
  quiesce: <T>(work: () => Promise<T>) => Promise<T>;
  contentToken: string;
  handlePrivateContent: (req: http.IncomingMessage, res: http.ServerResponse, rest: string, mode: 'main' | 'board') => void;
  handleBoardRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
  handleUpgrade: (req: http.IncomingMessage, socket: Duplex, head?: Buffer) => void;
  linkFor: (type: ArtifactType, id: string) => string;
  liveClients: () => number;
  onMessage: (listener: (message: ServerMessage) => void) => void;
  settleDocument: (id: string, source?: string) => Promise<void>;
  prepareDocumentUpload: (id: string, source: string, files: string[]) => Promise<PreparedRemoteDocument>;
  prepareArtifactUpload: (type: 'artboard' | 'html', id: string, stagedDir: string) => PreparedStorageState;
  onActivity: (listener: () => void) => void;
  onArtifactChange: (listener: ChangeListener) => void;
  port: number;
  resolve: (type: ArtifactType, idOrAddress: string) => string | null;
  root: string;
  token: string;
  url: string;
}

export type MountedProject = ArtifactsServer;

export async function startArtifactsServer(options: ServerOptions): Promise<ArtifactsServer> {
  const githubConfig = options.mount ? undefined : options.github ?? readGitHubConfig();
  const ctx = createServerContext(options);
  const { root, stateDir, mount, loopback, token, clients } = ctx;

  const browserAuth = createBrowserAuth({
    get cookieName() { return ctx.cookieName; },
    get github() { return ctx.github; },
    token,
    get origin() { return options.publicOrigin ?? `http://${urlHostForHttp(options.urlHost)}:${ctx.port}`; },
    loopback,
    get policy() { return ctx.policy; },
    authorized: (req, url) => ctx.isAuthorized(req, url.searchParams.get('key')),
  });
  let stopping = false;
  const requests = new Set<Promise<unknown>>();
  const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (stopping || ctx.inputs.paused) { res.setHeader('Retry-After', '1'); send(res, 503, 'Project is being updated; retry shortly'); return; }
    req.setTimeout(15_000, () => req.destroy());
    const request = browserAuth(req, res, new URL(req.url ?? '/', 'http://artifacts.local'))
      .then((handled) => { if (!handled) return dispatchHttp(HTTP_ROUTES, req, res, ctx); })
      .catch((err: Error) => { if (!res.headersSent) send(res, 500, `Artifacts error: ${err.message}`); });
    requests.add(request);
    void request.then(() => requests.delete(request), () => requests.delete(request));
    return request;
  };

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) send(res, 500, `Artifacts error: ${(err as Error).message}`);
    }
  });

  const handleUpgrade = (req: http.IncomingMessage, socket: Duplex) => {
    if (stopping) socket.destroy();
    else if (ctx.inputs.paused) rejectUpgrade(socket, 503, 'Service Unavailable');
    else dispatchUpgrade(UPGRADE_ROUTES, req, socket, ctx);
  };
  server.on('upgrade', handleUpgrade);

  if (mount) ctx.port = mount.port;
  else {
    const previousPort = Number(readPersisted(ctx.portFile));
    try {
      ctx.port = await listen(
        server,
        options.host,
        Number.isInteger(previousPort) && previousPort > 0 ? previousPort : 0,
      );
    } catch {
      ctx.port = await listen(server, options.host, 0);
    }
    fs.writeFileSync(ctx.portFile, `${ctx.port}\n`, { mode: 0o600 });
  }
  const port = ctx.port;
  ctx.cookieName = `anjian_artifacts_${port}`;
  if (githubConfig) ctx.github = createGitHubAuth({ config: githubConfig, token, origin: options.publicOrigin ?? `http://${urlHostForHttp(options.urlHost)}:${port}`, cookieName: ctx.cookieName, fetch: options.fetch });

  const handleBoardRequest = createBoardRequestHandler(ctx);
  const guardedBoardRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (stopping || ctx.inputs.paused) { send(res, 503, 'Project is being updated; retry shortly'); return; }
    handleBoardRequest(req, res);
  };
  const boardServer = http.createServer(guardedBoardRequest);
  if (mount) ctx.boardPort = mount.boardPort;
  else if (isLoopbackHost(options.host) || options.boardOrigin) {
    const boardPortFile = path.join(stateDir, BOARD_PORT_FILE);
    const previousBoardPort = Number(readPersisted(boardPortFile));
    try {
      ctx.boardPort = await listen(
        boardServer,
        options.host,
        Number.isInteger(previousBoardPort) && previousBoardPort > 0 && previousBoardPort !== port
          ? previousBoardPort
          : 0,
      );
    } catch {
      ctx.boardPort = await listen(boardServer, options.host, 0);
    }
    fs.writeFileSync(boardPortFile, `${ctx.boardPort}\n`, { mode: 0o600 });
  }
  const boardPort = ctx.boardPort;
  ctx.policy = accessPolicy({
    host: options.host,
    urlHost: options.urlHost,
    ports: boardPort ? [port, boardPort] : [port],
    publicOrigin: options.publicOrigin,
  });

  const origin = options.publicOrigin ?? `http://${urlHostForHttp(options.urlHost)}:${port}`;
  const url = loopback ? `${origin}/` : `${origin}/?key=${token}`;
  const localHost = options.host === '0.0.0.0' ? '127.0.0.1' : urlHostForHttp(options.host);
  const localUrl = `http://${localHost}:${port}/${loopback ? '' : `?key=${token}`}`;
  const linkFor = (type: ArtifactType, id: string) =>
    `${origin}${artifactPath(root, type, id)}${loopback ? '' : `?key=${token}`}`;

  const initialChanges: { ref: ArtifactRef; payload: ArtifactPayload; files: string[] }[] = [];
  for (const entry of listArtifacts(root).artifacts) {
    const payload = ctx.refreshState(entry, entry.dir);
    initialChanges.push({ ref: entry, payload, files: [] });
    if (entry.type === 'document') void ctx.documents.open(entry.id);
  }
  writeJsonAtomic(path.join(stateDir, 'server-info'), {
    type: 'server-started',
    url,
    localUrl,
    port,
    boardPort,
    publicOrigin: options.publicOrigin,
    boardOrigin: options.boardOrigin,
    root,
  });

  const watcher = watchArtifacts(ctx);
  let maintenance: Promise<unknown> = Promise.resolve();
  const quiesce = <T>(work: () => Promise<T>): Promise<T> => {
    const current = maintenance.catch(() => undefined).then(async () => {
      if (stopping) throw new Error('Project is stopping');
      const resumeInputs = ctx.inputs.pause();
      const resumeBackground = ctx.backgroundWrites.pause();
      const sockets = [...clients];
      const resume: Array<() => void> = [resumeBackground, () => {
        const failures: unknown[] = [];
        try { resumeInputs(); } catch (error) { failures.push(error); }
        for (const socket of sockets) {
          try { if (!socket.destroyed) socket.resume(); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'Project inputs did not resume completely');
      }];
      const failures: unknown[] = [];
      let value: T | undefined;
      try {
        for (const socket of sockets) socket.pause();
        const requestsDone = await Promise.allSettled([...requests]);
        const errors = requestsDone.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason);
        if (errors.length) throw new AggregateError(errors, 'Project requests did not finish');
        resume.push(await ctx.recordings.quiesce());
        resume.push(await ctx.documents.quiesce());
        value = await work();
      } catch (error) { failures.push(error); }
      finally {
        for (const release of resume.reverse()) {
          try { release(); } catch (error) { failures.push(error); }
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'Project maintenance failed');
      return value as T;
    });
    maintenance = current;
    return current;
  };
  const completedCloseSteps = new Set<string>();
  let closePromise: Promise<void> | null = null;
  let closed = false;
  const closeServer = (target: http.Server) => new Promise<void>((resolve, reject) => {
    try {
      target.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      });
      target.closeAllConnections();
    } catch (error) { reject(error); }
  });
  const close = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (closePromise) return closePromise;
    stopping = true;
    const run = async () => {
      await maintenance.catch(() => undefined);
      const failures: unknown[] = [];
      const step = async (name: string, action: () => void | Promise<void>) => {
        if (completedCloseSteps.has(name)) return;
        try { await action(); completedCloseSteps.add(name); }
        catch (error) { failures.push(error); }
      };
      await step('backgroundWrites', () => ctx.backgroundWrites.close());
      await step('watcher', () => watcher.close());
      await step('sockets', () => {
        const errors: unknown[] = [];
        for (const socket of clients) {
          try { socket.destroy(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Failed to close client sockets');
      });
      await step('requests', async () => {
        const results = await Promise.allSettled([...requests]);
        const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason);
        if (errors.length) throw new AggregateError(errors, 'Requests failed while closing');
      });
      await step('timer', () => clearInterval(ctx.listeningTimer));
      await step('recordings', () => ctx.recordings.close());
      await step('documents', () => ctx.documents.close());
      await step('selections', () => ctx.selections.clearAll());
      await step('boardServer', () => closeServer(boardServer));
      await step('server', () => closeServer(server));
      if (failures.length) throw new AggregateError(failures, 'Project did not close completely');
      if (mount) await step('serverInfo', () => fs.rmSync(path.join(stateDir, 'server-info'), { force: true }));
      if (failures.length) throw new AggregateError(failures, 'Project did not close completely');
      closed = true;
    };
    closePromise = run().finally(() => { closePromise = null; });
    return closePromise;
  };

  return {
    port,
    boardPort,
    token,
    contentToken: ctx.contentToken,
    url,
    root,
    linkFor,
    handleRequest: (req, res) => {
      try {
        return handleRequest(req, res);
      } catch (err) {
        if (!res.headersSent) send(res, 500, `Artifacts error: ${(err as Error).message}`);
      }
    },
    handleUpgrade,
    handleBoardRequest: guardedBoardRequest,
    handlePrivateContent: (req, res, rest, mode) => {
      if (stopping || ctx.inputs.paused) send(res, 503, 'Project is being updated; retry shortly');
      else serveContent(ctx, res, rest, req.headers.range, mode);
    },
    liveClients: () => clients.size,
    onMessage: (listener) => { ctx.messageListeners.push(listener); },
    settleDocument: async (id, source) => {
      const session = await ctx.documents.open(id);
      if (!session) return;
      if (source !== undefined) session.onFileText(source);
      await session.settled();
      await session.flush();
    },
    prepareDocumentUpload: async (id, source, files) => {
      const session = await ctx.documents.open(id);
      if (session) {
        await session.readyForRemoteUpload();
        const prepared = session.prepareRemoteText(source);
        const metadata = ctx.prepareDocumentMetadata(id, prepared.xml, prepared.warnings, files);
        prepared.stateDeltaBytes += metadata.delta;
        prepared.addStateFile(metadata.file, metadata.data);
        const validate = prepared.validate;
        prepared.validate = () => { validate(); metadata.validate(); };
        return prepared;
      }
      const prepared = prepareNewRemoteDocument(source, path.join(stateDir, 'document', id, 'doc.loro'), stateDir);
      const metadata = ctx.prepareDocumentMetadata(id, prepared.xml, prepared.warnings, files);
      prepared.stateDeltaBytes += metadata.delta;
      prepared.addStateFile(metadata.file, metadata.data);
      const validate = prepared.validate;
      prepared.validate = () => { validate(); metadata.validate(); };
      return prepared;
    },
    prepareArtifactUpload: (type, id, stagedDir) => ctx.prepareArtifactMetadata(type, id, stagedDir),
    resolve: (type, idOrAddress) => {
      if (!isArtifactLocator(idOrAddress)) return null;
      return resolveArtifactAddress(root, type, idOrAddress)?.id ?? null;
    },
    onArtifactChange: (listener) => {
      ctx.changeListeners.push(listener);
      for (const change of initialChanges) listener(change.ref, change.payload, change.files);
    },
    onActivity: (listener) => ctx.activityListeners.push(listener),
    close,
    quiesce,
  };
}

export const mountArtifactsProject = (
  options: ServerOptions & { mount: MountSettings },
): Promise<MountedProject> => startArtifactsServer(options);
