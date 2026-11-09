import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import type { HubArtifact } from '../src/shared/hub';
import type { ArtifactType } from '../src/shared/types';
import {
  ArtifactTrashError,
  assertArtifactNotTrashed,
  findTrashedArtifact,
  listTrash,
  moveArtifactToTrash,
  purgeTrash,
  recoverProjectTrash,
  restoreTrash,
} from '../src/server/artifact-trash';

const projects: string[] = [];
const address = 'AbC1234567890defGHIjk';
const now = 1_800_000_000_000;

function fixture(type: ArtifactType, id = `sample-${type}`) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-trash-'));
  projects.push(project);
  const root = path.join(project, '.anjian', 'artifacts');
  const source = path.join(root, type, id);
  const state = path.join(root, '.state', type, id);
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(source, '.artifact-id'), address);
  fs.writeFileSync(path.join(source, 'comments.json'), '{"threads":[{"id":"kept"}]}');
  fs.writeFileSync(path.join(source, type === 'document' ? 'doc.xml' : type === 'artboard' ? 'canvas.json' : 'index.html'), 'source');
  fs.writeFileSync(path.join(state, 'history'), 'history');
  const artifact: HubArtifact = { project, type, id, url: `/${type}/${address}`, title: `${type} title`, updatedAt: now };
  return { project, root, source, state, artifact };
}

function manifest(project: string, id: string) {
  return path.join(project, '.anjian', '.trash', id, 'manifest.json');
}

afterEach(() => {
  for (const project of projects.splice(0)) fs.rmSync(project, { recursive: true, force: true });
});

for (const type of ['document', 'artboard', 'html'] as const) {
  test(`moves and restores ${type} source, comments, state and stable address`, () => {
    const f = fixture(type);
    const moved = moveArtifactToTrash(f.project, f.artifact, now);
    expect(fs.existsSync(f.source)).toBe(false);
    expect(fs.existsSync(f.state)).toBe(false);
    expect(listTrash(f.project, now)).toEqual([moved]);
    expect(findTrashedArtifact(f.project, type, address)).toEqual(moved);
    expect(() => assertArtifactNotTrashed(f.project, type, f.artifact.id)).toThrowError(ArtifactTrashError);
    expect(moveArtifactToTrash(f.project, f.artifact, now + 1)).toEqual(moved);
    expect(restoreTrash(f.project, moved.trashId, now + 2)).toEqual(moved);
    expect(fs.readFileSync(path.join(f.source, 'comments.json'), 'utf8')).toContain('kept');
    expect(fs.readFileSync(path.join(f.state, 'history'), 'utf8')).toBe('history');
    expect(fs.readFileSync(path.join(f.source, '.artifact-id'), 'utf8')).toBe(address);
    expect(listTrash(f.project, now + 2)).toEqual([]);
    expect(() => assertArtifactNotTrashed(f.project, type, f.artifact.id)).not.toThrow();
    expect(restoreTrash(f.project, moved.trashId, now + 2)).toEqual(moved);
  });
}

test('restore refuses an occupied source or state without overwriting either', () => {
  const f = fixture('document');
  const moved = moveArtifactToTrash(f.project, f.artifact, now);
  fs.mkdirSync(f.source);
  fs.writeFileSync(path.join(f.source, 'new'), 'new content');
  expect(() => restoreTrash(f.project, moved.trashId, now + 2)).toThrowError(/already exists/);
  expect(fs.readFileSync(path.join(f.source, 'new'), 'utf8')).toBe('new content');
  expect(listTrash(f.project, now + 2)).toEqual([moved]);
  fs.rmSync(f.source, { recursive: true });
  fs.mkdirSync(f.state, { recursive: true });
  expect(() => restoreTrash(f.project, moved.trashId, now + 2)).toThrowError(/already exists/);
  expect(listTrash(f.project, now + 2)).toEqual([moved]);
});

test('expiry purges data but keeps a durable upload tombstone', () => {
  const f = fixture('artboard');
  const moved = moveArtifactToTrash(f.project, f.artifact, now);
  expect(listTrash(f.project, moved.expiresAt)).toEqual([]);
  expect(fs.existsSync(path.join(f.project, '.anjian', '.trash', moved.trashId, 'artifact'))).toBe(false);
  expect(() => assertArtifactNotTrashed(f.project, 'artboard', f.artifact.id))
    .toThrowError(/回收站/);
  expect(() => restoreTrash(f.project, moved.trashId, moved.expiresAt)).toThrowError(/permanently deleted/);
  expect(purgeTrash(f.project, moved.trashId, moved.expiresAt)).toEqual(moved);
});

test('explicit purge is idempotent and never removes the local source project', () => {
  const f = fixture('html');
  const moved = moveArtifactToTrash(f.project, f.artifact, now);
  expect(purgeTrash(f.project, moved.trashId, now + 1)).toEqual(moved);
  expect(purgeTrash(f.project, moved.trashId, now + 2)).toEqual(moved);
  expect(fs.existsSync(f.project)).toBe(true);
  expect(findTrashedArtifact(f.project, 'html', moved.id)).toEqual(moved);
});

test('startup recovery completes interrupted move and restore', () => {
  const f = fixture('document');
  const moved = moveArtifactToTrash(f.project, f.artifact, now);
  const file = manifest(f.project, moved.trashId);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.phase = 'moving';
  fs.renameSync(path.join(path.dirname(file), 'state'), f.state);
  fs.writeFileSync(file, JSON.stringify(record));
  // Ordinary listing never moves a live state directory.
  expect(listTrash(f.project, now + 1)).toEqual([]);
  expect(fs.existsSync(f.state)).toBe(true);
  recoverProjectTrash(f.project, now + 1);
  expect(fs.existsSync(f.state)).toBe(false);
  expect(listTrash(f.project, now + 1)).toEqual([moved]);

  record.phase = 'restoring';
  fs.writeFileSync(file, JSON.stringify(record));
  fs.renameSync(path.join(path.dirname(file), 'state'), f.state);
  recoverProjectTrash(f.project, now + 2);
  expect(fs.existsSync(f.source)).toBe(true);
  expect(fs.readFileSync(path.join(f.state, 'history'), 'utf8')).toBe('history');
});

test('a failed first manifest write never publishes an incomplete UUID record', () => {
  const f = fixture('artboard');
  const original = fs.writeFileSync;
  const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
    if (typeof file === 'string' && path.basename(file).startsWith('.manifest-'))
      throw new Error('ENOSPC');
    return original(file, data, options);
  });
  try {
    expect(() => moveArtifactToTrash(f.project, f.artifact, now)).toThrowError('ENOSPC');
  } finally {
    write.mockRestore();
  }
  expect(fs.existsSync(f.source)).toBe(true);
  const trashRoot = path.join(f.project, '.anjian', '.trash');
  expect(fs.readdirSync(trashRoot).filter((name) => /^[a-f0-9]{8}-/.test(name))).toEqual([]);
  expect(() => recoverProjectTrash(f.project, now)).not.toThrow();
  expect(listTrash(f.project, now)).toEqual([]);
});

test('startup recovery ignores an interrupted unpublished staging directory', () => {
  const f = fixture('html');
  const trashRoot = path.join(f.project, '.anjian', '.trash');
  fs.mkdirSync(path.join(trashRoot, '.staging-orphan'), { recursive: true });
  fs.writeFileSync(path.join(trashRoot, '.staging-orphan', '.manifest-incomplete.tmp'), '{');
  expect(() => recoverProjectTrash(f.project, now)).not.toThrow();
  expect(listTrash(f.project, now)).toEqual([]);
  expect(fs.existsSync(f.source)).toBe(true);
});

test('symlinks in an artifact or trash root refuse movement without following them', () => {
  const f = fixture('html');
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-trash-external-'));
  projects.push(external);
  fs.writeFileSync(path.join(external, 'keep'), 'safe');
  fs.symlinkSync(external, path.join(f.source, 'link'));
  expect(() => moveArtifactToTrash(f.project, f.artifact, now)).toThrowError(/Unsafe artifact entry/);
  expect(fs.readFileSync(path.join(external, 'keep'), 'utf8')).toBe('safe');
  fs.rmSync(path.join(f.source, 'link'));
  fs.rmSync(path.join(f.project, '.anjian', '.trash'), { recursive: true });
  fs.symlinkSync(external, path.join(f.project, '.anjian', '.trash'));
  expect(() => moveArtifactToTrash(f.project, f.artifact, now)).toThrowError(/Unsafe artifact directory/);
  expect(fs.readFileSync(path.join(external, 'keep'), 'utf8')).toBe('safe');
});
