import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { HubArtifact } from '../shared/hub';
import type { TrashEntry } from '../shared/trash';
import type { ArtifactType } from '../shared/types';
import { isArtifactAddress, isArtifactId, isArtifactType } from './artifacts';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const TRASH_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type Phase = 'moving' | 'trashed' | 'restoring' | 'restored' | 'purging' | 'purged';

interface RecordFile {
  phase: Phase;
  hadState: boolean;
  entry: TrashEntry;
}

export class ArtifactTrashError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ArtifactTrashError';
  }
}

function validDirectory(file: string, missing = false) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new ArtifactTrashError(409, 'unsafe_path', `Unsafe artifact directory: ${file}`);
    return true;
  } catch (error) {
    if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertTreeSafe(dir: string) {
  for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, child.name);
    if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile()))
      throw new ArtifactTrashError(409, 'unsafe_path', `Unsafe artifact entry: ${file}`);
    if (child.isDirectory()) assertTreeSafe(file);
  }
}

function basePaths(projectDir: string, create = false) {
  const project = path.resolve(projectDir);
  validDirectory(project);
  const anjian = path.join(project, '.anjian');
  if (!validDirectory(anjian, true) && create) fs.mkdirSync(anjian, { mode: 0o700 });
  const artifacts = path.join(anjian, 'artifacts');
  if (!validDirectory(artifacts, true) && create) fs.mkdirSync(artifacts, { mode: 0o700 });
  const state = path.join(artifacts, '.state');
  validDirectory(state, true);
  const trash = path.join(anjian, '.trash');
  if (!validDirectory(trash, true) && create) fs.mkdirSync(trash, { mode: 0o700 });
  return { project, artifacts, state, trash };
}

function itemPaths(paths: ReturnType<typeof basePaths>, record: RecordFile) {
  const { type, id, trashId } = record.entry;
  const typeDir = path.join(paths.artifacts, type);
  const stateTypeDir = path.join(paths.state, type);
  validDirectory(typeDir, true);
  validDirectory(stateTypeDir, true);
  const bin = path.join(paths.trash, trashId);
  validDirectory(bin);
  return {
    bin,
    source: path.join(typeDir, id),
    sourceState: path.join(stateTypeDir, id),
    stored: path.join(bin, 'artifact'),
    storedState: path.join(bin, 'state'),
    typeDir,
    stateTypeDir,
  };
}

function entryAddress(entry: TrashEntry) {
  let pathname: string;
  try { pathname = new URL(entry.url, 'http://anjian.local').pathname; }
  catch { throw new ArtifactTrashError(500, 'trash_corrupt', 'Invalid trash URL'); }
  const match = /^\/(document|artboard|html)\/([^/]+)$/.exec(pathname);
  if (!match || match[1] !== entry.type || !isArtifactAddress(match[2]!))
    throw new ArtifactTrashError(500, 'trash_corrupt', 'Invalid trash address');
  return match[2]!;
}

function recordOf(value: unknown, trashId: string, project: string): RecordFile {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ArtifactTrashError(500, 'trash_corrupt', 'Invalid trash record');
  const candidate = value as RecordFile;
  const entry = candidate.entry;
  if (!entry || !TRASH_ID.test(trashId) || entry.trashId !== trashId ||
    entry.project !== project || !isArtifactType(entry.type) || !isArtifactId(entry.id) ||
    typeof entry.url !== 'string' || typeof entry.title !== 'string' ||
    !Number.isFinite(entry.updatedAt) || !Number.isFinite(entry.deletedAt) ||
    !Number.isFinite(entry.expiresAt) || candidate.hadState !== true && candidate.hadState !== false ||
    !(['moving', 'trashed', 'restoring', 'restored', 'purging', 'purged'] as Phase[]).includes(candidate.phase))
    throw new ArtifactTrashError(500, 'trash_corrupt', 'Invalid trash record');
  entryAddress(entry);
  return candidate;
}

function readRecord(paths: ReturnType<typeof basePaths>, trashId: string) {
  if (!TRASH_ID.test(trashId))
    throw new ArtifactTrashError(400, 'invalid_trash_id', 'Invalid trash ID');
  const bin = path.join(paths.trash, trashId);
  if (!validDirectory(bin, true)) return null;
  const manifest = path.join(bin, 'manifest.json');
  const file = fs.lstatSync(manifest);
  if (!file.isFile() || file.isSymbolicLink())
    throw new ArtifactTrashError(500, 'trash_corrupt', 'Invalid trash manifest');
  try { return recordOf(JSON.parse(fs.readFileSync(manifest, 'utf8')), trashId, paths.project); }
  catch (error) {
    if (error instanceof ArtifactTrashError) throw error;
    throw new ArtifactTrashError(500, 'trash_corrupt', 'Unreadable trash manifest');
  }
}

function writeRecord(bin: string, record: RecordFile) {
  const file = path.join(bin, 'manifest.json');
  const temp = path.join(bin, `.manifest-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}

function finishMove(paths: ReturnType<typeof basePaths>, record: RecordFile) {
  const item = itemPaths(paths, record);
  if (validDirectory(item.stored, true)) {
    if (validDirectory(item.source, true))
      throw new ArtifactTrashError(409, 'source_conflict', 'Artifact exists while a trash move is pending');
  } else {
    if (!validDirectory(item.source, true))
      throw new ArtifactTrashError(500, 'trash_corrupt', 'Artifact disappeared during trash move');
    assertTreeSafe(item.source);
    fs.renameSync(item.source, item.stored);
  }
  if (record.hadState) {
    if (validDirectory(item.storedState, true)) {
      if (validDirectory(item.sourceState, true))
        throw new ArtifactTrashError(409, 'state_conflict', 'Artifact state exists in two locations');
    } else {
      if (!validDirectory(item.sourceState, true))
        throw new ArtifactTrashError(500, 'trash_corrupt', 'Artifact state disappeared during trash move');
      assertTreeSafe(item.sourceState);
      fs.renameSync(item.sourceState, item.storedState);
    }
  }
  record.phase = 'trashed';
  writeRecord(item.bin, record);
}

function finishRestore(paths: ReturnType<typeof basePaths>, record: RecordFile) {
  const item = itemPaths(paths, record);
  fs.mkdirSync(item.typeDir, { recursive: true, mode: 0o700 });
  if (record.hadState) {
    fs.mkdirSync(paths.state, { recursive: true, mode: 0o700 });
    fs.mkdirSync(item.stateTypeDir, { recursive: true, mode: 0o700 });
    if (validDirectory(item.storedState, true)) {
      if (validDirectory(item.sourceState, true))
        throw new ArtifactTrashError(409, 'restore_conflict', 'State target already exists');
      assertTreeSafe(item.storedState);
      fs.renameSync(item.storedState, item.sourceState);
    } else if (!validDirectory(item.sourceState, true))
      throw new ArtifactTrashError(500, 'trash_corrupt', 'State disappeared during restore');
  }
  if (validDirectory(item.stored, true)) {
    if (validDirectory(item.source, true))
      throw new ArtifactTrashError(409, 'restore_conflict', 'Artifact target already exists');
    assertTreeSafe(item.stored);
    fs.renameSync(item.stored, item.source);
  } else if (!validDirectory(item.source, true))
    throw new ArtifactTrashError(500, 'trash_corrupt', 'Artifact disappeared during restore');
  record.phase = 'restored';
  writeRecord(item.bin, record);
}

function finishPurge(paths: ReturnType<typeof basePaths>, record: RecordFile) {
  const item = itemPaths(paths, record);
  for (const target of [item.stored, item.storedState]) {
    if (!validDirectory(target, true)) continue;
    assertTreeSafe(target);
    fs.rmSync(target, { recursive: true });
  }
  record.phase = 'purged';
  writeRecord(item.bin, record);
}

function records(projectDir: string, now = Date.now(), recoverActive = false) {
  const paths = basePaths(projectDir);
  if (!validDirectory(paths.trash, true)) return { paths, records: [] as RecordFile[] };
  const found: RecordFile[] = [];
  for (const child of fs.readdirSync(paths.trash, { withFileTypes: true })) {
    if (!TRASH_ID.test(child.name)) continue;
    if (!child.isDirectory() || child.isSymbolicLink())
      throw new ArtifactTrashError(409, 'unsafe_path', 'Unsafe trash entry');
    const record = readRecord(paths, child.name)!;
    if (record.phase === 'moving' && recoverActive) finishMove(paths, record);
    else if (record.phase === 'restoring' && recoverActive) finishRestore(paths, record);
    else if (record.phase === 'purging') finishPurge(paths, record);
    if (record.phase === 'trashed' && record.entry.expiresAt <= now) {
      record.phase = 'purging';
      writeRecord(path.join(paths.trash, child.name), record);
      finishPurge(paths, record);
    }
    found.push(record);
  }
  return { paths, records: found };
}

/** Run before mounting projects, or while their writers are stopped and the project is locked. */
export function recoverProjectTrash(projectDir: string, now = Date.now()) {
  records(projectDir, now, true);
}

export function listTrash(projectDir: string, now = Date.now()): TrashEntry[] {
  return records(projectDir, now).records.filter((r) => r.phase === 'trashed')
    .map((r) => r.entry).sort((a, b) => b.deletedAt - a.deletedAt);
}

export function findTrashedArtifact(projectDir: string, type: ArtifactType, locator: string): TrashEntry | null {
  if (!isArtifactType(type) || !isArtifactId(locator) && !isArtifactAddress(locator)) return null;
  const match = records(projectDir).records.find((r) =>
    r.phase !== 'restored' && r.entry.type === type &&
    (r.entry.id === locator || entryAddress(r.entry) === locator));
  return match?.entry ?? null;
}

export function assertArtifactNotTrashed(projectDir: string, type: ArtifactType, id: string) {
  if (!isArtifactType(type) || !isArtifactId(id))
    throw new ArtifactTrashError(400, 'invalid_artifact', 'Invalid artifact locator');
  if (findTrashedArtifact(projectDir, type, id))
    throw new ArtifactTrashError(409, 'in_trash', '作品在回收站，请先恢复或以新作品上传');
}

export function moveArtifactToTrash(projectDir: string, artifact: HubArtifact, now = Date.now()): TrashEntry {
  if (!isArtifactType(artifact.type) || !isArtifactId(artifact.id))
    throw new ArtifactTrashError(400, 'invalid_artifact', 'Invalid artifact locator');
  const current = records(projectDir, now, true);
  const prior = current.records.find((r) => r.phase !== 'restored' &&
    r.entry.type === artifact.type && r.entry.id === artifact.id);
  if (prior) {
    if (prior.phase === 'trashed' && prior.entry.url === artifact.url) return prior.entry;
    throw new ArtifactTrashError(409, 'in_trash', '作品已在回收站或已永久删除');
  }
  const paths = basePaths(projectDir, true);
  const trashId = crypto.randomUUID();
  const entry: TrashEntry = { ...artifact, project: paths.project, trashId,
    deletedAt: now, expiresAt: now + RETENTION_MS };
  entryAddress(entry);
  if (artifact.project !== paths.project)
    throw new ArtifactTrashError(400, 'invalid_project', 'Artifact project does not match');
  const typeDir = path.join(paths.artifacts, artifact.type);
  const stateTypeDir = path.join(paths.state, artifact.type);
  validDirectory(typeDir);
  validDirectory(stateTypeDir, true);
  const source = path.join(typeDir, artifact.id);
  if (!validDirectory(source, true))
    throw new ArtifactTrashError(404, 'not_found', 'Artifact not found');
  assertTreeSafe(source);
  const sourceState = path.join(stateTypeDir, artifact.id);
  const hadState = validDirectory(sourceState, true);
  if (hadState) assertTreeSafe(sourceState);
  const addressFile = path.join(source, '.artifact-id');
  if (fs.existsSync(addressFile)) {
    const stat = fs.lstatSync(addressFile);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.readFileSync(addressFile, 'utf8').trim() !== entryAddress(entry))
      throw new ArtifactTrashError(409, 'address_conflict', 'Artifact address changed');
  }
  const bin = path.join(paths.trash, trashId);
  // The UUID directory is the commit point for discovery. A crash before its
  // rename leaves only an ignored staging directory, never a visible record
  // without a manifest that could prevent the server from starting.
  const staging = fs.mkdtempSync(path.join(paths.trash, '.staging-'));
  const record: RecordFile = { phase: 'moving', hadState, entry };
  try {
    writeRecord(staging, record);
    fs.renameSync(staging, bin);
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  finishMove(paths, record);
  return entry;
}

export function restoreTrash(projectDir: string, trashId: string, now = Date.now()): TrashEntry {
  const { paths, records: all } = records(projectDir, now, true);
  const record = all.find((r) => r.entry.trashId === trashId);
  if (!record) throw new ArtifactTrashError(404, 'not_found', 'Trash item not found');
  if (record.phase === 'restored') return record.entry;
  if (record.phase !== 'trashed')
    throw new ArtifactTrashError(410, 'expired', 'Trash item has been permanently deleted');
  const item = itemPaths(paths, record);
  if (validDirectory(item.source, true) || validDirectory(item.sourceState, true))
    throw new ArtifactTrashError(409, 'restore_conflict', 'An artifact or its state already exists at the original location');
  record.phase = 'restoring';
  writeRecord(item.bin, record);
  finishRestore(paths, record);
  return record.entry;
}

export function purgeTrash(projectDir: string, trashId: string, now = Date.now()): TrashEntry {
  const { paths, records: all } = records(projectDir, now, true);
  const record = all.find((r) => r.entry.trashId === trashId);
  if (!record) throw new ArtifactTrashError(404, 'not_found', 'Trash item not found');
  if (record.phase === 'purged') return record.entry;
  if (record.phase !== 'trashed')
    throw new ArtifactTrashError(409, 'not_in_trash', 'Artifact has been restored');
  record.phase = 'purging';
  writeRecord(path.join(paths.trash, trashId), record);
  finishPurge(paths, record);
  return record.entry;
}
