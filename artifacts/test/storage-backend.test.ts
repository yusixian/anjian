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
  expect(fs.readdirSync(path.join(f.home, 'storage/bindings/intents')).length).toBe(2);
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
