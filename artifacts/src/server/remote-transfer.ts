import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { mintArtifactId } from '../shared/ids';
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
import { structuralWarnings } from '../shared/validate';
import { parseDocument } from './document-codec';

const ARTIFACT = /^(document|artboard|html|slides|storyboard)\/([a-z0-9][a-z0-9-]*)$/;
const MAX_BYTES = 32 * 1024 * 1024;
const PRIMARY_FILE: Record<ArtifactType, string> = {
  document: 'doc.xml',
  artboard: 'canvas.json',
  html: 'index.html',
  slides: SLIDE_DECK_FILE,
  storyboard: STORYBOARD_FILE,
};
const MAX_FILES = 1_000;
const MAX_PATH_BYTES = 512;
const MAX_DEPTH = 16;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export interface RemoteArtifactSnapshot {
  /** File contents encoded with canonical, padded base64. */
  files: Record<string, string>;
  revision: string | null;
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
  if (!match) throw invalid('artifact must be document/<id>, artboard/<id>, html/<id>, slides/<id> or storyboard/<id>');
  return { type: match[1] as ArtifactType, id: match[2]! };
}

function validRelative(file: string) {
  if (
    !file ||
    file.startsWith('/') ||
    file.includes('\\') ||
    // Reject control characters in artifact paths, including NUL.
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1F\x7F]/.test(file) ||
    Buffer.byteLength(file) > MAX_PATH_BYTES
  )
    return false;
  const segments = file.split('/');
  return (
    segments.length <= MAX_DEPTH &&
    segments.every(
      (segment) =>
        segment.length > 0 && segment !== '..' && segment !== '.' && !segment.startsWith('.'),
    )
  );
}

function managed(type: ArtifactType, file: string) {
  if (!validRelative(file)) return false;
  const lower = file.toLowerCase();
  if (lower === 'comments.json') return false;
  if (type === 'slides') return file === SLIDE_DECK_FILE;
  if (type === 'storyboard') return file === STORYBOARD_FILE || storyboardAssetKind(file) !== null;
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

function checkStoryboardSize(type: ArtifactType, name: string, size: number) {
  if (type !== 'storyboard') return;
  const limit = name === STORYBOARD_FILE ? MAX_STORYBOARD_TIMELINE_BYTES : MAX_STORYBOARD_ASSET_BYTES;
  if (size > limit) throw tooLarge(`${name} exceeds the storyboard file limit`);
}

function collect(dir: string, type: ArtifactType) {
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
        if ((type === 'slides' || type === 'storyboard') && managed(type, relative))
          throw unsafe(`expected a regular file: ${relative}`);
        walk(path.join(current, entry.name), relative, depth + 1);
        continue;
      }
      if (!managed(type, relative)) continue;
      if (files.size >= MAX_FILES) throw tooLarge('artifact has too many source files');
      if (type === 'storyboard' && files.size >= MAX_STORYBOARD_ASSETS + 1)
        throw tooLarge('Storyboard has too many media files');
      const lower = relative.toLowerCase();
      if (folded.has(lower)) throw unsafe(`case-insensitive duplicate: ${relative}`);
      folded.add(lower);
      const file = path.join(current, entry.name);
      const stat = fs.statSync(file);
      if (stat.size > MAX_BYTES - total) throw tooLarge('artifact exceeds 32 MiB');
      checkStoryboardSize(type, relative, stat.size);
      const data = fs.readFileSync(file);
      checkStoryboardSize(type, relative, data.length);
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
    hash
      .update(String(Buffer.byteLength(name)))
      .update(':')
      .update(name);
    hash.update(String(data.length)).update(':').update(data);
  }
  return `sha256:${hash.digest('hex')}`;
}

function snapshot(files: Map<string, Buffer>, revision: string | null): RemoteArtifactSnapshot {
  return {
    revision,
    files: Object.fromEntries(
      [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, data]) => [name, data.toString('base64')]),
    ),
  };
}

export function readRemoteArtifact(projectDir: string, artifact: string): RemoteArtifactSnapshot {
  const { dir, type } = pathsFor(projectDir, artifact);
  if (!fs.existsSync(dir)) return { revision: null, files: {} };
  const files = collect(dir, type);
  // Mounting can create metadata before the first source file is uploaded.
  if (files.size === 0) return { revision: null, files: {} };
  const primary = PRIMARY_FILE[type];
  const source = files.get(primary);
  if (!source) throw unsafe(`artifact is missing ${primary}`);
  if (type === 'slides') validateSlideDeck(source);
  if (type === 'storyboard') validateStoryboard(source, files);
  return snapshot(files, digest(files));
}

function validateSlideDeck(source: Buffer) {
  if (source.length > MAX_SLIDE_DECK_BYTES) throw tooLarge(`${SLIDE_DECK_FILE} exceeds 2 MiB`);
  let value: unknown;
  try {
    value = JSON.parse(utf8.decode(source));
  } catch {
    throw invalid(`${SLIDE_DECK_FILE} must contain valid UTF-8 JSON`);
  }
  if (!parseSlideDeck(value)) throw invalid(`${SLIDE_DECK_FILE} does not match the slide deck schema`);
}

function validateStoryboard(source: Buffer, files: ReadonlyMap<string, Buffer>) {
  let value: unknown;
  try {
    value = JSON.parse(utf8.decode(source));
  } catch {
    throw invalid(`${STORYBOARD_FILE} must contain valid UTF-8 JSON`);
  }
  const storyboard = parseStoryboard(value);
  if (!storyboard) throw invalid(`${STORYBOARD_FILE} does not match the storyboard schema`);
  const missing = missingStoryboardAsset(storyboard, new Set(files.keys()));
  if (missing) throw invalid(`missing storyboard asset: ${missing}`);
}

function decodeManifest(type: ArtifactType, incoming: unknown) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming))
    throw invalid('files must be a path-to-base64 object');
  const entries = Object.entries(incoming as Record<string, unknown>);
  if (entries.length > MAX_FILES) throw tooLarge('artifact has too many source files');
  if (type === 'storyboard' && entries.length > MAX_STORYBOARD_ASSETS + 1)
    throw tooLarge('Storyboard has too many media files');
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
    checkStoryboardSize(type, name, estimatedBytes);
    if (type === 'slides' && estimatedBytes > MAX_SLIDE_DECK_BYTES)
      throw tooLarge(`${SLIDE_DECK_FILE} exceeds 2 MiB`);
    if (estimatedBytes > MAX_BYTES - total || value.length > Math.ceil(MAX_BYTES / 3) * 4)
      throw tooLarge('artifact exceeds 32 MiB');
    if (value.length % 4 !== 0 || !/^[A-Z0-9+/]*$/i.test(value.slice(0, -padding || undefined)))
      throw invalid(`invalid base64 content: ${name}`);
    const data = Buffer.from(value, 'base64');
    if (data.toString('base64') !== value) throw invalid(`noncanonical base64 content: ${name}`);
    total += data.length;
    if (total > MAX_BYTES) throw tooLarge('artifact exceeds 32 MiB');
    files.set(name, data);
  }
  const required = PRIMARY_FILE[type];
  const source = files.get(required);
  if (!source) throw invalid(`${required} is required`);
  if (type === 'slides') {
    validateSlideDeck(source);
    return files;
  }
  if (type === 'storyboard') {
    validateStoryboard(source, files);
    return files;
  }
  let primary: string;
  try {
    primary = utf8.decode(source);
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
  if (type === 'html' && !primary.trim()) throw invalid('index.html must not be empty');
  return files;
}

export function decodeDocumentUpload(incoming: RemoteArtifactWrite): {
  source: string;
  files: string[];
} {
  if (
    !incoming ||
    (incoming.baseRevision !== null &&
      (typeof incoming.baseRevision !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(incoming.baseRevision)))
  )
    throw invalid('baseRevision must be null or a sha256 revision');
  const files = decodeManifest('document', incoming.files);
  return { source: utf8.decode(files.get('doc.xml')!), files: [...files.keys()] };
}

/** Computes the exact post-merge source identity before a durable feedback operation starts. */
export function remoteUploadRevision(
  artifact: string,
  incoming: RemoteArtifactWrite,
  xml?: string,
) {
  const { type } = artifactParts(artifact);
  const files = decodeManifest(type, incoming.files);
  if (xml !== undefined) files.set('doc.xml', Buffer.from(xml));
  return digest(files);
}

function copyPreservingState(source: string, target: string) {
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
}

function removeManaged(dir: string, type: ArtifactType, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) removeManaged(file, type, relative);
    else if (managed(type, relative)) fs.rmSync(file);
  }
}

export interface PreparedStorageState {
  abort: () => void;
  commit: () => void;
  finalize: () => void;
  stage: () => void;
  stateDeltaBytes: number;
  validate: () => void;
}

/** The caller must serialize writes for one artifact and flush any live document editor first. */
export function writeRemoteArtifact(
  projectDir: string,
  artifact: string,
  incoming: RemoteArtifactWrite,
  admit?: (deltaBytes: number) => void,
  prepared?: PreparedStorageState & { xml: string },
  prepareStaged?: (directory: string) => PreparedStorageState,
): RemoteArtifactSnapshot {
  const { dir, parent, type } = pathsFor(projectDir, artifact);
  if (
    !incoming ||
    (incoming.baseRevision !== null &&
      (typeof incoming.baseRevision !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(incoming.baseRevision)))
  )
    throw invalid('baseRevision must be null or a sha256 revision');
  const files = decodeManifest(type, incoming.files);
  const exists = fs.existsSync(dir);
  const current = exists ? collect(dir, type) : new Map<string, Buffer>();
  const revision = current.size ? digest(current) : null;
  if (incoming.baseRevision !== revision)
    throw new RemoteTransferError(
      409,
      'revision_conflict',
      'remote artifact changed; pull before pushing again',
    );

  if (prepared) {
    if (type !== 'document') throw invalid('document preparation requires a document');
    files.set('doc.xml', Buffer.from(prepared.xml));
  }
  const identityFile = path.join(dir, '.artifact-id');
  const identity = fs.existsSync(identityFile) ? null : `${mintArtifactId()}\n`;

  const bytes = (values: Map<string, Buffer>) =>
    [...values.values()].reduce((sum, value) => sum + value.length, 0);
  if (bytes(files) > MAX_BYTES) throw tooLarge('artifact exceeds 32 MiB after document merge');

  const states: PreparedStorageState[] = prepared ? [prepared] : [];
  let staging: string | undefined;
  let backup: string | undefined;
  let oldMoved = false;
  let installed = false;
  try {
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    // A dot-prefixed sibling stays outside artifact enumeration while files are prepared.
    staging = fs.mkdtempSync(path.join(parent, '.remote-staging-'));
    backup = `${staging}.old`;
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
    if (identity)
      fs.writeFileSync(path.join(staging, '.artifact-id'), identity, { mode: 0o600, flag: 'wx' });
    if (prepareStaged) states.push(prepareStaged(staging));
    admit?.(
      bytes(files) -
        bytes(current) +
        states.reduce((sum, state) => sum + state.stateDeltaBytes, 0) +
        (identity ? Buffer.byteLength(identity) : 0),
    );
    for (const state of states) state.stage();
    for (const state of states) state.validate();
    // All mutations below are synchronous: file watchers cannot observe the temporary swap.
    if (exists) {
      fs.renameSync(dir, backup);
      oldMoved = true;
    }
    fs.renameSync(staging, dir);
    installed = true;
    for (const state of states) state.commit();
  } catch (err) {
    const stateErrors: unknown[] = [];
    let sourceError: unknown;
    for (const state of [...states].reverse()) {
      try {
        state.abort();
      } catch (error) {
        stateErrors.push(error);
      }
    }
    try {
      if (installed && states.length) {
        fs.rmSync(dir, { recursive: true, force: true });
        installed = false;
      }
      if (oldMoved && !installed && backup) fs.renameSync(backup, dir);
    } catch (error) {
      sourceError = error;
    }
    if (stateErrors.length || sourceError)
      throw new AggregateError(
        [err, ...stateErrors, sourceError].filter(Boolean),
        'Remote artifact rollback failed',
        { cause: err },
      );
    throw err;
  } finally {
    if (!installed && staging && fs.existsSync(staging))
      fs.rmSync(staging, { recursive: true, force: true });
  }
  // An old backup is safe to leave for manual cleanup if removal fails after installation.
  if (oldMoved && backup) {
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {}
  }
  for (const state of states) state.finalize();
  return snapshot(files, digest(files));
}
