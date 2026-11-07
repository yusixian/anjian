import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { structuralWarnings } from '../shared/validate';
import { parseDocument } from './document-codec';

const ARTIFACT = /^(document|artboard|html)\/([a-z0-9][a-z0-9-]*)$/;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 1_000;
const MAX_PATH_BYTES = 512;
const MAX_DEPTH = 16;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export interface RemoteArtifactSnapshot {
  revision: string | null;
  /** File contents encoded with canonical, padded base64. */
  files: Record<string, string>;
}

export interface RemoteArtifactWrite {
  baseRevision: string | null;
  files: Record<string, string>;
}

export class RemoteTransferError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteTransferError';
  }
}

const invalid = (message: string) => new RemoteTransferError(400, 'invalid_artifact', message);
const tooLarge = (message: string) => new RemoteTransferError(413, 'artifact_too_large', message);
const unsafe = (message: string) => new RemoteTransferError(409, 'unsafe_artifact', message);

function artifactParts(artifact: string) {
  const match = ARTIFACT.exec(artifact);
  if (!match) throw invalid('artifact must be document/<id>, artboard/<id> or html/<id>');
  return { type: match[1] as 'document' | 'artboard' | 'html', id: match[2]! };
}

function validRelative(file: string) {
  if (
    !file ||
    file.startsWith('/') ||
    file.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(file) ||
    Buffer.byteLength(file) > MAX_PATH_BYTES
  ) return false;
  const segments = file.split('/');
  return segments.length <= MAX_DEPTH && segments.every((segment) =>
    segment.length > 0 && segment !== '..' && segment !== '.' && !segment.startsWith('.'),
  );
}

function managed(type: 'document' | 'artboard' | 'html', file: string) {
  if (!validRelative(file)) return false;
  const lower = file.toLowerCase();
  if (lower === 'comments.json') return false;
  if (type === 'document') return file === 'doc.xml' || file.startsWith('assets/');
  if (type === 'artboard')
    return file === 'canvas.json' || file.startsWith('pages/') || file.startsWith('assets/');
  return true;
}

function checkedDir(file: string, allowMissing = false) {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    if (allowMissing && (err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafe(`unsafe directory: ${file}`);
  return true;
}

function pathsFor(projectDir: string, artifact: string) {
  const { type, id } = artifactParts(artifact);
  const project = path.resolve(projectDir);
  checkedDir(project);
  const root = path.join(project, '.anjian');
  const artifacts = path.join(root, 'artifacts');
  const parent = path.join(artifacts, type);
  const dir = path.join(parent, id);
  for (const entry of [root, artifacts, parent, dir]) {
    if (!checkedDir(entry, true)) break;
  }
  return { type, id, root, artifacts, parent, dir };
}

function assertTreeSafe(dir: string, depth = 0) {
  if (depth > MAX_DEPTH) throw tooLarge('artifact directory is too deep');
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
      throw unsafe(`unsafe entry: ${entry.name}`);
    if (entry.isDirectory()) assertTreeSafe(path.join(dir, entry.name), depth + 1);
  }
}

function collect(dir: string, type: 'document' | 'artboard' | 'html') {
  const files = new Map<string, Buffer>();
  let total = 0;
  let entries = 0;
  const folded = new Set<string>();
  const walk = (current: string, prefix = '', depth = 0) => {
    if (depth > MAX_DEPTH) throw tooLarge('artifact directory is too deep');
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (++entries > 10_000) throw tooLarge('artifact has too many entries');
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
        throw unsafe(`unsafe entry: ${entry.name}`);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relative, depth + 1);
        continue;
      }
      if (!managed(type, relative)) continue;
      if (files.size >= MAX_FILES) throw tooLarge('artifact has too many source files');
      const lower = relative.toLowerCase();
      if (folded.has(lower)) throw unsafe(`case-insensitive duplicate: ${relative}`);
      folded.add(lower);
      const file = path.join(current, entry.name);
      const stat = fs.statSync(file);
      if (stat.size > MAX_BYTES - total) throw tooLarge('artifact exceeds 32 MiB');
      const data = fs.readFileSync(file);
      total += data.length;
      if (total > MAX_BYTES) throw tooLarge('artifact exceeds 32 MiB');
      files.set(relative, data);
    }
  };
  walk(dir);
  return files;
}

function digest(files: Map<string, Buffer>) {
  const hash = crypto.createHash('sha256').update('anjian-artifact-v1\0');
  for (const name of [...files.keys()].sort()) {
    const data = files.get(name)!;
    hash.update(String(Buffer.byteLength(name))).update(':').update(name);
    hash.update(String(data.length)).update(':').update(data);
  }
  return `sha256:${hash.digest('hex')}`;
}

function snapshot(files: Map<string, Buffer>, revision: string | null): RemoteArtifactSnapshot {
  return {
    revision,
    files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(
      ([name, data]) => [name, data.toString('base64')],
    )),
  };
}

export function readRemoteArtifact(projectDir: string, artifact: string): RemoteArtifactSnapshot {
  const { dir, type } = pathsFor(projectDir, artifact);
  if (!fs.existsSync(dir)) return { revision: null, files: {} };
  const files = collect(dir, type);
  return snapshot(files, digest(files));
}

function decodeManifest(type: 'document' | 'artboard' | 'html', incoming: unknown) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming))
    throw invalid('files must be a path-to-base64 object');
  const entries = Object.entries(incoming as Record<string, unknown>);
  if (entries.length > MAX_FILES) throw tooLarge('artifact has too many source files');
  const folded = new Set<string>();
  let total = 0;
  const files = new Map<string, Buffer>();
  for (const [name, value] of entries) {
    if (!managed(type, name)) throw invalid(`source file is not allowed: ${name}`);
    const lower = name.toLowerCase();
    if (folded.has(lower)) throw invalid(`case-insensitive duplicate: ${name}`);
    folded.add(lower);
    if (typeof value !== 'string') throw invalid(`invalid base64 content: ${name}`);
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    const estimatedBytes = Math.floor(value.length / 4) * 3 - padding;
    if (estimatedBytes > MAX_BYTES - total || value.length > Math.ceil(MAX_BYTES / 3) * 4)
      throw tooLarge('artifact exceeds 32 MiB');
    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*$/.test(value.slice(0, -padding || undefined)))
      throw invalid(`invalid base64 content: ${name}`);
    const data = Buffer.from(value, 'base64');
    if (data.toString('base64') !== value) throw invalid(`noncanonical base64 content: ${name}`);
    total += data.length;
    if (total > MAX_BYTES) throw tooLarge('artifact exceeds 32 MiB');
    files.set(name, data);
  }
  const required = { document: 'doc.xml', artboard: 'canvas.json', html: 'index.html' }[type];
  if (!files.has(required)) throw invalid(`${required} is required`);
  let primary: string;
  try {
    primary = utf8.decode(files.get(required)!);
  } catch {
    throw invalid(`${required} must be UTF-8`);
  }
  if (type === 'document') {
    try {
      parseDocument(primary);
    } catch (err) {
      throw invalid(`invalid doc.xml: ${(err as Error).message}`);
    }
  }
  if (type === 'artboard') {
    let canvas: unknown;
    try {
      canvas = JSON.parse(primary);
    } catch {
      throw invalid('canvas.json is not valid JSON');
    }
    const warnings = structuralWarnings(canvas);
    if (warnings.length) throw invalid(warnings[0]!);
    const boards = (canvas as { boards: Record<string, { file?: string; src?: string }> }).boards;
    for (const [id, board] of Object.entries(boards)) {
      const file = board.src ?? board.file;
      if (!file || !managed('artboard', file) || !file.startsWith('pages/') || !files.has(file))
        throw invalid(`board ${id} needs its referenced file under pages/`);
    }
  }
  if (type === 'html' && !primary.trim())
    throw invalid('index.html must not be empty');
  return files;
}

function copyPreservingState(source: string, target: string) {
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
}

function removeManaged(dir: string, type: 'document' | 'artboard' | 'html', prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) removeManaged(file, type, relative);
    else if (managed(type, relative)) fs.rmSync(file);
  }
}

/** The caller must serialize writes for one artifact and flush any live document editor first. */
export function writeRemoteArtifact(
  projectDir: string,
  artifact: string,
  incoming: RemoteArtifactWrite,
): RemoteArtifactSnapshot {
  const { dir, parent, type } = pathsFor(projectDir, artifact);
  if (!incoming || (incoming.baseRevision !== null &&
    (typeof incoming.baseRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(incoming.baseRevision))))
    throw invalid('baseRevision must be null or a sha256 revision');
  const files = decodeManifest(type, incoming.files);
  const exists = fs.existsSync(dir);
  const current = exists ? collect(dir, type) : new Map<string, Buffer>();
  const revision = exists ? digest(current) : null;
  if (incoming.baseRevision !== revision)
    throw new RemoteTransferError(409, 'revision_conflict', 'remote artifact changed; pull before pushing again');

  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  // A dot-prefixed sibling stays outside artifact enumeration while files are prepared.
  const staging = fs.mkdtempSync(path.join(parent, '.remote-staging-'));
  const backup = `${staging}.old`;
  let oldMoved = false;
  let installed = false;
  try {
    if (exists) {
      assertTreeSafe(dir);
      copyPreservingState(dir, staging);
    }
    if (exists) removeManaged(staging, type);
    for (const [name, data] of files) {
      const target = path.join(staging, name);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, data, { mode: 0o600, flag: 'wx' });
    }
    // All mutations below are synchronous: file watchers cannot observe the temporary swap.
    if (exists) {
      fs.renameSync(dir, backup);
      oldMoved = true;
    }
    fs.renameSync(staging, dir);
    installed = true;
  } catch (err) {
    if (oldMoved && !installed) fs.renameSync(backup, dir);
    throw err;
  } finally {
    if (!installed && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
  // An old backup is safe to leave for manual cleanup if removal fails after installation.
  if (oldMoved) {
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {}
  }
  return snapshot(files, digest(files));
}
