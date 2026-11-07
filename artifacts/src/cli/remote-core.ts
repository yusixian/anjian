import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CliError, projectPaths } from './paths';

export interface RemoteCredential { token: string; expiresAt: number; deviceId: string; deviceName: string }
export interface RemoteBinding { origin: string; projectId: string; revisions: Record<string, { remote: string; local: string }>; cursor?: string }
interface RemoteConfig { servers: Record<string, RemoteCredential>; bindings: Record<string, RemoteBinding> }
export interface RemoteArtifact { revision: string | null; files: Record<string, string>; url?: string }
const EMPTY = (): RemoteConfig => ({ servers: {}, bindings: {} });
const KEY = /^(?:document|artboard|html)\/[a-z0-9][a-z0-9-]*$/;
const MAX_FILES = 1000;
const MAX_BYTES = 32 * 1024 * 1024;
const NAME = /^[^\\/\u0000-\u001f\u007f]+$/;

export function clientHome() { return process.env.ANJIAN_CLIENT_HOME || path.join(os.homedir(), '.anjian', 'client'); }
export function backupHome() {
  const dir = path.join(clientHome(), 'backups');
  safeParents(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}
const configFile = () => path.join(clientHome(), 'connections.json');
function safeParents(target: string) {
  for (let current = path.resolve(target); current !== path.dirname(current); current = path.dirname(current)) {
    if (!fs.existsSync(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink()) throw new CliError(`Refusing symlink in client state path: ${current}`);
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
  if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o077))
    throw new CliError('Remote client state is readable by other users; chmod 600 the file');
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || !('servers' in value) || !('bindings' in value)) throw new Error();
    return value as RemoteConfig;
  } catch { throw new CliError('Remote client state is invalid'); }
}
function lockFile(name: string) {
  const digest = createHash('sha256').update(name).digest('hex');
  return path.join(clientHome(), `.lock-${digest}`);
}
function pidAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}
function acquireLock(name: string) {
  ensureHome();
  const file = lockFile(name);
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() })); }
      finally { fs.closeSync(fd); }
      return () => { try { fs.unlinkSync(file); } catch { /* already removed */ } };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) throw new CliError('Refusing symlink lock file');
        const lock = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number; createdAt?: number };
        // A live owner can legitimately hold a long transfer; never steal its lock.
        if (stat.mtimeMs < Date.now() - 60_000 && typeof lock.pid === 'number' && !pidAlive(lock.pid)) {
          fs.unlinkSync(file);
          continue;
        }
      } catch (readErr) {
        if (readErr instanceof CliError) throw readErr;
        if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') continue;
      }
      if (Date.now() >= deadline) throw new CliError('Another Anjian command is updating this project; retry after it finishes');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
}
const localLocks = new Map<string, Promise<unknown>>();
export async function withArtifactLock<T>(dir: string, artifact: string, work: () => Promise<T>): Promise<T> {
  const key = `artifact:${projectKey(dir)}:${artifact}`;
  const prior = localLocks.get(key) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(async () => {
    const unlock = acquireLock(key);
    try { return await work(); } finally { unlock(); }
  });
  localLocks.set(key, current);
  try { return await current; } finally { if (localLocks.get(key) === current) localLocks.delete(key); }
}
export function updateConfig(update: (config: RemoteConfig) => void) {
  const unlock = acquireLock('config');
  try {
    const config = readConfig();
    update(config);
    const file = configFile();
    const temp = path.join(clientHome(), `.connections-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    try { fs.renameSync(temp, file); fs.chmodSync(file, 0o600); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  } finally { unlock(); }
}
export function projectKey(dir: string) { return projectPaths(dir).project; }
export function bindingFor(dir: string) {
  const project = projectKey(dir);
  const config = readConfig();
  const binding = config.bindings[project];
  if (!binding) throw new CliError(`This directory is not linked. Run anjian link --project-dir ${project}`);
  const credential = config.servers[binding.origin];
  if (!credential) throw new CliError(`No credential for ${binding.origin}. Run anjian login ${binding.origin}`);
  if (credential.expiresAt <= Date.now()) throw new CliError(`Device authorization expired for ${binding.origin}; log in again`);
  return { project, binding, credential };
}
export function normalizeOrigin(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new CliError('Use an HTTPS server origin, for example https://anjian.example.com'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new CliError('Server address must be an HTTPS origin without path, credentials or query');
  return url.origin;
}
export function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  execFile(command, args, () => {});
}
export async function request(origin: string, route: string, options: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {}) {
  if (!route.startsWith('/') || route.startsWith('//')) throw new CliError('Invalid remote API path');
  let res: Response;
  try {
    res = await fetch(`${origin}${route}`, {
      method: options.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
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
  try { json = (await res.json()) as Record<string, any>; } catch { /* empty responses */ }
  return { status: res.status, json, retryAfter: Number(res.headers.get('Retry-After') || '0') };
}
export async function authenticatedRequest(dir: string, route: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
  const { binding, credential } = bindingFor(dir);
  const result = await request(binding.origin, route, { ...options, token: credential.token });
  if (result.status === 401 || result.status === 403) throw new CliError(`Remote authorization was denied by ${binding.origin}; log in again or check device access`);
  return result;
}
export function artifactRoute(binding: RemoteBinding, artifact: string) {
  if (!KEY.test(artifact)) throw new CliError('--artifact must be document/<id>, artboard/<id> or html/<id>');
  return `/api/remote/projects/${encodeURIComponent(binding.projectId)}/artifacts/${artifact}`;
}
function validName(name: string, type: string): boolean {
  const parts = name.split('/');
  if (!parts.every((part) => NAME.test(part) && part !== '.' && part !== '..' && !part.startsWith('.'))) return false;
  if (Buffer.byteLength(name) > 512 || parts.length > 16) return false;
  if (name === 'comments.json' || name.includes('/comments.json')) return false;
  if (type === 'document') return name === 'doc.xml' || (parts[0] === 'assets' && parts.length >= 2);
  if (type === 'artboard') return name === 'canvas.json' || ((parts[0] === 'pages' || parts[0] === 'assets') && parts.length >= 2);
  return name === 'index.html' || parts.length >= 1;
}
function artifactDir(projectDir: string, artifact: string) {
  if (!KEY.test(artifact)) throw new CliError('Invalid artifact');
  return path.join(projectPaths(projectDir).root, artifact);
}
function checkDirectory(root: string, candidate: string) {
  for (let target = root; target !== path.dirname(target); target = path.dirname(target)) {
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new CliError('Refusing symlink in artifact path');
  }
  for (const segment of path.relative(root, candidate).split(path.sep)) {
    if (!segment || segment === '.') continue;
    root = path.join(root, segment);
    if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new CliError('Refusing symlink in artifact path');
  }
}
export function validateFiles(artifact: string, files: Record<string, string>) {
  if (!KEY.test(artifact) || !files || typeof files !== 'object' || Array.isArray(files)) throw new CliError('Invalid artifact manifest');
  const type = artifact.split('/')[0]!;
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) throw new CliError('Artifact contains too many files');
  let bytes = 0;
  const names = new Set<string>();
  for (const [name, encoded] of entries) {
    if (!validName(name, type) || names.has(name.toLowerCase()) || typeof encoded !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
      throw new CliError(`Invalid artifact file: ${name}`);
    names.add(name.toLowerCase());
    bytes += Buffer.byteLength(encoded, 'base64');
    if (bytes > MAX_BYTES) throw new CliError('Artifact exceeds the 32 MiB transfer limit');
  }
  const required = type === 'document' ? 'doc.xml' : type === 'artboard' ? 'canvas.json' : 'index.html';
  if (entries.length && !Object.hasOwn(files, required)) throw new CliError(`Artifact needs ${required}`);
}
export function localFiles(projectDir: string, artifact: string): Record<string, string> {
  const dir = artifactDir(projectDir, artifact);
  checkDirectory(dir, dir);
  if (!fs.existsSync(dir)) return {};
  if (!fs.statSync(dir).isDirectory()) throw new CliError('Artifact path is not a directory');
  const files: Record<string, string> = Object.create(null);
  let count = 0, bytes = 0;
  const visit = (relative: string) => {
    const absolute = path.join(dir, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && ['assets', 'pages'].includes(name)) { visit(name); continue; }
      if (!validName(name, artifact.split('/')[0]!)) continue;
      if (entry.isSymbolicLink()) throw new CliError(`Refusing symlink: ${name}`);
      if (entry.isDirectory()) { visit(name); continue; }
      if (!entry.isFile()) throw new CliError(`Refusing non-file: ${name}`);
      const data = fs.readFileSync(path.join(dir, name));
      if (++count > MAX_FILES || (bytes += data.length) > MAX_BYTES) throw new CliError('Artifact exceeds transfer limit');
      files[name] = data.toString('base64');
    }
  };
  visit(''); validateFiles(artifact, files); return files;
}
export function filesHash(files: Record<string, string>): string {
  const hash = createHash('sha256');
  for (const [name, value] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(name); hash.update('\0'); hash.update(value); hash.update('\0');
  }
  return hash.digest('hex');
}
export function applyLocalFiles(projectDir: string, artifact: string, files: Record<string, string>, expectedLocalHash?: string) {
  validateFiles(artifact, files);
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
      const temp = path.join(path.dirname(target), `.${path.basename(target)}.anjian-transfer-${process.pid}.tmp`);
      fs.writeFileSync(temp, Buffer.from(encoded, 'base64'), { flag: 'wx' });
      temps.push(temp);
    }
    if (expectedLocalHash !== undefined && filesHash(localFiles(projectDir, artifact)) !== expectedLocalHash)
      throw new CliError(`${artifact} changed locally during transfer; no files were replaced`);
    committed = true;
    for (const relative of Object.keys(before)) {
      if (!Object.hasOwn(files, relative)) fs.unlinkSync(path.join(dir, relative));
    }
    for (const relative of Object.keys(files)) {
      const target = path.join(dir, relative);
      fs.renameSync(path.join(path.dirname(target), `.${path.basename(target)}.anjian-transfer-${process.pid}.tmp`), target);
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
export function saveRevision(dir: string, artifact: string, remote: string, local: string, expected: Pick<RemoteBinding, 'origin' | 'projectId'>) {
  const project = projectKey(dir);
  updateConfig((config) => {
    const binding = config.bindings[project];
    if (!binding || binding.origin !== expected.origin || binding.projectId !== expected.projectId)
      throw new CliError('Project binding changed during transfer; remote write may have succeeded, relink before retrying');
    binding.revisions[artifact] = { remote, local };
  });
}
export function sleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
export type { RemoteConfig };
