import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { createShareStore, ShareStoreError } from '../src/server/share-store';

const temporary: string[] = [];
const address = 'AbC1234567890defGHIjk';
let clock = 1_800_000_000_000;

function fixture(type: 'artboard' | 'document' | 'html' = 'html') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-share-'));
  temporary.push(root);
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const id = `sample-${type}`;
  const source = path.join(project, '.anjian', 'artifacts', type, id);
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, '.artifact-id'), `${address}\n`);
  fs.writeFileSync(path.join(source, 'comments.json'), 'private comments');
  fs.writeFileSync(path.join(source, '.secret'), 'private metadata');
  const primary = type === 'artboard' ? 'canvas.json' : type === 'document' ? 'doc.xml' : 'index.html';
  fs.writeFileSync(path.join(source, primary), type === 'document'
    ? '<doc><p>First version</p></doc>'
    : type === 'artboard'
      ? JSON.stringify({ title: 'Board', pages: [{ id: 'main', name: 'Main' }], boards: {
        one: { file: 'pages/one.html', page: 'main', x: 0, y: 0, w: 400, h: 300 },
      } })
      : 'first version');
  if (type === 'artboard') {
    fs.mkdirSync(path.join(source, 'pages'));
    fs.writeFileSync(path.join(source, 'pages', 'one.html'), '<h1>Public</h1>');
  }
  const artifact = { type, id, url: `/${type}/${address}` };
  const store = createShareStore(home, { now: () => clock });
  return { root, project, home, source, artifact, store, primary };
}

afterEach(() => {
  vi.restoreAllMocks();
  clock = 1_800_000_000_000;
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('publishes only managed source files, keeps snapshot immutable, and survives restart', () => {
  const f = fixture('artboard');
  const record = f.store.publish(f.project, f.artifact, { title: 'Public board', expiresInDays: 7 });
  expect(record.files).toEqual(['canvas.json', 'pages/one.html']);
  expect(f.store.file(record, 'comments.json')).toBeNull();
  expect(f.store.file(record, '.secret')).toBeNull();
  expect(f.store.file(record, '../.artifact-id')).toBeNull();
  fs.writeFileSync(path.join(f.source, 'pages', 'one.html'), '<h1>Draft</h1>');
  expect(fs.readFileSync(f.store.file(record, 'pages/one.html')!, 'utf8')).toBe('<h1>Public</h1>');
  const reloaded = createShareStore(f.home, { now: () => clock });
  expect(reloaded.find(record.token)?.revision).toBe(record.revision);
  expect(reloaded.status(f.project, f.artifact)?.token).toBe(record.token);
});

test('update changes published files atomically and keeps the same link', () => {
  const f = fixture();
  const original = f.store.publish(f.project, f.artifact, { title: 'First', expiresInDays: 7 });
  fs.writeFileSync(path.join(f.source, f.primary), 'second version');
  const updated = f.store.publish(f.project, f.artifact, { title: 'Second', expiresInDays: 30 });
  expect(updated.token).toBe(original.token);
  expect(fs.readFileSync(f.store.file(updated, f.primary)!, 'utf8')).toBe('second version');
  expect(f.store.file(original, f.primary)).toBeNull();
  expect(updated.snapshotDir).not.toBe(original.snapshotDir);
});

test('updating preserves the active absolute expiry; expired links receive a new token and seven days', () => {
  const f = fixture();
  const first = f.store.publish(f.project, f.artifact, { title: 'First', expiresInDays: 1 });
  clock += 60_000;
  const update = f.store.publish(f.project, f.artifact, { title: 'Update' });
  expect(update.token).toBe(first.token);
  expect(update.expiresAt).toBe(first.expiresAt);
  clock = first.expiresAt!;
  const renewed = f.store.publish(f.project, f.artifact, { title: 'Again' });
  expect(renewed.token).not.toBe(first.token);
  expect(renewed.expiresAt).toBe(clock + 7 * 86_400_000);
});

test('index write failure retains the last published snapshot', () => {
  const f = fixture();
  const original = f.store.publish(f.project, f.artifact, { title: 'First', expiresInDays: 7 });
  fs.writeFileSync(path.join(f.source, f.primary), 'second version');
  const realRename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).endsWith('index.json')) throw new Error('disk unavailable');
    return realRename(from, to);
  });
  expect(() => f.store.publish(f.project, f.artifact, { title: 'Second', expiresInDays: 7 })).toThrow('disk unavailable');
  expect(f.store.status(f.project, f.artifact)?.revision).toBe(original.revision);
  expect(fs.readFileSync(f.store.file(original, f.primary)!, 'utf8')).toBe('first version');
});

test('invalid artboard JSON cannot replace a published version', () => {
  const f = fixture('artboard');
  const original = f.store.publish(f.project, f.artifact, { title: 'Published', expiresInDays: 7 });
  const oldFile = fs.readFileSync(f.store.file(original, 'pages/one.html')!, 'utf8');
  fs.writeFileSync(path.join(f.source, 'canvas.json'), '{broken');
  expect(() => f.store.publish(f.project, f.artifact, { title: 'Broken', expiresInDays: 7 }))
    .toThrowError(/not ready for public sharing/);
  expect(f.store.find(original.token)?.revision).toBe(original.revision);
  expect(fs.readFileSync(f.store.file(original, 'pages/one.html')!, 'utf8')).toBe(oldFile);
});

test('artboard with a missing board resource cannot replace the old snapshot', () => {
  const f = fixture('artboard');
  const original = f.store.publish(f.project, f.artifact, { title: 'Published', expiresInDays: 7 });
  fs.rmSync(path.join(f.source, 'pages', 'one.html'));
  expect(() => f.store.publish(f.project, f.artifact, { title: 'Incomplete', expiresInDays: 7 }))
    .toThrowError(/not ready for public sharing/);
  expect(f.store.find(original.token)?.revision).toBe(original.revision);
  expect(fs.readFileSync(f.store.file(original, 'pages/one.html')!, 'utf8')).toBe('<h1>Public</h1>');
});

test('malformed document cannot replace the old snapshot', () => {
  const f = fixture('document');
  const original = f.store.publish(f.project, f.artifact, { title: 'Published', expiresInDays: 7 });
  fs.writeFileSync(path.join(f.source, 'doc.xml'), '<doc><p>broken</h2></doc>');
  expect(() => f.store.publish(f.project, f.artifact, { title: 'Broken', expiresInDays: 7 }))
    .toThrowError(/not ready for public sharing/);
  expect(f.store.find(original.token)?.revision).toBe(original.revision);
  expect(fs.readFileSync(f.store.file(original, 'doc.xml')!, 'utf8'))
    .toBe('<doc><p>First version</p></doc>');
});

test('expiry, revoke and rotation invalidate old visitor access', () => {
  const f = fixture();
  const first = f.store.publish(f.project, f.artifact, { title: 'First', expiresInDays: 1 });
  const rotated = f.store.rotate(f.project, f.artifact);
  expect(rotated.token).not.toBe(first.token);
  expect(f.store.find(first.token)).toBeNull();
  expect(f.store.find(rotated.token)).not.toBeNull();
  clock += 86_400_000;
  expect(f.store.find(rotated.token)).toBeNull();
  expect(f.store.cleanupExpired()).toBe(1);
  expect(fs.existsSync(rotated.snapshotDir)).toBe(false);
  const noExpiry = f.store.publish(f.project, f.artifact, { title: 'Long lived', expiresInDays: null });
  expect(f.store.find(noExpiry.token)).not.toBeNull();
  expect(f.store.revoke(f.project, f.artifact)).toBe(true);
  expect(f.store.find(noExpiry.token)).toBeNull();
  expect(f.store.revoke(f.project, f.artifact)).toBe(false);
});

test('source removal and restored identity mismatch keep visitor access closed', () => {
  const f = fixture();
  const record = f.store.publish(f.project, f.artifact, { title: 'Shared', expiresInDays: null });
  fs.rmSync(f.source, { recursive: true });
  expect(f.store.find(record.token)).toBeNull();
  fs.mkdirSync(f.source);
  fs.writeFileSync(path.join(f.source, '.artifact-id'), 'Another1234567890defGHI');
  expect(f.store.find(record.token)).toBeNull();
  fs.rmSync(f.source, { recursive: true });
  fs.symlinkSync(path.join(f.root, 'outside'), f.source);
  expect(f.store.find(record.token)).toBeNull();
});

test('share budget rejects extra snapshots without publishing a link', () => {
  const f = fixture();
  const limited = createShareStore(f.home, { now: () => clock, maxBytes: 5 });
  expect(() => limited.publish(f.project, f.artifact, { title: 'Too large', expiresInDays: 7 }))
    .toThrowError(ShareStoreError);
  expect(limited.status(f.project, f.artifact)).toBeNull();
});

test('symlinked source file is rejected before a public snapshot exists', () => {
  const f = fixture('html');
  fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.source, 'outside.txt'));
  expect(() => f.store.publish(f.project, f.artifact, { title: 'Unsafe', expiresInDays: 7 })).toThrow();
  expect(f.store.status(f.project, f.artifact)).toBeNull();
});

test('removing a registered project closes all of its shares durably', () => {
  const f = fixture();
  const first = f.store.publish(f.project, f.artifact, { title: 'Shared', expiresInDays: null });
  expect(f.store.revokeProject(f.project)).toBe(1);
  expect(f.store.find(first.token)).toBeNull();
  expect(createShareStore(f.home).find(first.token)).toBeNull();
  expect(f.store.revokeProject(f.project)).toBe(0);
});

test('publication admission reserves the new snapshot and leaves the old share intact on rejection', () => {
  const f = fixture();
  const old = f.store.publish(f.project, f.artifact, { title: 'Original' });
  fs.writeFileSync(path.join(f.source, f.primary), 'second version');
  let reserved = -1;
  expect(() => f.store.publish(f.project, f.artifact, { title: 'Replacement' }, (bytes) => {
    reserved = bytes;
    throw new ShareStoreError(413, 'storage_quota_exceeded', 'quota');
  })).toThrowError(expect.objectContaining({ code: 'storage_quota_exceeded' }));
  expect(reserved).toBe(Buffer.byteLength('second version'));
  expect(f.store.find(old.token)?.snapshotDir).toBe(old.snapshotDir);
  expect(fs.readFileSync(path.join(old.snapshotDir, f.primary), 'utf8')).toBe('first version');
  expect(fs.readdirSync(path.join(f.home, 'shares/snapshots'))).toEqual([path.basename(old.snapshotDir)]);
});

test('expiry cleanup preserves snapshots belonging to a space awaiting storage recovery', () => {
  const f = fixture();
  const published = f.store.publish(f.project, f.artifact, { title: 'Pending recovery', expiresInDays: 1 });
  const snapshot = f.store.file(published, 'index.html')!;
  clock += 2 * 24 * 60 * 60 * 1000;
  let available = false;
  const store = createShareStore(f.home, { now: () => clock, canMutateProject: () => available });
  expect(store.cleanupExpired()).toBe(0);
  expect(store.find(published.token)).toBeNull();
  expect(fs.existsSync(snapshot)).toBe(true);
  available = true;
  expect(store.cleanupExpired()).toBe(1);
  expect(fs.existsSync(snapshot)).toBe(false);
});

test('expiry cleanup keeps a snapshot still referenced by a retained share record', () => {
  const f = fixture();
  const published = f.store.publish(f.project, f.artifact, { title: 'Published', expiresInDays: 1 });
  const snapshot = f.store.file(published, 'index.html')!;
  const indexFile = path.join(f.home, 'shares/index.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const original = Object.values(index.records)[0] as Record<string, unknown>;
  index.records['f'.repeat(64)] = { ...original, expiresAt: null };
  fs.writeFileSync(indexFile, JSON.stringify(index));
  clock += 2 * 24 * 60 * 60 * 1000;
  expect(f.store.cleanupExpired()).toBe(1);
  expect(Object.keys(JSON.parse(fs.readFileSync(indexFile, 'utf8')).records)).toEqual(['f'.repeat(64)]);
  expect(fs.existsSync(snapshot)).toBe(true);
});
