import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MAX_SLIDE_DECK_BYTES, parseSlideDeck, SLIDE_DECK_FILE } from '../shared/slides';
import {
  MAX_STORYBOARD_ASSET_BYTES,
  MAX_STORYBOARD_ASSETS,
  MAX_STORYBOARD_TIMELINE_BYTES,
  missingStoryboardAsset,
  parseStoryboard,
  STORYBOARD_FILE,
  storyboardAssetKind,
} from '../shared/storyboard';
import type { ArtifactType } from '../shared/types';
import { MAX_WHITEBOARD_SCENE_BYTES, MAX_WHITEBOARD_SOURCE_BYTES, WHITEBOARD_PAGES_FILE, WHITEBOARD_SCENE_FILE } from '../shared/whiteboard';
import { declaredWhiteboardPageFiles, isWhiteboardSourceFile, whiteboardSourceProblem } from '../shared/whiteboard-source';
import { CliError, projectPaths } from './paths';
import { remoteGuide } from './skills';

export interface RemoteCredential {
  deviceId: string;
  deviceName: string;
  expiresAt: number;
  token: string;
}
export interface RemoteBinding {
  cursor?: string;
  origin: string;
  projectId: string;
  revisions: Record<string, { remote: string; local: string }>;
}
interface RemoteConfig {
  bindings: Record<string, RemoteBinding>;
  servers: Record<string, RemoteCredential>;
}
export interface RemoteArtifact {
  files: Record<string, string>;
  revision: string | null;
  url?: string;
}
const EMPTY = (): RemoteConfig => ({ servers: {}, bindings: {} });
const KEY = /^(?:document|artboard|html|slides|storyboard|whiteboard)\/[a-z0-9][a-z0-9-]*$/;
const PRIMARY_FILES: Record<ArtifactType, string> = {
  document: 'doc.xml',
  artboard: 'canvas.json',
  html: 'index.html',
  slides: SLIDE_DECK_FILE,
  storyboard: STORYBOARD_FILE,
  whiteboard: WHITEBOARD_SCENE_FILE,
};
const MAX_FILES = 1000;
const MAX_BYTES = 32 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const sourceLimit = (type: ArtifactType) =>
  type === 'whiteboard' ? MAX_WHITEBOARD_SOURCE_BYTES : MAX_BYTES;
// eslint-disable-next-line no-control-regex -- Remote filenames must reject C0 controls and DEL as well as path separators.
const NAME = /^[^\\/\u0000-\u001F\u007F]+$/;

export function clientHome() {
  return process.env.ANJIAN_CLIENT_HOME || path.join(os.homedir(), '.anjian', 'client');
}
export function backupHome() {
  const dir = path.join(clientHome(), 'backups');
  safeParents(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}
const configFile = () => path.join(clientHome(), 'connections.json');
function safeParents(target: string) {
  for (
    let current = path.resolve(target);
    current !== path.dirname(current);
    current = path.dirname(current)
  ) {
    if (!fs.existsSync(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink())
      throw new CliError(`Refusing symlink in client state path: ${current}`);
  }
}
function ensureHome() {
  const home = clientHome();
  safeParents(home);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.chmodSync(home, 0o700);
}
export function readConfig(): RemoteConfig {
  const file = configFile();
  safeParents(file);
  if (!fs.existsSync(file)) return EMPTY();
  if (!fs.statSync(file).isFile()) throw new CliError('Remote client state is not a regular file');
  if (process.platform !== 'win32' && fs.statSync(file).mode & 0o077)
    throw new CliError('Remote client state is readable by other users; chmod 600 the file');
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || !('servers' in value) || !('bindings' in value))
      throw new Error('Remote client state must be an object with servers and bindings');
    return value as RemoteConfig;
  } catch {
    throw new CliError('Remote client state is invalid');
  }
}
function lockFile(name: string) {
  const digest = createHash('sha256').update(name).digest('hex');
  return path.join(clientHome(), `.lock-${digest}`);
}
function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
function acquireLock(name: string) {
  ensureHome();
  const file = lockFile(name);
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      } finally {
        fs.closeSync(fd);
      }
      return () => {
        try {
          fs.unlinkSync(file);
        } catch {
          /* already removed */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) throw new CliError('Refusing symlink lock file');
        const lock = JSON.parse(fs.readFileSync(file, 'utf8')) as {
          pid?: number;
          createdAt?: number;
        };
        // A live owner can legitimately hold a long transfer; never steal its lock.
        if (
          stat.mtimeMs < Date.now() - 60_000 &&
          typeof lock.pid === 'number' &&
          !pidAlive(lock.pid)
        ) {
          fs.unlinkSync(file);
          continue;
        }
      } catch (readErr) {
        if (readErr instanceof CliError) throw readErr;
        if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') continue;
      }
      if (Date.now() >= deadline)
        throw new CliError(
          'Another Anjian command is updating this project; retry after it finishes',
        );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
}
const localLocks = new Map<string, Promise<unknown>>();
export async function withArtifactLock<T>(
  dir: string,
  artifact: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = `artifact:${projectKey(dir)}:${artifact}`;
  const prior = localLocks.get(key) ?? Promise.resolve();
  const current = prior
    .catch(() => undefined)
    .then(async () => {
      const unlock = acquireLock(key);
      try {
        return await work();
      } finally {
        unlock();
      }
    });
  localLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (localLocks.get(key) === current) localLocks.delete(key);
  }
}
export function updateConfig(update: (config: RemoteConfig) => void) {
  const unlock = acquireLock('config');
  try {
    const config = readConfig();
    update(config);
    const file = configFile();
    const temp = path.join(clientHome(), `.connections-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    try {
      fs.renameSync(temp, file);
      fs.chmodSync(file, 0o600);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  } finally {
    unlock();
  }
}
export function projectKey(dir: string) {
  return projectPaths(dir).project;
}
export function bindingFor(dir: string) {
  const project = projectKey(dir);
  const config = readConfig();
  const binding = config.bindings[project];
  if (!binding)
    throw new CliError(`This directory is not linked. Run anjian link --project-dir ${project}`, {
      nextStep: remoteGuide(),
    });
  const credential = config.servers[binding.origin];
  if (!credential)
    throw new CliError(`No credential for ${binding.origin}. Run anjian login ${binding.origin}`, {
      nextStep: remoteGuide(),
    });
  if (credential.expiresAt <= Date.now())
    throw new CliError(`Device authorization expired for ${binding.origin}; log in again`, {
      nextStep: remoteGuide(),
    });
  return { project, binding, credential };
}
export function normalizeOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError('Use an HTTPS server origin, for example https://anjian.example.com');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new CliError('Server address must be an HTTPS origin without path, credentials or query');
  return url.origin;
}
export function openBrowser(url: string) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  execFile(command, args, () => {});
}
export async function request(
  origin: string,
  route: string,
  options: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {},
) {
  if (!route.startsWith('/') || route.startsWith('//'))
    throw new CliError('Invalid remote API path');
  let res: Response;
  try {
    res = await fetch(`${origin}${route}`, {
      method: options.method ?? 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    throw new CliError(`Could not reach ${origin}: ${(err as Error).message}`);
  }
  let json: Record<string, any> = {};
  try {
    json = (await res.json()) as Record<string, any>;
  } catch {
    /* empty responses */
  }
  return { status: res.status, json, retryAfter: Number(res.headers.get('Retry-After') || '0') };
}
export async function authenticatedRequest(
  dir: string,
  route: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
) {
  const { binding, credential } = bindingFor(dir);
  const result = await request(binding.origin, route, { ...options, token: credential.token });
  if (result.status === 401 || result.status === 403)
    throw new CliError(
      `Remote authorization was denied by ${binding.origin}; log in again or check device access`,
    );
  return result;
}
export function artifactRoute(binding: RemoteBinding, artifact: string) {
  if (!KEY.test(artifact))
    throw new CliError('--artifact must be document/<id>, artboard/<id>, html/<id>, slides/<id>, storyboard/<id> or whiteboard/<id>');
  return `/api/remote/projects/${encodeURIComponent(binding.projectId)}/artifacts/${artifact}`;
}
function validName(name: string, type: ArtifactType): boolean {
  const parts = name.split('/');
  if (
    !parts.every(
      (part) => NAME.test(part) && part !== '.' && part !== '..' && !part.startsWith('.'),
    )
  )
    return false;
  if (Buffer.byteLength(name) > 512 || parts.length > 16) return false;
  if (name === 'comments.json' || name.includes('/comments.json')) return false;
  if (type === 'slides') return name === SLIDE_DECK_FILE;
  if (type === 'storyboard') return name === STORYBOARD_FILE || storyboardAssetKind(name) !== null;
  if (type === 'document')
    return name === 'doc.xml' || (parts[0] === 'assets' && parts.length >= 2);
  if (type === 'artboard')
    return (
      name === 'canvas.json' ||
      ((parts[0] === 'pages' || parts[0] === 'assets') && parts.length >= 2)
    );
  if (type === 'whiteboard') return isWhiteboardSourceFile(name);
  return name === 'index.html' || parts.length >= 1;
}
function artifactDir(projectDir: string, artifact: string) {
  if (!KEY.test(artifact)) throw new CliError('Invalid artifact');
  return path.join(projectPaths(projectDir).root, artifact);
}
function checkDirectory(root: string, candidate: string) {
  for (let target = root; target !== path.dirname(target); target = path.dirname(target)) {
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
      throw new CliError('Refusing symlink in artifact path');
  }
  for (const segment of path.relative(root, candidate).split(path.sep)) {
    if (!segment || segment === '.') continue;
    root = path.join(root, segment);
    if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink())
      throw new CliError('Refusing symlink in artifact path');
  }
}
export function validateFiles(artifact: string, files: Record<string, string>) {
  validateManifest(artifact, files);
  if (artifact.startsWith('whiteboard/') && Object.keys(files).length) {
    const problem = whiteboardSourceProblem(new Set(Object.keys(files)), (name) =>
      utf8.decode(Buffer.from(files[name]!, 'base64')),
    );
    if (problem) throw new CliError(problem);
    return;
  }
  const slides = artifact.startsWith('slides/');
  const storyboard = artifact.startsWith('storyboard/');
  const file = slides ? SLIDE_DECK_FILE : STORYBOARD_FILE;
  if ((!slides && !storyboard) || !Object.hasOwn(files, file)) return;
  const encoded = files[file]!;
  if (slides && Buffer.byteLength(encoded, 'base64') > MAX_SLIDE_DECK_BYTES)
    throw new CliError(`${SLIDE_DECK_FILE} exceeds 2 MiB`);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new CliError(`Invalid base64 content: ${file}`);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CliError(`${file} must contain valid UTF-8 JSON`);
  }
  if (slides && !parseSlideDeck(value))
    throw new CliError(`${SLIDE_DECK_FILE} does not match the slide deck schema`);
  if (storyboard) {
    const timeline = parseStoryboard(value);
    if (!timeline) throw new CliError(`${file} does not match the storyboard schema`);
    const missing = missingStoryboardAsset(timeline, new Set(Object.keys(files)));
    if (missing) throw new CliError(`Missing storyboard asset: ${missing}`);
  }
}

function checkStoryboardSize(type: string, name: string, size: number) {
  if (type !== 'storyboard') return;
  const limit = name === STORYBOARD_FILE ? MAX_STORYBOARD_TIMELINE_BYTES : MAX_STORYBOARD_ASSET_BYTES;
  if (size > limit) throw new CliError(`${name} exceeds the storyboard file limit`);
}

function validateManifest(artifact: string, files: Record<string, string>) {
  if (!KEY.test(artifact) || !files || typeof files !== 'object' || Array.isArray(files))
    throw new CliError('Invalid artifact manifest');
  const type = artifact.split('/')[0] as ArtifactType;
  const maxBytes = sourceLimit(type);
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) throw new CliError('Artifact contains too many files');
  if (type === 'storyboard' && entries.length > MAX_STORYBOARD_ASSETS + 1)
    throw new CliError('Storyboard has too many media files');
  let bytes = 0;
  const names = new Set<string>();
  for (const [name, encoded] of entries) {
    if (
      !validName(name, type) ||
      names.has(name.toLowerCase()) ||
      typeof encoded !== 'string' ||
      encoded.length % 4 !== 0
    )
      throw new CliError(`Invalid artifact file: ${name}`);
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    if (/[^A-Z0-9+/]/i.test(encoded.slice(0, encoded.length - padding)))
      throw new CliError(`Invalid artifact file: ${name}`);
    const size = encoded.length / 4 * 3 - padding;
    checkStoryboardSize(type, name, size);
    names.add(name.toLowerCase());
    if (type === 'whiteboard' && size > MAX_WHITEBOARD_SCENE_BYTES)
      throw new CliError(`${name} exceeds the 16 MiB whiteboard file limit`);
    bytes += size;
    if (bytes > maxBytes) throw new CliError('Artifact exceeds the 32 MiB transfer limit');
  }
  const required = PRIMARY_FILES[type];
  if (entries.length && !Object.hasOwn(files, required))
    throw new CliError(`Artifact needs ${required}`);
}
function readWhiteboardManifest(dir: string) {
  const file = path.join(dir, WHITEBOARD_PAGES_FILE);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile()) throw new CliError(`Expected a whiteboard source file: ${WHITEBOARD_PAGES_FILE}`);
  if (stat.size > MAX_WHITEBOARD_SCENE_BYTES)
    throw new CliError(`${WHITEBOARD_PAGES_FILE} exceeds the 16 MiB whiteboard file limit`);
  return fs.readFileSync(file);
}

export function localFiles(projectDir: string, artifact: string): Record<string, string> {
  const dir = artifactDir(projectDir, artifact);
  checkDirectory(dir, dir);
  if (!fs.existsSync(dir)) return {};
  if (!fs.statSync(dir).isDirectory()) throw new CliError('Artifact path is not a directory');
  const files: Record<string, string> = Object.create(null);
  const type = artifact.split('/')[0] as ArtifactType;
  const manifest = type === 'whiteboard' ? readWhiteboardManifest(dir) : undefined;
  const declared = type === 'whiteboard' ? declaredWhiteboardPageFiles(manifest) : null;
  const maxBytes = sourceLimit(type);
  let count = 0,
    bytes = 0;
  const visit = (relative: string) => {
    const absolute = path.join(dir, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (type === 'storyboard' && name === 'assets' && !entry.isDirectory())
        throw new CliError('Expected a storyboard assets directory');
      if (type === 'whiteboard') {
        const lower = name.toLowerCase();
        if (lower !== name && (lower === 'pages' || isWhiteboardSourceFile(lower)))
          throw new CliError(`Invalid whiteboard path: ${name}`);
        if (name === 'pages') {
          if (!entry.isDirectory()) throw new CliError('Expected a whiteboard pages directory');
          visit(name);
          continue;
        }
      }
      if (type !== 'whiteboard' && type !== 'slides' && entry.isDirectory() && ['assets', 'pages'].includes(name) &&
          (type !== 'storyboard' || name === 'assets')) {
        visit(name);
        continue;
      }
      if (!validName(name, type)) continue;
      if (entry.isSymbolicLink()) throw new CliError(`Refusing symlink: ${name}`);
      if (entry.isDirectory()) {
        if (type === 'whiteboard' || type === 'slides' || type === 'storyboard')
          throw new CliError(`Expected a source file: ${name}`);
        visit(name);
        continue;
      }
      if (!entry.isFile()) throw new CliError(`Refusing non-file: ${name}`);
      if (declared && name.startsWith('pages/') && !declared.has(name)) continue;
      const file = path.join(dir, name);
      if (type === 'storyboard') {
        if (count >= MAX_STORYBOARD_ASSETS + 1) throw new CliError('Storyboard has too many media files');
        const size = fs.statSync(file).size;
        checkStoryboardSize(type, name, size);
        if (size > maxBytes - bytes) throw new CliError('Artifact exceeds the 32 MiB transfer limit');
      }
      if (type === 'whiteboard') {
        const size = fs.statSync(file).size;
        if (size > MAX_WHITEBOARD_SCENE_BYTES)
          throw new CliError(`${name} exceeds the 16 MiB whiteboard file limit`);
        if (size > maxBytes - bytes) throw new CliError('Artifact exceeds the 32 MiB transfer limit');
      }
      const data = name === WHITEBOARD_PAGES_FILE && manifest ? manifest : fs.readFileSync(file);
      if (++count > MAX_FILES || (bytes += data.length) > maxBytes)
        throw new CliError('Artifact exceeds transfer limit');
      files[name] = data.toString('base64');
    }
  };
  visit('');
  // Preserve malformed source bytes for an explicit pull backup.
  validateManifest(artifact, files);
  return files;
}
export function filesHash(files: Record<string, string>): string {
  const hash = createHash('sha256');
  for (const [name, value] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(name);
    hash.update('\0');
    hash.update(value);
    hash.update('\0');
  }
  return hash.digest('hex');
}
export function applyLocalFiles(
  projectDir: string,
  artifact: string,
  files: Record<string, string>,
  expectedLocalHash?: string,
) {
  validateFiles(artifact, files);
  if (Object.keys(files).length === 0)
    throw new CliError('Refusing to replace local files with an empty artifact');
  const dir = artifactDir(projectDir, artifact);
  checkDirectory(dir, dir);
  const before = localFiles(projectDir, artifact);
  if (expectedLocalHash !== undefined && filesHash(before) !== expectedLocalHash)
    throw new CliError(`${artifact} changed locally during transfer; no files were replaced`);
  const temps: string[] = [];
  let committed = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const [relative, encoded] of Object.entries(files)) {
      const target = path.join(dir, relative);
      checkDirectory(dir, target);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = path.join(
        path.dirname(target),
        `.${path.basename(target)}.anjian-transfer-${process.pid}.tmp`,
      );
      fs.writeFileSync(temp, Buffer.from(encoded, 'base64'), { flag: 'wx' });
      temps.push(temp);
    }
    if (
      expectedLocalHash !== undefined &&
      filesHash(localFiles(projectDir, artifact)) !== expectedLocalHash
    )
      throw new CliError(`${artifact} changed locally during transfer; no files were replaced`);
    if (artifact.startsWith('whiteboard/')) {
      for (const relative of Object.keys(files)) {
        if (!Object.hasOwn(before, relative) &&
            fs.lstatSync(path.join(dir, relative), { throwIfNoEntry: false }))
          throw new CliError(`Unlisted whiteboard file already exists: ${relative}`);
      }
    }
    committed = true;
    for (const relative of Object.keys(before)) {
      if (!Object.hasOwn(files, relative)) fs.unlinkSync(path.join(dir, relative));
    }
    for (const relative of Object.keys(files)) {
      const target = path.join(dir, relative);
      fs.renameSync(
        path.join(
          path.dirname(target),
          `.${path.basename(target)}.anjian-transfer-${process.pid}.tmp`,
        ),
        target,
      );
    }
  } catch (err) {
    for (const temp of temps) if (fs.existsSync(temp)) fs.unlinkSync(temp);
    if (!committed) throw err;
    for (const relative of Object.keys(files)) {
      if (!Object.hasOwn(before, relative)) {
        const target = path.join(dir, relative);
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
    }
    for (const [relative, encoded] of Object.entries(before)) {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(encoded, 'base64'));
    }
    throw err;
  }
}
export function saveRevision(
  dir: string,
  artifact: string,
  remote: string,
  local: string,
  expected: Pick<RemoteBinding, 'origin' | 'projectId'>,
) {
  const project = projectKey(dir);
  updateConfig((config) => {
    const binding = config.bindings[project];
    if (!binding || binding.origin !== expected.origin || binding.projectId !== expected.projectId)
      throw new CliError(
        'Project binding changed during transfer; remote write may have succeeded, relink before retrying',
      );
    binding.revisions[artifact] = { remote, local };
  });
}
export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
export type { RemoteConfig };
