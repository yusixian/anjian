import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';

import type { HubArtifact, HubArtifactList, HubProjectStatus, HubStatus } from '../shared/hub';
import type { ArtifactType } from '../shared/types';
import { accessPolicy, hostAllowed, isLoopbackHost, navigationAllowed, originAllowed } from './access';
import { mountArtifactsProject, type MountedProject } from './app';
import { artifactPath } from './artifact-address';
import { findTrashedArtifact, listTrash, recoverProjectTrash } from './artifact-trash';
import { createHubTrash } from './hub-trash';
import { createHubShare } from './hub-share';
import { createPublicShare } from './public-share';
import { createShareStore } from './share-store';
import { serveHubViewer } from './hub-viewer';
import { withProjectMutation } from './project-mutations';
import { withProjectMaintenance } from './project-maintenance';
import { createStorageRuntime } from './storage/runtime';
import { withRequestStorageAdmission } from './storage/request-admission';
import { createProjectSuspension } from './project-suspension';
import { createArtifactIndex } from './artifact-index';
import { listArtifacts } from './artifacts';
import { routeBoardRequest } from './board-port';
import { createBrowserAuth } from './browser-auth';
import { createContentAccess } from './content-access';
import { createMemberStore } from './member-store';
import { createMemberApi } from './member-api';
import { createMemberWorkspace } from './member-workspace';
import { createStorageSettings } from './storage/settings';
import { createStorageApi } from './storage/api';
import { createStorageUsage } from './storage/usage';
import { createStorageQuota } from './storage/quota';
import { createStorageMigration } from './storage/migration';
import { createStorageMigrationApi } from './storage/migration-api';
import { planMigrationSources } from './storage/sources';
import { createStorageBackend } from './storage/backend';
import { createProjectAccess } from './project-access';
import { createGitHubAuth, readGitHubConfig, type GitHubConfig } from './github-auth';
import { readArtifactSource, titleOf } from './context';
import { latestMtime } from './html';
import { safeEqual, send, sendJson, urlHostForHttp } from './http';
import {
  artifactsRootOf,
  isDormant,
  type MachinePaths,
  type ProjectEntry,
  pruneProjects,
  readProjects,
  registerProject,
  removeProject,
} from './machine';
import { listenFirst } from './ports';
import { openReady } from './ready';
import { createRemoteAuth } from './remote-auth';
import { createRemoteApi } from './remote-api';
import { createRemoteEvents } from './remote-events';
import { writeJsonAtomic } from './state';

export interface HubOptions {
  github?: GitHubConfig;
  boardPorts: number[];
  control?: { relaunch: () => boolean; stop: () => void };
  debounceMs?: number;
  fetch?: typeof fetch;
  host: string;
  open?: (link: string, local: string, openCmd?: string) => Promise<void>;
  paths: MachinePaths;
  ports: number[];
  publicOrigin?: string;
  boardOrigin?: string;
  runtimeDir?: string;
  token: string;
  urlHost: string;
  version: string;
  viewerDir: string;
}

export interface OpenRequest {
  artifact: string | null;
  openCmd?: string;
}

export interface Hub {
  boardPort: number;
  close: () => Promise<void>;
  linkFor: (project: string, type: ArtifactType, id: string) => Promise<string>;
  localUrl: string;
  mounted: () => MountedProject[];
  mountOf: (project: string) => Promise<MountedProject>;
  port: number;
  projects: () => ProjectEntry[];
  register: (project: string, open?: OpenRequest) => Promise<ProjectEntry>;
  remove: (project: string) => Promise<void>;
  status: () => HubStatus;
  token: string;
  url: string;
}

const CONTROL_PATH = /^\/api\/hub\/(?:stop|restart|log)$/;
const LOG_TAIL_BYTES = 256 * 1024;
const STATUS_SCAN_MS = 10_000;
const LOG_TAIL_LINES = 500;
const ARTIFACT_IN_PATH = /(?:^|\/)(artboard|document|html)\/([\w-]+)/;
const CONTENT_PATH = /^\/c\/([^/]+)\//;
const PROJECT_HEADER = 'x-anjian-project';
const MAX_BODY = 64 * 1024;
const ARTIFACT_KEY = /^(?:artboard|document|html)\/[a-z0-9][a-z0-9-]*$/;

const realDir = (dir: string) => {
  try {
    return fs.realpathSync(path.resolve(dir));
  } catch {
    return null;
  }
};

function readBody(req: http.IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

export async function startHub(options: HubOptions): Promise<Hub> {
  const githubConfig = options.github ?? readGitHubConfig();
  const localBinding = isLoopbackHost(options.host);
  const loopback = localBinding && !options.publicOrigin;
  const projectsFile = options.paths.projects;
  const members = createMemberStore(options.paths.home, githubConfig?.ownerId);
  const settings = createStorageSettings(options.paths.home);
  const storageHome = fs.realpathSync(options.paths.home);
  const migration = createStorageMigration(options.paths.home, { resolveProfile: settings.resolve });
  const storageBackend = createStorageBackend(options.paths.home, { migration, resolveProfile: settings.resolve });
  // Hydrate before pruning missing roots, trash recovery, indexing, or accepting requests.
  await storageBackend.restore();
  const storageRuntime = createStorageRuntime({ backend: storageBackend,
    owners: () => [...readProjects(projectsFile).map(({ dir }) => members.projectOwner(dir)), ...members.storageProjects().map(({ owner }) => owner)],
    maintain: (owner, work, recovering) => maintainRuntime(owner, work, recovering),
    plan: (owner, scope, recovering) => planRuntime(owner, scope, recovering),
  });
  const recoveryPending = (owner: string) => owner === 'shared'
    ? storageRuntime.scopePending('shared') : storageRuntime.ownerPending(owner);
  const available = (project: string) => !recoveryPending(members.projectOwner(project));
  const assertAvailable = (project: string) => {
    if (!available(project)) throw new Error('存储尚未恢复，此空间暂不可用，请联系管理员。');
  };
  // Cleanup and mounting also write cached resources. Protect them before either starts.
  for (const owner of new Set(['shared', ...storageBackend.ownersFor('shared'),
    ...readProjects(projectsFile).map(({ dir }) => members.projectOwner(dir)), ...members.storageProjects().map(({ owner }) => owner)])) {
    if (!storageRuntime.ownerPending(owner)) await storageRuntime.arm(owner);
  }
  pruneProjects(projectsFile, (project) => !available(project));

  for (const project of readProjects(projectsFile)) {
    if (!available(project.dir)) continue;
    await withProjectMutation(project.dir, async () => recoverProjectTrash(project.dir));
  }

  const ordered = () => readProjects(projectsFile).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const registered = (dir: string) => available(dir) && ordered().some((entry) => entry.dir === dir);
  const shares = createShareStore(storageHome, { canMutateProject: available });
  const index = createArtifactIndex(() => ordered().filter((entry) => available(entry.dir)).map((entry) => entry.dir), {
    rescanAfterMs: 0,
  });

  const front = http.createServer();
  const board = http.createServer();
  const port = await listenFirst(front, options.host, options.ports);
  const boardPort = localBinding || options.boardOrigin
    ? await listenFirst(board, options.host, options.boardPorts)
    : 0;
  const policy = accessPolicy({
    host: options.host,
    urlHost: options.urlHost,
    ports: boardPort ? [port, boardPort] : [port],
    publicOrigin: options.publicOrigin,
  });

  const origin = options.publicOrigin ?? `http://${urlHostForHttp(options.urlHost)}:${port}`;
  const github = githubConfig ? createGitHubAuth({ config: githubConfig, token: options.token, origin, cookieName: `anjian_artifacts_${port}`, members, prepareMember: (identity) => prepareMember(identity), fetch: options.fetch }) : undefined;

  const projectId = (dir: string) => crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32);
  const remoteProjects = () => ordered().filter((entry) => available(entry.dir)).map((p) => ({ id: projectId(p.dir), name: path.basename(p.dir), dir: p.dir }));
  const remoteEvents = createRemoteEvents(options.paths.home);
  const mounts = new Map<string, Promise<MountedProject>>();
  const ready = new Map<string, MountedProject>();
  let closing = false;
  const suspension = createProjectSuspension();
  const mountOf = (project: string): Promise<MountedProject> => {
    if (!available(project)) return Promise.reject(new Error('存储尚未恢复，此空间暂不可用，请联系管理员。'));
    const pause = suspension.wait(project);
    if (pause) return pause.then(() => mountOf(project));
    if (closing) return Promise.reject(new Error('Artifacts server is stopping'));
    let pending = mounts.get(project);
    if (!pending) {
      pending = storageRuntime.arm(members.projectOwner(project)).then(() => mountArtifactsProject({
        root: artifactsRootOf(project),
        viewerDir: options.viewerDir,
        runtimeDir: options.runtimeDir,
        host: options.host,
        urlHost: options.urlHost,
        configFile: path.join(project, '.anjian', 'config.json'),
        publicOrigin: options.publicOrigin,
        boardOrigin: options.boardOrigin,
        fetch: options.fetch,
        debounceMs: options.debounceMs,
        mount: { port, boardPort, token: options.token, version: options.version, github,
          recordingWrite: work => writeQuota(project, prepare => withProjectMutation(project, async () => {
            assertAvailable(project);
            await work(await prepare());
          })),
          backgroundWrite: work => writeQuota(project, prepare => withProjectMutation(project, async () => {
            assertAvailable(project);
            const admit = await prepare();
            let total = 0;
            work(delta => { const next = total + delta; admit(next); total = next; });
          })),
          authorize: (req) => projectAccess.authorized(req, project),
          ...(!loopback ? { contentAccess: (req: http.IncomingMessage, ref: import('./artifacts').ArtifactRef) => {
            const identity = projectAccess.principal(req, new URL(req.url ?? '/', origin));
            if (!identity) throw new Error('Content access denied');
            return contentAccess.issue(identity, project, ref);
          } } : {}),
        },
      })).then((mounted) => {
        ready.set(project, mounted);
        try { remoteEvents.append(projectId(project), '', 'resync', { reason: 'project-mounted', action: 'Read current comments with comment list --all' }); }
        catch (error) { console.error('Remote event persistence failed:', (error as Error).message); }
        mounted.onMessage((message) => {
          if (message.type !== 'doc-comments' && message.type !== 'board-comments' && message.type !== 'change') return;
          if (!('artifact' in message)) return;
          storageRuntime.changed(members.projectOwner(project));
          try { remoteEvents.append(projectId(project), message.artifact, message.type, { action: 'Read current comments or pull the changed artifact' }); }
          catch (error) { console.error('Remote event persistence failed:', (error as Error).message); }
        });
        return mounted;
      });
      pending.catch(() => mounts.delete(project));
      mounts.set(project, pending);
    }
    return pending;
  };

  const url = loopback ? `${origin}/` : `${origin}/?key=${options.token}`;
  const localHost = options.host === '0.0.0.0' ? '127.0.0.1' : urlHostForHttp(options.host);
  const localUrl = `http://${localHost}:${port}/${loopback ? '' : `?key=${options.token}`}`;
  const infoFileOf = (project: string) =>
    path.join(artifactsRootOf(project), '.state', 'server-info');
  const writeCompatInfo = (project: string) => {
    try {
      fs.mkdirSync(path.dirname(infoFileOf(project)), { recursive: true, mode: 0o700 });
      writeJsonAtomic(infoFileOf(project), {
        type: 'server-started',
        url,
        localUrl,
        port,
        boardPort,
        publicOrigin: options.publicOrigin,
        boardOrigin: options.boardOrigin,
        root: artifactsRootOf(project),
      });
    } catch {}
  };
  const startedAt = Date.now();
  let lastActivity = startedAt;

  const projectStatuses = (scope?: ReadonlySet<string>): HubProjectStatus[] => {
    const counts = new Map<string, number>();
    for (const entry of index.list(STATUS_SCAN_MS))
      counts.set(entry.project, (counts.get(entry.project) ?? 0) + 1);
    return ordered().filter((entry) => !scope || scope.has(entry.dir)).map((entry) => ({
      dir: entry.dir,
      name: path.basename(entry.dir),
      lastUsedAt: entry.lastUsedAt,
      dormant: isDormant(entry),
      artifacts: counts.get(entry.dir) ?? 0,
    }));
  };

  const artifactList = (scope?: ReadonlySet<string>): HubArtifactList => {
    const artifacts: HubArtifact[] = [];
    const warnings: string[] = [];
    for (const entry of ordered()) {
      if (!available(entry.dir)) continue;
      if (scope && !scope.has(entry.dir)) continue;
      const root = artifactsRootOf(entry.dir);
      const listed = listArtifacts(root);
      for (const warning of listed.warnings)
        warnings.push(`${path.basename(entry.dir)}: ${warning}`);
      for (const artifact of listed.artifacts) {
        try {
          artifacts.push({
            project: entry.dir,
            type: artifact.type,
            id: artifact.id,
            url: artifactPath(root, artifact.type, artifact.id),
            title: titleOf(readArtifactSource(artifact.dir, artifact)),
            updatedAt: latestMtime(artifact.dir),
          });
        } catch {}
      }
    }
    artifacts.sort((a, b) => b.updatedAt - a.updatedAt);
    return { projects: projectStatuses(scope), artifacts, warnings };
  };

  const status = (): HubStatus => {
    const local = [...ready.values()].reduce((sum, mounted) => sum + mounted.liveClients(), 0);
    return {
      authenticationRequired: !loopback,
      deployment: loopback ? 'local' : 'self-hosted',
      pid: process.pid,
      version: options.version,
      startedAt,
      lastActivity,
      clients: local,
      port,
      boardPort,
      url,
      live: { local },
      projects: projectStatuses(),
    };
  };

  const keyOk = (url: URL) => {
    const key = url.searchParams.get('key');
    return loopback || (key !== null && safeEqual(key, options.token));
  };
  const authorized = (req: http.IncomingMessage, url: URL) =>
    keyOk(url) || Boolean(github?.authorized(req.headers.cookie)) ||
    (req.headers.cookie ?? '')
      .split(';')
      .some((part) => safeEqual(part.trim(), `anjian_artifacts_${port}=${options.token}`));
  const projectAccess = createProjectAccess({ members, github, isOwner: authorized, registered });
  const contentAccess = createContentAccess(projectAccess.canAccess);
  const privateContent = async (req: http.IncomingMessage, res: http.ServerResponse, requestUrl: URL, mode: 'main' | 'board') => {
    if (!requestUrl.pathname.startsWith('/p/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'Read only'); return true; }
    const match = /^\/p\/([A-Za-z0-9_-]{43})\/(.+)$/.exec(requestUrl.pathname);
    const grant = match ? contentAccess.resolve(match[1]!) : null;
    if (!grant || (mode === 'board' && grant.artifact.type !== 'artboard')) { send(res, 404, 'Not found'); return true; }
    let relative: string;
    try { relative = decodeURIComponent(match![2]!); } catch { send(res, 400, 'Invalid path'); return true; }
    if (relative.split('/').some((part) => !part || part === '.' || part === '..') || relative.includes('\\')) {
      send(res, 404, 'Not found'); return true;
    }
    const mounted = await mountOf(grant.project);
    if (!contentAccess.resolve(match![1]!)) { send(res, 404, 'Not found'); return true; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    mounted.handlePrivateContent(req, res, `${grant.artifact.type}/${grant.artifact.id}/${relative}`, mode);
    return true;
  };
  const authenticated = (req: http.IncomingMessage, url: URL) => Boolean(projectAccess.principal(req, url));
  const visibleProjects = (req: http.IncomingMessage) => projectAccess.visibleProjects(req, ordered().map((p) => p.dir));
  const projectReference = (req: http.IncomingMessage, project: string) =>
    authorized(req, new URL(req.url ?? '/', origin)) ? project : projectId(project);
  const resolveProject = (req: http.IncomingMessage, reference: string) =>
    visibleProjects(req).find((project) => projectReference(req, project) === reference) ?? null;
  const visibleArtifacts = (req: http.IncomingMessage) => artifactList(new Set(visibleProjects(req)));
  const browserArtifacts = (req: http.IncomingMessage): HubArtifactList => {
    const result = visibleArtifacts(req);
    return { ...result,
      projects: result.projects.map((p) => ({ ...p, dir: projectReference(req, p.dir) })),
      artifacts: result.artifacts.map((a) => ({ ...a, project: projectReference(req, a.project) })),
    };
  };
  const fromAgent = (req: http.IncomingMessage, url: URL) =>
    req.headers.origin === undefined && keyOk(url);

  const headerProject = (req: http.IncomingMessage, url: URL) => {
    const value = req.headers[PROJECT_HEADER];
    if (typeof value !== 'string' || !fromAgent(req, url)) return null;
    const decoded = decode(value);
    const dir = decoded === null ? null : realDir(decoded);
    return dir && registered(dir) ? dir : null;
  };

  const projectForPath = (pathname: string): string | null => {
    const content = CONTENT_PATH.exec(pathname);
    if (content) {
      for (const [project, mounted] of ready)
        if (mounted.contentToken === content[1]) return project;
      return null;
    }
    const artifact = ARTIFACT_IN_PATH.exec(pathname);
    if (artifact) {
      const found = index.find(artifact[1] as ArtifactType, artifact[2]!);
      return found?.project ?? null;
    }
    return null;
  };

  const refererProject = (req: http.IncomingMessage) => {
    try {
      const referer = new URL(req.headers.referer ?? '');
      if (referer.host !== req.headers.host) return null;
      const pathname = decode(referer.pathname);
      return pathname === null ? null : projectForPath(pathname);
    } catch {
      return null;
    }
  };

  const decode = (pathname: string) => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return null;
    }
  };

  const route = async (req: http.IncomingMessage, url: URL, pathname: string) => {
    const project =
      headerProject(req, url) ??
      (pathname.startsWith('/api/') ? refererProject(req) : null) ??
      projectForPath(pathname) ??
      refererProject(req) ??
      visibleProjects(req)[0] ??
      null;
    if (!project) return null;
    const identity = projectAccess.principal(req, url);
    if (identity && !projectAccess.canAccess(identity, project)) return null;
    return mountOf(project);
  };

  const openWhenReady = (mounted: MountedProject, request: OpenRequest) => {
    const opener = options.open;
    const { artifact, openCmd } = request;
    if (!opener || !loopback) return;
    let done = false;
    mounted.onArtifactChange((ref, payload) => {
      if (done || (artifact && `${ref.type}/${ref.id}` !== artifact)) return;
      if ('canvas' in payload ? !openReady(payload) : payload.warnings.length > 0) return;
      done = true;
      const local = mounted.linkFor(ref.type, ref.id);
      void opener(local, local, openCmd).catch(() => undefined);
    });
  };

  const register = async (dir: string, open?: OpenRequest) => {
    const real = realDir(dir);
    if (!real) throw new Error(`Project directory not found: ${dir}`);
    return withProjectMutation(real, async () => {
      assertAvailable(real);
      await storageRuntime.arm(members.projectOwner(real));
      assertAvailable(real);
      if (!mounts.has(real)) recoverProjectTrash(real);
      fs.mkdirSync(artifactsRootOf(real), { recursive: true });
      const entry = registerProject(projectsFile, real);
      index.rescan();
      writeCompatInfo(real);
      const mounted = await mountOf(real);
      if (open) openWhenReady(mounted, open);
      return entry;
    });
  };

  const prepareMember = createMemberWorkspace({ home: options.paths.home, members, register, available: (owner) => !recoveryPending(owner), beforeWrite: storageRuntime.arm });

  const remove = async (dir: string) => {
    const real = realDir(dir) ?? path.resolve(dir);
    return withProjectMutation(real, async () => {
      assertAvailable(real);
      shares.revokeProject(real);
      removeProject(projectsFile, real);
      index.rescan();
      fs.rmSync(infoFileOf(real), { force: true });
      const pending = mounts.get(real);
      mounts.delete(real);
      ready.delete(real);
      await (await pending)?.close();
    });
  };

  const logTail = (project: string | null) => {
    try {
      const fd = fs.openSync(options.paths.log, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const length = Math.min(size, LOG_TAIL_BYTES);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, size - length);
        const lines = buffer.toString('utf8').split('\n').filter(Boolean);
        if (length < size) lines.shift();
        return lines.filter((line) => !project || line.includes(project)).slice(-LOG_TAIL_LINES);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return [];
    }
  };

  const handleControl = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const action = url.pathname.slice('/api/hub/'.length);
    if (action === 'log') {
      if (req.method !== 'GET') send(res, 405, 'Method not allowed');
      else sendJson(res, 200, { lines: logTail(url.searchParams.get('project')).map((line) => line.split(options.token).join('[redacted]')) });
      return;
    }
    const control = options.control;
    if (req.method !== 'POST') send(res, 405, 'Method not allowed');
    else if (!control) send(res, 409, 'Not available');
    else if (action === 'stop') {
      sendJson(res, 202, { stopping: true });
      setImmediate(control.stop);
    } else if (control.relaunch()) sendJson(res, 202, { restarting: true });
    else sendJson(res, 409, { error: 'cannot relaunch' });
  };

  const handleHubApi = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<boolean> => {
    if (url.pathname !== '/api/hub/projects') return false;
    const fromPage =
      req.method === 'DELETE' &&
      req.headers.origin !== undefined &&
      authorized(req, url) &&
      originAllowed(policy, req.headers.origin);
    if (!fromAgent(req, url) && !fromPage) {
      send(res, 403, 'Forbidden: agent calls need ?key=');
      return true;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, { projects: ordered() });
      return true;
    }
    const body = (await readBody(req)) as { dir?: unknown; open?: unknown; openCmd?: unknown };
    if (typeof body.dir !== 'string') {
      sendJson(res, 400, { error: 'needs {dir}' });
      return true;
    }
    if (req.method === 'POST') {
      const openCmd = typeof body.openCmd === 'string' && body.openCmd ? body.openCmd : undefined;
      const open =
        body.open === true
          ? { artifact: null, openCmd }
          : typeof body.open === 'string' && ARTIFACT_KEY.test(body.open)
            ? { artifact: body.open, openCmd }
            : undefined;
      const entry = await register(body.dir, open);
      sendJson(res, 200, { project: entry.dir, root: artifactsRootOf(entry.dir) });
    } else if (req.method === 'DELETE') {
      await remove(body.dir);
      sendJson(res, 200, { removed: true });
    } else send(res, 405, 'Method not allowed');
    return true;
  };

  const suspendProject = <T>(project: string, work: () => T | Promise<T>): Promise<T> =>
    suspension.suspend(project, async () => {
      const pending = mounts.get(project);
      if (pending) await (await pending).close();
      mounts.delete(project);
      ready.delete(project);
    }, work, () => { index.rescan(); });
  const quiesceProject = <T>(project: string, work: () => Promise<T>): Promise<T> =>
    suspension.suspend(project, async () => {}, async () => {
      const mounted = mounts.get(project);
      return mounted ? (await mounted).quiesce(work) : work();
    }, () => { index.rescan(); });
  const trashApi = createHubTrash({
    projects: visibleProjects,
    artifacts: (req) => visibleArtifacts(req).artifacts,
    resolveProject,
    projectReference,
    readBody,
    suspend: suspendProject,
    deployment: loopback ? 'local' : 'self-hosted',
    beforeMove: (project, artifact) => { shares.revoke(project, artifact); },
  });
  const trashCleanup = setInterval(() => {
    for (const project of ordered()) {
      if (!available(project.dir)) continue;
      void withProjectMutation(project.dir, async () => { listTrash(project.dir); })
        .catch(() => console.error('Trash retention cleanup failed'));
    }
  }, 60 * 60 * 1000);
  trashCleanup.unref();

  const remoteAuth = createRemoteAuth({
    viewerPages: true,
    home: options.paths.home,
    origin,
    isAdmin: (req, requestUrl) => authorized(req, requestUrl),
    principal: projectAccess.principal,
    projects: (req) => {
      const visible = new Set(visibleProjects(req));
      return remoteProjects().filter((p) => visible.has(p.dir)).map(({ id, name }) => ({ id, name }));
    },
    deviceAllowed: (ownerId, version, projects) => {
      if (ownerId === 'owner') return true;
      const identity = members.principal(Number(ownerId.slice('github:'.length)), version);
      if (!identity) return false;
      const available = new Set(remoteProjects().filter((p) => projectAccess.canAccess(identity, p.dir)).map((p) => p.id));
      return projects.every((id) => available.has(id));
    },
  });
  const usage = createStorageUsage({
    projects: () => [...ordered().map(({ dir }) => ({ dir, owner: members.projectOwner(dir) })), ...members.storageProjects()],
    snapshotsRoot: path.join(storageHome, 'shares/snapshots'),
    snapshots: () => {
      const owners = new Map([...ordered().map(({ dir }) => ({ dir, owner: members.projectOwner(dir) })), ...members.storageProjects()].map(({ dir, owner }) => [dir, owner]));
      return shares.storageSnapshots().map(({ directory, project }) => ({ directory, owner: owners.get(project) }));
    },
    sharedOwner: (owner) => storageBackend.scopeFor(owner) !== owner,
  });
  const writeQuota = createStorageQuota({
    owner: members.projectOwner,
    sharedOwner: (owner) => storageBackend.scopeFor(owner) !== owner,
    measure: usage.measure,
    limits: (owner) => ({
      shared: settings.summary('shared').sharedLimitBytes ?? null,
      personal: owner === 'owner' ? null : members.list().members.find((member) => member.id === owner)?.quotaBytes ?? 0,
    }),
  });
  const runtimeProjects = (owner: string) => [...new Set([
    ...ordered().filter(({ dir }) => members.projectOwner(dir) === owner).map(({ dir }) => dir),
    ...members.storageProjects().filter((entry) => entry.owner === owner).map(({ dir }) => dir),
  ])].sort();
  const maintainRuntime = <T>(owner: string, work: () => Promise<T>, recovering = false) => writeQuota.exclusive(async () => {
    const projects = runtimeProjects(owner);
    const guard = () => {
      if (JSON.stringify(projects) !== JSON.stringify(runtimeProjects(owner))) throw new Error('Storage project ownership changed');
      if (!recovering) for (const project of projects) assertAvailable(project);
    };
    return withProjectMaintenance(projects, quiesceProject, work, guard);
  });
  const planRuntime = (owner: string, scope: string, recovering = false) => planMigrationSources(scope, {
    owner,
    requireExisting: recovering,
    projects: () => [...ordered().map(({ dir }) => ({ dir, owner: members.projectOwner(dir) })), ...members.storageProjects()],
    snapshotsRoot: path.join(storageHome, 'shares/snapshots'), snapshots: shares.storageSnapshots,
    sharedOwner: (member) => storageBackend.scopeFor(member) !== member,
  });
  const remoteApi = createRemoteApi({ authenticate: remoteAuth.authenticate, projects: remoteProjects, mount: mountOf, events: remoteEvents, token: options.token, upload: writeQuota });
  const storageApi = createStorageApi({ settings, usage, recoveryPending, origin, principal: projectAccess.principal, readBody,
    allocation: (owner) => owner !== 'shared' && storageBackend.scopeFor(owner) === owner ? 'personal' : 'shared',
    syncStatus: (owner) => owner === 'shared' ? storageRuntime.scopeStatus('shared') : storageRuntime.status(owner),
    synchronize: (owner) => owner === 'shared' ? storageRuntime.syncScope('shared') : storageRuntime.sync(owner),
    recover: (owner, authorize) => owner === 'shared' ? storageRuntime.recoverScope('shared', authorize) : storageRuntime.recover(owner, authorize),
    backend: (owner) => {
      const scope = owner === 'shared' ? 'shared' : storageBackend.scopeFor(owner);
      return scope === null ? 'local' : storageBackend.summary(scope).backend;
    },
  });
  const migrationProjects = (scope: string) => [...new Set([
    ...ordered().map(({ dir }) => ({ dir, owner: members.projectOwner(dir) })), ...members.storageProjects(),
  ].filter(({ owner }) => scope === 'shared' ? storageBackend.scopeFor(owner) !== owner : owner === scope).map(({ dir }) => dir))].sort();
  const migrationApi = createStorageMigrationApi({ migration, settings, origin, principal: projectAccess.principal, readBody,
    activeJob: (scope) => {
      const binding = storageBackend.bindingFor(scope);
      return binding?.scope === scope ? binding.namespace : null;
    },
    activate: async (scope, jobId, guard) => {
      const owners = scope === 'shared' ? [...new Set(['shared',
        ...migrationProjects(scope).map((project) => members.projectOwner(project)),
        ...storageBackend.ownersFor(scope).filter((owner) => storageBackend.scopeFor(owner) === scope),
      ])] : [scope];
      await storageRuntime.activate(scope, jobId, owners, () => storageBackend.activate(scope, jobId, (plan) => guard(plan.roots), owners));
    },
    maintain: (scope, guard, work) => writeQuota.exclusive(async () => {
      guard();
      if (recoveryPending(scope)) throw new Error('Storage recovery is incomplete');
      const projects = migrationProjects(scope);
      const check = () => {
        guard();
        if (JSON.stringify(projects) !== JSON.stringify(migrationProjects(scope)))
          throw new Error('Migration project ownership changed');
        for (const project of projects) assertAvailable(project);
      };
      return withProjectMaintenance(projects, quiesceProject, async () => {
        const result = await work();
        check();
        return result;
      }, check);
    }),
    plan: async (scope) => {
      if (recoveryPending(scope)) throw new Error('Storage recovery is incomplete');
      return planMigrationSources(scope, {
        projects: () => [...ordered().map(({ dir }) => ({ dir, owner: members.projectOwner(dir) })), ...members.storageProjects()],
        snapshotsRoot: path.join(storageHome, 'shares/snapshots'),
        snapshots: shares.storageSnapshots,
        sharedOwner: (owner) => storageBackend.scopeFor(owner) !== owner,
      });
    },
  });
  const memberApi = createMemberApi({ members, origin, enabled: Boolean(github), owner: authorized, readBody, fetch: options.fetch });
  const browserAuth = createBrowserAuth({ cookieName: `anjian_artifacts_${port}`, token: options.token, origin, loopback, policy, authorized: authenticated, github });
  const publicShares = createPublicShare({ store: shares, origin,
    previewOrigin: options.boardOrigin ?? `http://${urlHostForHttp(options.urlHost)}:${boardPort}`,
    viewerDir: options.viewerDir, runtimeDir: options.runtimeDir, registered });
  const shareApi = createHubShare({ store: shares, origin, authorized: authenticated, readBody, publish: writeQuota,
    resolve: (req, input) => {
      if (typeof input.type !== 'string' || typeof input.id !== 'string' ||
          (input.project !== undefined && typeof input.project !== 'string')) return null;
      const project = typeof input.project === 'string' ? resolveProject(req, input.project) : refererProject(req);
      if (typeof input.project === 'string' && !project) return null;
      if (project && !projectAccess.authorized(req, project)) return null;
      const matches = visibleArtifacts(req).artifacts.filter((a) => a.type === input.type &&
        (a.id === input.id || a.url.split('/').pop() === input.id) && (!project || a.project === project));
      return matches.length === 1 ? matches[0]! : null;
    },
    settle: async (target) => {
      if (target.type === 'document') await (await mountOf(target.project)).settleDocument(target.id);
    },
  });

  front.on('request', (req, res) => {
    void (async () => {
      if (!hostAllowed(policy, req.headers.host)) {
        send(res, 403, 'Forbidden host');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://artifacts.local');
      if (await publicShares(req, res, url)) return;
      if (await privateContent(req, res, url, 'main')) return;
      if (await browserAuth(req, res, url)) return;
      if (await shareApi(req, res, url)) return;
      if (await memberApi(req, res, url)) return;
      if (await storageApi(req, res, url)) return;
      if (await migrationApi(req, res, url)) return;
      if (await remoteAuth.handle(req, res, url)) return;
      if (await remoteApi(req, res, url)) return;
      if (/^\/api\/hub\/trash(?:\/(?:restore|purge))?$/.test(url.pathname)) {
        if (!authenticated(req, url) || !originAllowed(policy, req.headers.origin) ||
            !navigationAllowed(req.headers['sec-fetch-site'] as string | undefined)) sendJson(res, 403, { error: 'Forbidden' });
        else await trashApi(req, res, url.pathname);
        return;
      }
      if (url.pathname === '/api/account') {
        const identity = projectAccess.principal(req, url);
        if (!identity || !originAllowed(policy, req.headers.origin) ||
            !navigationAllowed(req.headers['sec-fetch-site'] as string | undefined)) {
          sendJson(res, 403, { error: 'Forbidden' }); return;
        }
        if (req.method !== 'GET') { send(res, 405, 'Method not allowed'); return; }
        const member = identity.role === 'member' ? members.list().members.find((item) => item.id === identity.id) : null;
        sendJson(res, 200, { role: identity.role, login: member?.login ?? 'Owner',
          ...(member ? { quotaBytes: member.quotaBytes } : {}) });
        return;
      }
      if (url.pathname === '/api/status') {
        if (!authorized(req, url)) send(res, 403, 'Forbidden: agent calls need ?key=');
        else sendJson(res, 200, { ...status(), url: fromAgent(req, url) ? status().url : `${origin}/` });
        return;
      }
      if (CONTROL_PATH.test(url.pathname)) {
        if (!authorized(req, url) || !originAllowed(policy, req.headers.origin))
          send(res, 403, 'Forbidden');
        else handleControl(req, res, url);
        return;
      }
      if (url.pathname === '/api/hub/artifacts') {
        if (!authenticated(req, url) || !originAllowed(policy, req.headers.origin))
          send(res, 403, 'Forbidden');
        else sendJson(res, 200, browserArtifacts(req));
        return;
      }
      lastActivity = Date.now();
      if (await handleHubApi(req, res, url)) return;
      const pathname = decode(url.pathname);
      if (pathname === null) {
        send(res, 400, 'Bad request');
        return;
      }
      const devicePage = pathname === '/devices' || pathname === '/connect' || pathname === '/members' || pathname === '/storage';
      if (pathname === '/members' && !authorized(req, url)) { send(res, 403, 'Forbidden'); return; }
      if (devicePage || (visibleProjects(req).length === 0 && req.method === 'GET' && !pathname.startsWith('/api/'))) {
        if (req.method !== 'GET') { send(res, 405, 'Method not allowed'); return; }
        if (!authenticated(req, url) || !originAllowed(policy, req.headers.origin) ||
            !navigationAllowed(req.headers['sec-fetch-site'] as string | undefined)) {
          send(res, 403, 'Forbidden'); return;
        }
        await serveHubViewer(req, res, {
          viewerDir: options.viewerDir, pathname,
          shell: devicePage || pathname === '/' || pathname === '/index.html',
          boardOrigin: options.boardOrigin,
          cookieName: `anjian_artifacts_${port}`, token: options.token, key: url.searchParams.get('key'),
          secure: origin.startsWith('https:') && req.headers.host?.toLowerCase() === new URL(origin).host.toLowerCase(),
          loopback,
        });
        return;
      }
      const deletedRoute = /^\/(document|artboard|html)\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
      if (deletedRoute && authenticated(req, url) && originAllowed(policy, req.headers.origin) &&
          navigationAllowed(req.headers['sec-fetch-site'] as string | undefined)) {
        const explicitProject = headerProject(req, url);
        const liveProject = projectForPath(pathname);
        const candidates = explicitProject ? [explicitProject] : liveProject ? [] : visibleProjects(req);
        const deleted = candidates.some((project) => findTrashedArtifact(project, deletedRoute[1] as ArtifactType, deletedRoute[2]!));
        if (deleted) {
          send(res, 410, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>作品已移入回收站 · 案间</title><body style="font:16px system-ui;padding:48px;max-width:640px;margin:auto"><h1>作品已移入回收站</h1><p>作品暂时无法访问。保留期内可从回收站恢复；已永久删除的作品无法恢复。</p><a href="/?view=trash">前往回收站</a></body></html>', { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
          return;
        }
      }
      const mounted = await route(req, url, pathname);
      if (!mounted) send(res, 404, 'Not found');
      else if (req.method === 'POST' && /^\/api\/(?:(?:agent\/)?(?:document|artboard)\/[^/]+\/comments|document\/[^/]+\/update)$/.test(pathname)) {
        const project = path.resolve(mounted.root, '../..');
        if (!projectAccess.authorized(req, project) || !originAllowed(policy, req.headers.origin) ||
          !navigationAllowed(req.headers['sec-fetch-site'] as string | undefined)) { send(res, 403, 'Forbidden'); return; }
        await writeQuota(project, (prepare) => withProjectMutation(project, async () => {
          const current = await route(req, url, pathname);
          if (!current || current.root !== mounted.root) { send(res, 403, 'Project access changed'); return; }
          const admit = await prepare();
          await withRequestStorageAdmission(req, admit, () => current.handleRequest(req, res), prepare);
        }));
      }
      else mounted.handleRequest(req, res);
    })().catch((err: Error) => {
      if (!res.headersSent) send(res, closing ? 503 : 500, `Artifacts error: ${err.message}`);
    });
  });

  front.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://artifacts.local');
      const at = url.pathname === '/ws' ? url.searchParams.get('at') : null;
      const pathname = decode(at ?? url.pathname) ?? '/';
      const mounted = await route(req, url, pathname);
      if (!mounted) socket.destroy();
      else mounted.handleUpgrade(req, socket, head);
    })().catch(() => socket.destroy());
  });

  board.on('request', (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://board.local');
      if (url.pathname.startsWith('/s/')) {
        const expected = options.boardOrigin ? new URL(options.boardOrigin).host : null;
        if (expected ? req.headers.host?.toLowerCase() !== expected.toLowerCase() : !hostAllowed(policy, req.headers.host)) {
          send(res, 403, 'Forbidden host'); return;
        }
        if (await publicShares(req, res, url, true)) return;
      }
      if (url.pathname.startsWith('/p/')) {
        const expected = options.boardOrigin ? new URL(options.boardOrigin).host : null;
        if (expected ? req.headers.host?.toLowerCase() !== expected.toLowerCase() : !hostAllowed(policy, req.headers.host)) {
          send(res, 403, 'Forbidden host'); return;
        }
        if (await privateContent(req, res, url, 'board')) return;
      }
      const pathname = decode(url.pathname) ?? '/';
      const boardRoute = routeBoardRequest(req, pathname);
      if (!loopback && boardRoute.kind === 'board') { send(res, 404, 'Not found'); return; }
      const project =
        boardRoute.kind === 'board'
          ? (index.find('artboard', boardRoute.address)?.project ?? null)
          : (ordered().find((entry) => available(entry.dir))?.dir ?? null);
      const mounted = project ? await mountOf(project) : null;
      if (!mounted) send(res, 404, 'Not found');
      else mounted.handleBoardRequest(req, res);
    })().catch((err: Error) => {
      if (!res.headersSent) send(res, 500, err.message);
    });
  });

  for (const entry of ordered()) {
    if (!available(entry.dir)) continue;
    writeCompatInfo(entry.dir);
    if (!isDormant(entry)) void mountOf(entry.dir).catch(() => undefined);
  }
  storageRuntime.start();

  return {
    port,
    boardPort,
    token: options.token,
    url,
    localUrl,
    status,
    projects: ordered,
    mounted: () => [...ready.values()],
    mountOf,
    register,
    remove,
    linkFor: async (project, type, id) => (await mountOf(project)).linkFor(type, id),
    close: async () => {
      closing = true;
      clearInterval(trashCleanup);
      remoteAuth.close();
      await migrationApi.close();
      await storageRuntime.close();
      const stopped = [front, board].map(
        (server) => new Promise((resolve) => server.close(resolve)),
      );
      const all = [...mounts.values()];
      mounts.clear();
      ready.clear();
      await Promise.all(all.map(async (pending) => (await pending.catch(() => null))?.close()));
      for (const entry of ordered()) if (available(entry.dir)) fs.rmSync(infoFileOf(entry.dir), { force: true });
      for (const server of [front, board]) server.closeAllConnections();
      await Promise.all(stopped);
    },
  };
}
