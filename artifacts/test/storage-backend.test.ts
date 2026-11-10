import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createStorageBackend } from '../src/server/storage/backend';
import { createStorageMigration, type MigrationProfile, type MigrationRoot } from '../src/server/storage/migration';
import type { FileDigest, StoredObject } from '../src/server/storage/objects';

const homes: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
const hash = (body: Buffer) => crypto.createHash('sha256').update(body).digest('hex');
function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-backend-'))); homes.push(home);
  const source = path.join(home, 'resources'); fs.mkdirSync(source);
  const profiles = new Map<string, MigrationProfile>();
  const profile = (scope: string) => {
    if (!profiles.has(scope)) profiles.set(scope, { id: crypto.randomUUID(), scope, endpoint: 'https://objects.example', bucket: 'private-bucket',
      prefix: 'files', region: 'auto', forcePathStyle: true, credentials: { accessKeyId: 'credential-id', secretAccessKey: 'credential-secret' } });
    return profiles.get(scope)!;
  };
  const remote = new Map<string, Buffer>();
  let failUpload = false; let failScope: string | undefined; let onDownload: (() => void) | undefined;
  let uploads = 0;
  const createObjects = (settings: { prefix: string }, _credentials: unknown, namespace: string) => ({
    reference(digest: FileDigest): StoredObject { return { ...digest, key: `${settings.prefix}/_anjian/objects/${namespace}/${digest.sha256}` }; },
    async verify(ref: StoredObject) {
      const body = remote.get(ref.key);
      if (!body || body.length !== ref.bytes || hash(body) !== ref.sha256) throw new Error('remote unavailable');
      return ref;
    },
    async upload(file: string, digest: FileDigest) {
      uploads++;
      if (failUpload) throw new Error('private provider detail');
      const body = fs.readFileSync(file); const ref = this.reference(digest);
      if (body.length !== digest.bytes || hash(body) !== digest.sha256) throw new Error('source changed');
      if (!remote.has(ref.key)) remote.set(ref.key, body);
      return this.verify(ref);
    },
    async download(ref: StoredObject, directory: string) {
      await this.verify(ref); onDownload?.();
      const file = path.join(directory, `.${crypto.randomUUID()}.download`);
      fs.writeFileSync(file, remote.get(ref.key)!, { flag: 'wx', mode: 0o600 }); return file;
    },
    close() {},
  });
  const resolveProfile = (scope: string, id: string) => {
    if (scope === failScope) throw new Error('private provider detail');
    const result = profile(scope); if (result.id !== id) throw new Error('unknown profile'); return result;
  };
  const migration = createStorageMigration(home, { resolveProfile, createObjects });
  const create = () => createStorageBackend(home, { migration, resolveProfile, createObjects });
  const root: MigrationRoot = { id: 'project', directory: source, kind: 'artifacts' };
  const prepare = async (scope = 'shared', roots = [root]) => {
    const job = await migration.prepare(scope, profile(scope).id, roots); await migration.resume(scope, job.id); return job;
  };
  const activate = async (scope = 'shared', roots = [root]) => { const job = await prepare(scope, roots); await create().activate(scope, job.id, async () => {}); return job; };
  const write = (relative: string, value: string) => { const file = path.join(source, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  return { home, source, root, profile, prepare, activate, create, remote, write, get uploads() { return uploads; },
    failUpload(value: boolean) { failUpload = value; }, failScope(value?: string) { failScope = value; }, onDownload(value?: () => void) { onDownload = value; } };
}
const guard = async () => {};

test('activates only verified migration pointers and rehydrates files and empty directories after restart', async () => {
  const f = fixture(); f.write('index.html', '<h1>Hello</h1>'); f.write('.state/history/one', 'history');
  f.write('.state/server-info', '?key=private-admin-key'); fs.mkdirSync(path.join(f.source, 'empty'));
  expect(f.create().summary('shared').backend).toBe('local');
  await f.activate();
  expect(f.create().summary('shared')).toMatchObject({ backend: 's3', pending: false, bytes: 21 });
  const files = [...f.remote.values()]; expect(files.some((body) => body.toString().includes('private-admin-key'))).toBe(false);
  fs.rmSync(f.source, { recursive: true });
  expect(await f.create().restore()).toEqual({ conflicts: [], pendingScopes: [], failures: [] });
  expect(fs.readFileSync(path.join(f.source, 'index.html'), 'utf8')).toBe('<h1>Hello</h1>');
  expect(fs.readFileSync(path.join(f.source, '.state/history/one'), 'utf8')).toBe('history');
  expect(fs.statSync(path.join(f.source, 'empty')).isDirectory()).toBe(true);
  expect(fs.existsSync(path.join(f.source, '.state/server-info'))).toBe(false);
});

test('failed checkpoint retains its intent, old pointer and local edits; successful retry commits the whole tree', async () => {
  const f = fixture(); f.write('keep', 'old'); f.write('remove', 'remove'); await f.activate();
  const before = f.create().summary('shared');
  f.write('keep', 'new content'); f.write('.state/comments', 'comment'); fs.unlinkSync(path.join(f.source, 'remove'));
  f.failUpload(true);
  await expect(f.create().checkpoint('shared', [f.root], guard)).rejects.toMatchObject({ code: 'unavailable' });
  expect(f.create().summary('shared')).toMatchObject({ bytes: before.bytes, pending: true });
  const recovering = await f.create().restore();
  expect(recovering.pendingScopes).toEqual(['shared']);
  expect(fs.existsSync(path.join(f.source, 'remove'))).toBe(false);
  expect(fs.readFileSync(path.join(f.source, 'keep'), 'utf8')).toBe('new content');
  f.failUpload(false);
  expect(await f.create().checkpoint('shared', [f.root], guard)).toMatchObject({ bytes: 18, pending: false });
  fs.rmSync(f.source, { recursive: true }); await f.create().restore();
  expect(fs.existsSync(path.join(f.source, 'remove'))).toBe(false);
  expect(fs.readFileSync(path.join(f.source, 'keep'), 'utf8')).toBe('new content');
  expect(fs.readdirSync(path.join(f.home, 'storage/bindings/intents/settled')).length).toBe(4);
});

test('guard rejection cannot publish uploads or lose local deletions after restart', async () => {
  const f = fixture(); f.write('a', 'alpha'); await f.activate();
  fs.unlinkSync(path.join(f.source, 'a'));
  let calls = 0;
  await expect(f.create().checkpoint('shared', [f.root], async () => { if (++calls === 2) throw new Error('revoked'); })).rejects.toMatchObject({ code: 'unavailable' });
  expect(f.create().summary('shared')).toMatchObject({ bytes: 5, pending: true });
  expect((await f.create().restore()).pendingScopes).toEqual(['shared']);
  expect(fs.existsSync(path.join(f.source, 'a'))).toBe(false);
});

test('remote loss is repaired from local data; remote corruption prevents a new committed revision', async () => {
  const f = fixture(); f.write('a', 'alpha'); await f.activate(); const [key] = f.remote.keys();
  f.remote.delete(key!);
  await f.create().checkpoint('shared', [f.root], guard);
  expect(f.remote.get(key!)?.toString()).toBe('alpha');
  f.remote.set(key!, Buffer.from('wrong'));
  await expect(f.create().checkpoint('shared', [f.root], guard)).rejects.toMatchObject({ code: 'unavailable' });
  expect(f.create().summary('shared').pending).toBe(true);
  expect(f.remote.get(key!)?.toString()).toBe('wrong');
});

test('restore preserves local changes and detects changes to known files during hydration', async () => {
  const f = fixture(); f.write('a', 'alpha'); f.write('b', 'beta'); fs.mkdirSync(path.join(f.source, 'empty')); await f.activate();
  fs.unlinkSync(path.join(f.source, 'b'));
  f.onDownload(() => { f.write('a', 'changed'); fs.mkdirSync(path.join(f.source, 'new-empty')); fs.rmdirSync(path.join(f.source, 'empty')); });
  const restored = await f.create().restore();
  expect(restored.conflicts.map(({ relative }) => relative).sort()).toEqual(['a', 'empty/', 'new-empty/']);
  expect(fs.readFileSync(path.join(f.source, 'a'), 'utf8')).toBe('changed');
});

test('private activation transfers roots and overrides shared fallback without exposing paths in summaries', async () => {
  const f = fixture(); f.write('a', 'alpha'); await f.activate();
  expect(f.create().scopeFor('github:2')).toBe('shared');
  await f.activate('github:2');
  expect(f.create().scopeFor('github:2')).toBe('github:2');
  expect(f.create().summary('shared').bytes).toBe(0);
  expect(f.create().summary('github:2').bytes).toBe(5);
  expect(JSON.stringify(f.create().summary('github:2'))).not.toContain(f.home);
  const uploads = f.uploads;
  await expect(f.create().checkpoint('shared', [f.root], guard)).rejects.toMatchObject({ code: 'scope_conflict' });
  expect(f.uploads).toBe(uploads);
});

test('an unavailable private provider does not prevent other scopes from recovering', async () => {
  const f = fixture(); f.write('a', 'alpha'); await f.activate();
  const other = path.join(f.home, 'other'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'b'), 'beta');
  await f.activate('github:2', [{ id: 'other', directory: other, kind: 'artifacts' }]);
  fs.rmSync(f.source, { recursive: true }); fs.rmSync(other, { recursive: true });
  f.failScope('github:2');
  const result = await f.create().restore();
  expect(result.failures).toEqual([{ scope: 'github:2', code: 'unavailable' }]);
  expect(fs.readFileSync(path.join(f.source, 'a'), 'utf8')).toBe('alpha');
  expect(JSON.stringify(result)).not.toContain('private provider');
});

test('corrupt pointers and symlinked cache paths fail closed', async () => {
  const f = fixture(); f.write('a', 'alpha'); await f.activate();
  const outside = path.join(f.home, 'outside'); fs.mkdirSync(outside);
  fs.rmSync(f.source, { recursive: true }); fs.symlinkSync(outside, f.source);
  expect((await f.create().restore()).failures).toEqual([{ scope: 'shared', code: 'invalid_binding' }]);
  expect(fs.readdirSync(outside)).toEqual([]);
  fs.writeFileSync(path.join(f.home, 'storage/bindings/active.json'), '{}');
  expect(() => f.create().summary('shared')).toThrow('活动存储记录无效');
});

test('failed pointer replacement keeps the previous committed revision usable and retryable', async () => {
  const f = fixture(); f.write('a', 'alpha'); await f.activate(); f.write('a', 'new bytes');
  const original = fs.renameSync;
  const failure = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).endsWith('/active.json')) throw new Error('disk full');
    return original(from, to);
  });
  await expect(f.create().checkpoint('shared', [f.root], guard)).rejects.toMatchObject({ code: 'unavailable' });
  failure.mockRestore();
  expect(f.create().summary('shared')).toMatchObject({ bytes: 5, pending: true });
  await f.create().checkpoint('shared', [f.root], guard);
  expect(f.create().summary('shared')).toMatchObject({ bytes: 9, pending: false });
});

test('member checkpoints preserve other shared roots and cannot settle another member failure', async () => {
  const f = fixture();
  const alice: MigrationRoot = { ...f.root, owner: 'github:2' };
  const bob: MigrationRoot = { id: 'bob', directory: path.join(f.home, 'bob'), kind: 'artifacts', owner: 'github:3' };
  fs.mkdirSync(bob.directory); fs.writeFileSync(path.join(bob.directory, 'index'), 'bob old');
  f.write('index', 'alice old'); f.write('deleted', 'must stay deleted');
  await f.activate('shared', [alice, bob]);
  fs.unlinkSync(path.join(f.source, 'deleted')); f.write('index', 'alice new');
  f.failUpload(true);
  await expect(f.create().checkpoint('shared', [alice], guard, 'github:2')).rejects.toMatchObject({ code: 'unavailable' });
  f.failUpload(false);
  fs.writeFileSync(path.join(bob.directory, 'index'), 'bob new');
  await f.create().checkpoint('shared', [bob], guard, 'github:3');
  fs.rmSync(bob.directory, { recursive: true });
  const result = await f.create().restore();
  expect(result).toMatchObject({ conflicts: [], pendingScopes: [], failures: [], pendingOwners: [{ scope: 'shared', owner: 'github:2' }] });
  expect(fs.readFileSync(path.join(bob.directory, 'index'), 'utf8')).toBe('bob new');
  expect(fs.existsSync(path.join(f.source, 'deleted'))).toBe(false);
  expect(f.create().summary('shared').pending).toBe(true);
  await f.create().checkpoint('shared', [alice], guard, 'github:2');
  expect(f.create().summary('shared').pending).toBe(false);
  fs.rmSync(f.source, { recursive: true });
  await f.create().restore();
  expect(fs.readFileSync(path.join(f.source, 'index'), 'utf8')).toBe('alice new');
  expect(fs.readFileSync(path.join(bob.directory, 'index'), 'utf8')).toBe('bob new');
  expect(fs.existsSync(path.join(f.source, 'deleted'))).toBe(false);
});

test('member checkpoint rejects foreign roots and full checkpoint supersedes pending member intents', async () => {
  const f = fixture(); const alice = { ...f.root, owner: 'github:2' };
  f.write('index', 'old'); await f.activate('shared', [alice]);
  await expect(f.create().checkpoint('shared', [alice], guard, 'github:3')).rejects.toMatchObject({ code: 'scope_conflict' });
  f.write('index', 'new'); f.failUpload(true);
  await expect(f.create().checkpoint('shared', [alice], guard, 'github:2')).rejects.toMatchObject({ code: 'unavailable' });
  f.failUpload(false);
  await f.create().checkpoint('shared', [alice], guard);
  expect(f.create().summary('shared').pending).toBe(false);
  fs.rmSync(f.source, { recursive: true });
  expect(await f.create().restore()).toEqual({ conflicts: [], pendingScopes: [], failures: [] });
  expect(fs.readFileSync(path.join(f.source, 'index'), 'utf8')).toBe('new');
});

test('restoration attributes a bad object to its owner and continues other members', async () => {
  const f = fixture(); const alice = { ...f.root, owner: 'github:2' };
  const bob = { id: 'bob', directory: path.join(f.home, 'bob'), owner: 'github:3' };
  fs.mkdirSync(bob.directory); fs.writeFileSync(path.join(bob.directory, 'b'), 'bob');
  f.write('a', 'alice'); await f.activate('shared', [alice, bob]);
  for (const [key, value] of f.remote) if (value.toString() === 'alice') f.remote.delete(key);
  fs.rmSync(f.source, { recursive: true }); fs.rmSync(bob.directory, { recursive: true });
  const backend = f.create(); const result = await backend.restore();
  expect(result.failures).toEqual([{ scope: 'shared', owner: 'github:2', code: 'unavailable' }]);
  expect(fs.readFileSync(path.join(bob.directory, 'b'), 'utf8')).toBe('bob');
  expect(backend.summary('shared', 'github:2').pending).toBe(true);
  expect(backend.summary('shared', 'github:3').pending).toBe(false);
});

test('verified move to personal storage retires the old shared member intent', async () => {
  const f = fixture(); const alice = { ...f.root, owner: 'github:2' };
  f.write('a', 'old'); await f.activate('shared', [alice]);
  f.write('a', 'new'); f.failUpload(true);
  await expect(f.create().checkpoint('shared', [alice], guard, 'github:2')).rejects.toMatchObject({ code: 'unavailable' });
  f.failUpload(false); await f.activate('github:2', [alice]);
  expect(f.create().summary('shared').pending).toBe(false);
  fs.rmSync(f.source, { recursive: true });
  expect(await f.create().restore()).toEqual({ conflicts: [], pendingScopes: [], failures: [] });
  expect(fs.readFileSync(path.join(f.source, 'a'), 'utf8')).toBe('new');
});

test('pre-upload provider failure persists the dirty owner range across restart', async () => {
  const f = fixture(); const alice = { ...f.root, owner: 'github:2' };
  f.write('a', 'deleted intentionally'); await f.activate('shared', [alice]);
  fs.unlinkSync(path.join(f.source, 'a')); f.failScope('shared');
  await expect(f.create().checkpoint('shared', [alice], guard, 'github:2')).rejects.toMatchObject({ code: 'unavailable' });
  f.failScope(); const backend = f.create();
  expect((await backend.restore()).pendingOwners).toEqual([{ scope: 'shared', owner: 'github:2' }]);
  expect(fs.existsSync(path.join(f.source, 'a'))).toBe(false);
  await backend.checkpoint('shared', [alice], guard, 'github:2');
  await backend.restore();
  expect(backend.summary('shared', 'github:2').pending).toBe(false);
});

test('write-ahead marker preserves local deletion if the process stops before checkpoint begins', async () => {
  const f = fixture();
  const root = { ...f.root, owner: 'github:2' };
  f.write('deleted', 'old'); await f.activate('shared', [root]);
  // A failed provider must not prevent the local durable marker from being made.
  f.failScope('shared');
  expect(await f.create().markDirty('github:2', guard)).toEqual({ scope: 'shared' });
  fs.unlinkSync(path.join(f.source, 'deleted'));
  f.failScope();
  const restarted = f.create();
  expect(await restarted.restore()).toMatchObject({ pendingOwners: [{ scope: 'shared', owner: 'github:2' }] });
  expect(fs.existsSync(path.join(f.source, 'deleted'))).toBe(false);
  await restarted.checkpoint('shared', [root], guard, 'github:2');
  expect(restarted.summary('shared').pending).toBe(false);
  fs.rmSync(f.source, { recursive: true });
  await f.create().restore();
  expect(fs.existsSync(path.join(f.source, 'deleted'))).toBe(false);
});

test('write-ahead markers isolate members and coalesce until a complete checkpoint settles them', async () => {
  const f = fixture();
  const alice = { ...f.root, owner: 'github:2' };
  const bob = { id: 'bob', directory: path.join(f.home, 'bob'), kind: 'artifacts' as const, owner: 'github:3' };
  fs.mkdirSync(bob.directory); fs.writeFileSync(path.join(bob.directory, 'index'), 'bob');
  f.write('index', 'alice'); await f.activate('shared', [alice, bob]);
  await f.create().markDirty('github:2', guard);
  await f.create().markDirty('github:2', guard);
  expect(fs.readdirSync(path.join(f.home, 'storage/bindings/intents')).filter((name) => name.endsWith('.json'))).toHaveLength(1);
  expect(f.create().summary('shared', 'github:2').pending).toBe(true);
  expect(f.create().summary('shared', 'github:3').pending).toBe(false);
  fs.rmSync(bob.directory, { recursive: true });
  await f.create().restore();
  expect(fs.readFileSync(path.join(bob.directory, 'index'), 'utf8')).toBe('bob');
  await f.create().checkpoint('shared', [alice], guard, 'github:2');
  expect(f.create().summary('shared').pending).toBe(false);
  await f.create().markDirty('github:2', guard);
  expect(f.create().summary('shared').pending).toBe(true);
});

test('write-ahead authority and persistence failures reject before callers can mutate sources', async () => {
  const f = fixture(); f.write('index', 'old');
  await f.activate('github:2', [{ ...f.root, owner: 'github:2' }]);
  await expect(f.create().markDirty('github:2', async () => { throw new Error('revoked'); })).rejects.toThrow('revoked');
  expect(f.create().summary('github:2').pending).toBe(false);
  const original = fs.linkSync;
  const fail = vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
    if (String(to).includes('/bindings/intents/')) throw new Error('disk full');
    return original(from, to);
  });
  await expect(f.create().markDirty('github:2', guard)).rejects.toThrow('disk full');
  fail.mockRestore();
  expect(fs.readFileSync(path.join(f.source, 'index'), 'utf8')).toBe('old');
  expect(await f.create().markDirty('github:2', guard)).toEqual({ scope: 'github:2' });
});

test('local-only writes need no dirty marker and cannot mark the shared pseudo-owner', async () => {
  const f = fixture();
  const authorize = vi.fn(guard);
  expect(await f.create().markDirty('owner', authorize)).toBeNull();
  expect(authorize).toHaveBeenCalledOnce();
  await expect(f.create().markDirty('shared', guard)).rejects.toMatchObject({ code: 'scope_conflict' });
  expect(fs.readdirSync(path.join(f.home, 'storage/bindings/intents'))).toEqual(['settled']);
});

test('a live checkpoint arms its successor before publishing, protecting subsequent writes on restart', async () => {
  const f = fixture(); const root = { ...f.root, owner: 'github:2' };
  f.write('delete-later', 'initial'); await f.activate('shared', [root]);
  await f.create().markDirty('github:2', guard);
  const activePointer = path.join(f.home, 'storage/bindings/active.json');
  const rename = fs.renameSync;
  let observed = false;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to) === activePointer) {
      const unfinished = fs.readdirSync(path.join(f.home, 'storage/bindings/intents'))
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(fs.readFileSync(path.join(f.home, 'storage/bindings/intents', name), 'utf8')));
      expect(unfinished.some((intent) => intent.owner === 'github:2' && intent.sequence === 2)).toBe(true);
      observed = true;
    }
    return rename(from, to);
  });
  await f.create().checkpoint('shared', [root], guard, 'github:2', { keepDirty: true });
  spy.mockRestore();
  expect(observed).toBe(true);
  expect(f.create().summary('shared').pending).toBe(true);
  fs.unlinkSync(path.join(f.source, 'delete-later'));
  expect(await f.create().restore()).toMatchObject({ pendingOwners: [{ scope: 'shared', owner: 'github:2' }] });
  expect(fs.existsSync(path.join(f.source, 'delete-later'))).toBe(false);
  // Only a quiesced final checkpoint may end the live write interval.
  await f.create().checkpoint('shared', [root], guard, 'github:2');
  expect(f.create().summary('shared').pending).toBe(false);
});

test('write-ahead admission refuses roots with unknown ownership', async () => {
  const f = fixture(); f.write('index', 'old'); await f.activate();
  await expect(f.create().markDirty('github:2', guard)).rejects.toMatchObject({ code: 'scope_conflict' });
  expect(f.create().summary('shared').pending).toBe(false);
});

test('one quiesced retry settles a live checkpoint whose pointer publication failed', async () => {
  const f = fixture(); const root = { ...f.root, owner: 'github:2' };
  f.write('index', 'old'); await f.activate('shared', [root]);
  await f.create().markDirty('github:2', guard); f.write('index', 'new');
  const rename = fs.renameSync;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).endsWith('/active.json')) throw new Error('disk full');
    return rename(from, to);
  });
  await expect(f.create().checkpoint('shared', [root], guard, 'github:2', { keepDirty: true })).rejects.toMatchObject({ code: 'unavailable' });
  spy.mockRestore();
  expect(f.create().summary('shared').pending).toBe(true);
  await f.create().checkpoint('shared', [root], guard, 'github:2');
  expect(f.create().summary('shared').pending).toBe(false);
  fs.rmSync(f.source, { recursive: true });
  expect(await f.create().restore()).toEqual({ conflicts: [], pendingScopes: [], failures: [] });
  expect(fs.readFileSync(path.join(f.source, 'index'), 'utf8')).toBe('new');
});
