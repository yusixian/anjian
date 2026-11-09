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
import {
  type ArtifactPayload,
  type ChangeListener,
  createServerContext,
  type MountSettings,
  type ServerOptions,
} from './context';
import { listen, readPersisted, send, urlHostForHttp } from './http';
import { createBoardRequestHandler } from './routes/content';
import { HTTP_ROUTES, UPGRADE_ROUTES } from './routes/index';
import { dispatchHttp, dispatchUpgrade } from './routes/table';
import { writeJsonAtomic } from './state';

export type { ArtifactPayload, MountSettings, ServerOptions } from './context';

export interface ArtifactsServer {
  boardPort: number;
  close: () => Promise<void>;
  contentToken: string;
  handleBoardRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  handleUpgrade: (req: http.IncomingMessage, socket: Duplex, head?: Buffer) => void;
  linkFor: (type: ArtifactType, id: string) => string;
  liveClients: () => number;
  onMessage: (listener: (message: ServerMessage) => void) => void;
  settleDocument: (id: string, source?: string) => Promise<void>;
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
  const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    void browserAuth(req, res, new URL(req.url ?? '/', 'http://artifacts.local'))
      .then((handled) => { if (!handled) dispatchHttp(HTTP_ROUTES, req, res, ctx); })
      .catch((err: Error) => { if (!res.headersSent) send(res, 500, `Artifacts error: ${err.message}`); });
  };

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) send(res, 500, `Artifacts error: ${(err as Error).message}`);
    }
  });

  const handleUpgrade = (req: http.IncomingMessage, socket: Duplex) =>
    dispatchUpgrade(UPGRADE_ROUTES, req, socket, ctx);
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
  const boardServer = http.createServer(handleBoardRequest);
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
        handleRequest(req, res);
      } catch (err) {
        if (!res.headersSent) send(res, 500, `Artifacts error: ${(err as Error).message}`);
      }
    },
    handleUpgrade,
    handleBoardRequest,
    liveClients: () => clients.size,
    onMessage: (listener) => { ctx.messageListeners.push(listener); },
    settleDocument: async (id, source) => {
      const session = await ctx.documents.open(id);
      if (!session) return;
      if (source !== undefined) session.onFileText(source);
      await session.settled();
      await session.flush();
    },
    resolve: (type, idOrAddress) => {
      if (!isArtifactLocator(idOrAddress)) return null;
      return resolveArtifactAddress(root, type, idOrAddress)?.id ?? null;
    },
    onArtifactChange: (listener) => {
      ctx.changeListeners.push(listener);
      for (const change of initialChanges) listener(change.ref, change.payload, change.files);
    },
    onActivity: (listener) => ctx.activityListeners.push(listener),
    close: async () => {
      clearInterval(ctx.listeningTimer);
      await ctx.recordings.close();
      await new Promise<void>((resolve) => {
        watcher.close();
        ctx.selections.clearAll();
        for (const socket of clients) socket.destroy();
        boardServer.close();
        boardServer.closeAllConnections();
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await ctx.documents.close().catch(() => undefined);
      if (mount) fs.rmSync(path.join(stateDir, 'server-info'), { force: true });
    },
  };
}

export const mountArtifactsProject = (
  options: ServerOptions & { mount: MountSettings },
): Promise<MountedProject> => startArtifactsServer(options);
