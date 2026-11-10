import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ArtifactType } from '../shared/types';
import { isArtifactId, isArtifactLocator, isArtifactType } from './artifacts';
import { parseDocument } from './document-codec';
import { readRemoteArtifact } from './remote-transfer';
import { readCanvas } from './state';

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SNAPSHOT = /^[a-f0-9-]{36}$/;

export interface ShareArtifact {
  type: ArtifactType;
  id: string;
  url: string;
}

export interface ShareRecord extends ShareArtifact {
  token: string;
  project: string;
  title: string;
  publishedAt: number;
  expiresAt: number | null;
  revision: string;
  snapshotDir: string;
  files: string[];
  bytes: number;
}

export class ShareStoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ShareStoreError';
  }
}

type IndexEntry = Omit<ShareRecord, 'snapshotDir'> & { snapshotId: string };
type Index = { version: 1; records: Record<string, IndexEntry> };

function validFile(file: string) {
  if (!file || file.startsWith('/') || file.includes('\\') || /[\x00-\x1f\x7f]/.test(file)) return false;
  const segments = file.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..' && !segment.startsWith('.'));
}

function safeDirectory(directory: string, create = true) {
  if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let stat: fs.Stats;
  try { stat = fs.lstatSync(directory); }
  catch (error) { if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new ShareStoreError(503, 'unsafe_storage', 'Share storage directory is unsafe');
}

/** Snapshot metadata lives outside the project and is never served as a project artifact. */
export function createShareStore(home: string, options: { maxBytes?: number; now?: () => number; canMutateProject?: (project: string) => boolean } = {}) {
  const root = path.resolve(home, 'shares');
  const snapshots = path.join(root, 'snapshots');
  const indexFile = path.join(root, 'index.json');
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  safeDirectory(root, false);
  safeDirectory(snapshots, false);

  const keyOf = (project: string, artifact: ShareArtifact) => {
    if (!isArtifactType(artifact.type) || !isArtifactId(artifact.id) ||
        !new RegExp(`^/${artifact.type}/[A-Za-z0-9_-]+$`).test(artifact.url) ||
        !isArtifactLocator(artifact.url.split('/')[2]!))
      throw new ShareStoreError(400, 'invalid_artifact', 'Invalid artifact address');
    return crypto.createHash('sha256').update(path.resolve(project)).update('\0')
      .update(artifact.type).update('\0').update(artifact.id).digest('hex');
  };

  const index = (): Index => {
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(indexFile, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, records: {} };
      throw new ShareStoreError(503, 'share_index_unavailable', 'Share index is unavailable');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        (parsed as Index).version !== 1 || !(parsed as Index).records ||
        typeof (parsed as Index).records !== 'object' || Array.isArray((parsed as Index).records))
      throw new ShareStoreError(503, 'share_index_unavailable', 'Share index is invalid');
    for (const [key, candidate] of Object.entries((parsed as Index).records)) {
      const entry = candidate as IndexEntry;
      if (!/^[a-f0-9]{64}$/.test(key) || !entry || typeof entry !== 'object' ||
          !TOKEN.test(entry.token) || !SNAPSHOT.test(entry.snapshotId) ||
          !isArtifactType(entry.type) || !isArtifactId(entry.id) ||
          typeof entry.project !== 'string' || !path.isAbsolute(entry.project) ||
          typeof entry.url !== 'string' || !new RegExp(`^/${entry.type}/[A-Za-z0-9_-]+$`).test(entry.url) ||
          typeof entry.title !== 'string' || !Number.isFinite(entry.publishedAt) ||
          !(entry.expiresAt === null || Number.isFinite(entry.expiresAt)) ||
          typeof entry.revision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(entry.revision) ||
          !Array.isArray(entry.files) || !entry.files.every((file) => typeof file === 'string' && validFile(file)) ||
          !Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
        throw new ShareStoreError(503, 'share_index_unavailable', 'Share index is invalid');
    }
    return parsed as Index;
  };

  const persist = (value: Index) => {
    safeDirectory(root);
    const tmp = path.join(root, `.index-${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, indexFile);
    } finally { fs.rmSync(tmp, { force: true }); }
  };

  const sourceAlive = (entry: IndexEntry) => {
    const components = [entry.project, path.join(entry.project, '.anjian'),
      path.join(entry.project, '.anjian', 'artifacts'),
      path.join(entry.project, '.anjian', 'artifacts', entry.type),
      path.join(entry.project, '.anjian', 'artifacts', entry.type, entry.id)];
    const source = components.at(-1)!;
    try {
      if (components.some((component) => {
        const stat = fs.lstatSync(component);
        return !stat.isDirectory() || stat.isSymbolicLink();
      })) return false;
      const identity = path.join(source, '.artifact-id');
      try {
        if (!fs.lstatSync(identity).isFile()) return false;
        return fs.readFileSync(identity, 'utf8').trim() === entry.url.split('/')[2];
      } catch { return false; }
    } catch { return false; }
  };

  const recordOf = (entry: IndexEntry): ShareRecord => {
    const { snapshotId, ...fields } = entry;
    if (!SNAPSHOT.test(snapshotId))
      throw new ShareStoreError(503, 'share_index_unavailable', 'Share snapshot reference is invalid');
    return { ...fields, snapshotDir: path.join(snapshots, snapshotId) };
  };

  const current = (entry: IndexEntry | undefined): ShareRecord | null =>
    entry && (entry.expiresAt === null || entry.expiresAt > now()) && sourceAlive(entry)
      ? recordOf(entry) : null;

  const status = (project: string, artifact: ShareArtifact) =>
    current(index().records[keyOf(project, artifact)]);

  const find = (token: string) => {
    if (!TOKEN.test(token)) return null;
    for (const entry of Object.values(index().records)) {
      if (entry.token === token) return current(entry);
    }
    return null;
  };

  const cleanupExpired = () => {
    const old = index();
    const expired = Object.entries(old.records).filter(([, entry]) =>
      entry.expiresAt !== null && entry.expiresAt <= now() && (options.canMutateProject?.(entry.project) ?? true),
    );
    if (expired.length === 0) return 0;
    const expiredKeys = new Set(expired.map(([key]) => key));
    const records = Object.fromEntries(Object.entries(old.records).filter(
      ([key]) => !expiredKeys.has(key),
    ));
    persist({ version: 1, records });
    const retained = new Set(Object.values(records).map((entry) => entry.snapshotId));
    for (const [, entry] of expired) {
      if (retained.has(entry.snapshotId)) continue;
      try { fs.rmSync(path.join(snapshots, entry.snapshotId), { recursive: true, force: true }); }
      catch { /* The index no longer grants access. */ }
    }
    return expired.length;
  };

  const publish = (
    project: string,
    artifact: ShareArtifact,
    settings: { expiresInDays?: 1 | 7 | 30 | null; title: string },
    admit?: (bytes: number) => void,
  ) => {
    const key = keyOf(project, artifact);
    if (![1, 7, 30, null, undefined].includes(settings.expiresInDays) ||
        !settings.title.trim() || settings.title.length > 300)
      throw new ShareStoreError(400, 'invalid_share', 'Invalid share settings');
    cleanupExpired();
    // readRemoteArtifact applies the existing 32 MiB, path and symlink restrictions.
    const snapshot = readRemoteArtifact(project, `${artifact.type}/${artifact.id}`);
    if (!snapshot.revision) throw new ShareStoreError(404, 'artifact_not_ready', 'Artifact is not ready to share');
    const old = index();
    const previous = old.records[key];
    const identity: IndexEntry = {
      ...(previous ?? { snapshotId: '' }), ...artifact,
      token: previous?.token ?? crypto.randomBytes(32).toString('base64url'),
      project: path.resolve(project), title: settings.title.trim(), publishedAt: now(),
      expiresAt: settings.expiresInDays === undefined
        ? (previous ? previous.expiresAt : now() + 7 * 86_400_000)
        : settings.expiresInDays === null ? null : now() + settings.expiresInDays * 86_400_000,
      revision: snapshot.revision, files: Object.keys(snapshot.files), bytes: 0,
      snapshotId: crypto.randomUUID(),
    };
    if (!sourceAlive(identity)) throw new ShareStoreError(404, 'artifact_not_found', 'Artifact identity changed');
    const files = Object.entries(snapshot.files).map(([file, base64]) => {
      if (!validFile(file)) throw new ShareStoreError(422, 'unsafe_snapshot', 'Unsafe snapshot file');
      return [file, Buffer.from(base64, 'base64')] as const;
    });
    identity.bytes = files.reduce((sum, [, body]) => sum + body.length, 0);
    const usage = Object.values(old.records).reduce((sum, entry) => sum + entry.bytes, 0) - (previous?.bytes ?? 0);
    if (identity.bytes + usage > maxBytes)
      throw new ShareStoreError(413, 'share_storage_full', 'Public share storage is full');
    // Reserve the entire new snapshot: the old one must remain available until publication succeeds.
    admit?.(identity.bytes);
    safeDirectory(root);
    safeDirectory(snapshots);
    const directory = path.join(snapshots, identity.snapshotId);
    fs.mkdirSync(directory, { mode: 0o700 });
    try {
      for (const [file, body] of files) {
        const target = path.join(directory, file);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, body, { flag: 'wx', mode: 0o600 });
      }
      // Validate the copied snapshot before moving the public pointer. A source
      // file can change while it is being read, so validating the live tree is
      // insufficient to protect the published version.
      try {
        if (artifact.type === 'artboard') {
          const board = readCanvas(directory);
          if (!board.canvas || board.warnings.length || board.pending.length)
            throw new Error('Artboard is incomplete or invalid');
        } else if (artifact.type === 'document') {
          parseDocument(fs.readFileSync(path.join(directory, 'doc.xml'), 'utf8'));
        } else if (!fs.readFileSync(path.join(directory, 'index.html'), 'utf8').trim()) {
          throw new Error('HTML entry is empty');
        }
      } catch {
        throw new ShareStoreError(422, 'invalid_snapshot', 'Artifact is not ready for public sharing');
      }
      persist({ version: 1, records: { ...old.records, [key]: identity } });
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    // Once the index points at the new immutable snapshot, an interrupted cleanup
    // can leave only unreachable files; it must not roll back a completed publish.
    if (previous) {
      try { fs.rmSync(path.join(snapshots, previous.snapshotId), { recursive: true, force: true }); }
      catch { /* A later maintenance pass can remove unreachable snapshots. */ }
    }
    return recordOf(identity);
  };

  const revoke = (project: string, artifact: ShareArtifact) => {
    const key = keyOf(project, artifact);
    const old = index();
    const previous = old.records[key];
    if (!previous) return false;
    const records = { ...old.records };
    delete records[key];
    persist({ version: 1, records });
    try { fs.rmSync(path.join(snapshots, previous.snapshotId), { recursive: true, force: true }); }
    catch { /* Already inaccessible via the index. */ }
    return true;
  };

  const revokeProject = (project: string) => {
    const old = index();
    const selected = Object.values(old.records).filter((entry) => entry.project === path.resolve(project));
    if (selected.length === 0) return 0;
    const records = Object.fromEntries(Object.entries(old.records).filter(
      ([, entry]) => entry.project !== path.resolve(project),
    ));
    persist({ version: 1, records });
    for (const entry of selected) {
      try { fs.rmSync(path.join(snapshots, entry.snapshotId), { recursive: true, force: true }); }
      catch { /* Already inaccessible via the index. */ }
    }
    return selected.length;
  };

  const rotate = (project: string, artifact: ShareArtifact) => {
    const key = keyOf(project, artifact);
    const old = index();
    const previous = old.records[key];
    if (!previous || !current(previous)) throw new ShareStoreError(404, 'share_not_found', 'Share not found');
    const changed = { ...previous, token: crypto.randomBytes(32).toString('base64url') };
    persist({ version: 1, records: { ...old.records, [key]: changed } });
    return recordOf(changed);
  };

  const file = (record: ShareRecord, relative: string) => {
    if (!validFile(relative) || !record.files.includes(relative)) return null;
    // Re-check current authority to avoid serving an old record after revoke or rotate.
    if (find(record.token)?.revision !== record.revision) return null;
    const target = path.join(record.snapshotDir, relative);
    try {
      if (!fs.realpathSync(target).startsWith(`${fs.realpathSync(record.snapshotDir)}${path.sep}`)) return null;
      const stat = fs.lstatSync(target);
      return stat.isFile() && !stat.isSymbolicLink() ? target : null;
    } catch { return null; }
  };

  const storageSnapshots = () => Object.values(index().records).map((entry) => ({
    directory: path.join(snapshots, entry.snapshotId), project: entry.project,
  }));
  return { status, publish, revoke, revokeProject, rotate, find, file, cleanupExpired, storageSnapshots };
}
