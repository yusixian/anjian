import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createStorageMigration, type MigrationProfile } from '../src/server/storage/migration';
import type { FileDigest, StoredObject } from '../src/server/storage/objects';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-migration-')); homes.push(home);
  const source = path.join(home, 'actual-resources'); fs.mkdirSync(source);
  const profile: MigrationProfile = {
    id: crypto.randomUUID(), scope: 'shared', endpoint: 'https://objects.example', bucket: 'private-bucket',
    region: 'auto', prefix: 'tenant', forcePathStyle: true, credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
  };
  const remote = new Map<string, Buffer>();
  let uploads = 0; let verifies = 0; let failAtUpload = 0; let onVerify: (() => void) | undefined;
  const createObjects = (_settings: unknown, _credentials: unknown, namespace: string) => ({
    reference(digest: FileDigest): StoredObject { return { ...digest, key: `tenant/_anjian/objects/${namespace}/${digest.sha256}` }; },
    async upload(file: string, digest: FileDigest): Promise<StoredObject> {
      uploads++;
      if (uploads === failAtUpload) throw new Error('injected transfer failure');
      const body = fs.readFileSync(file);
      if (body.length !== digest.bytes || crypto.createHash('sha256').update(body).digest('hex') !== digest.sha256) throw new Error('source changed');
      const ref = this.reference(digest);
      const existing = remote.get(ref.key);
      if (existing) {
        if (existing.length !== digest.bytes || crypto.createHash('sha256').update(existing).digest('hex') !== digest.sha256)
          throw new Error('immutable object has corrupt bytes');
      } else remote.set(ref.key, body);
      return ref;
    },
    async verify(ref: StoredObject): Promise<StoredObject> {
      verifies++;
      const body = remote.get(ref.key);
      if (!body || body.length !== ref.bytes || crypto.createHash('sha256').update(body).digest('hex') !== ref.sha256) throw new Error('remote mismatch');
      onVerify?.();
      return ref;
    },
    close() {},
  });
  const create = () => createStorageMigration(home, { resolveProfile: () => profile, createObjects });
  const root = { id: 'resources', directory: source };
  return { home, source, profile, remote, root, create, get uploads() { return uploads; }, get verifies() { return verifies; },
    failOnUpload(value: number) { failAtUpload = value; }, onVerify(callback?: () => void) { onVerify = callback; } };
}
function write(source: string, relative: string, value: Buffer | string) {
  const file = path.join(source, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
}

test('captures hidden state, comments, trash and empty directories, verifies every byte and preserves originals', async () => {
  const f = fixture();
  write(f.source, '.state/session.json', '{"live":true}');
  write(f.source, '.state/server-info', 'http://localhost/?key=admin-secret');
  write(f.source, '.state/.last-token', 'admin-secret');
  write(f.source, '.state/.last-port', '32123');
  write(f.source, 'comments/.private', Buffer.from([0, 1, 255]));
  write(f.source, 'trash/deleted.bin', crypto.randomBytes(30_000));
  fs.mkdirSync(path.join(f.source, 'empty'));
  const before = new Map(['.state/session.json', 'comments/.private', 'trash/deleted.bin'].map((relative) =>
    [relative, fs.readFileSync(path.join(f.source, relative))]));
  const root = { ...f.root, exclude: ['.state/server-info', '.state/.last-token', '.state/.last-port'] };
  const job = await f.create().prepare('shared', f.profile.id, [root]);
  expect(job).toMatchObject({ state: 'prepared', files: 3, verifiedFiles: 0 });
  const manifest = fs.readFileSync(path.join(f.home, 'storage/migrations', Buffer.from('shared').toString('base64url'), `${job.id}.json`), 'utf8');
  expect(manifest).not.toContain('admin-secret');
  write(f.source, '.state/server-info', 'http://localhost/?key=rotated-secret');
  const done = await f.create().resume('shared', job.id);
  expect(done).toMatchObject({ state: 'verified', files: 3, verifiedFiles: 3, bytes: 30_016 });
  expect(f.remote.size).toBe(3);
  expect([...f.remote.values()].some((body) => body.toString().includes('admin-secret') || body.toString().includes('rotated-secret'))).toBe(false);
  for (const [relative, body] of before) expect(fs.readFileSync(path.join(f.source, relative))).toEqual(body);
  expect(fs.existsSync(path.join(f.source, 'empty'))).toBe(true);
  expect(JSON.stringify(await f.create().status('shared', job.id))).not.toContain(f.source);
  expect(JSON.stringify(await f.create().status('shared', job.id))).not.toContain('secret');
  const refs = await f.create().verifiedReferences('shared', job.id);
  expect(refs).toMatchObject({ id: job.id, scope: 'shared', profileId: f.profile.id });
  expect(refs.roots).toEqual([{ id: 'resources', directory: fs.realpathSync(f.source),
    exclude: ['.state/.last-port', '.state/.last-token', '.state/server-info'], directories: ['', '.state', 'comments', 'empty', 'trash'] }]);
  expect(refs.files.map((ref) => ref.relative).sort()).toEqual([...before.keys()].sort());
});

test('persists partial progress and resumes across constructors without reuploading verified references', async () => {
  const f = fixture(); write(f.source, 'a', 'alpha'); write(f.source, 'b', 'beta');
  const job = await f.create().prepare('shared', f.profile.id, [f.root]);
  f.failOnUpload(2);
  await expect(f.create().resume('shared', job.id)).rejects.toMatchObject({ code: 'verification_failed' });
  expect(await f.create().status('shared', job.id)).toMatchObject({ state: 'failed', verifiedFiles: 1, files: 2 });
  f.failOnUpload(0);
  expect(await f.create().resume('shared', job.id)).toMatchObject({ state: 'verified', verifiedFiles: 2 });
  expect(f.uploads).toBe(3);
  expect(f.verifies).toBeGreaterThan(0);
  expect((await f.create().prepare('shared', f.profile.id, [f.root])).id).not.toBe(job.id);
  expect(await f.create().status('shared', job.id)).toMatchObject({ state: 'verified', files: 2 });
});

test('retries a missing object after persisted reference verification fails', async () => {
  const f = fixture(); write(f.source, 'a', 'alpha');
  const job = await f.create().prepare('shared', f.profile.id, [f.root]);
  await f.create().resume('shared', job.id);
  const [key] = f.remote.keys();
  f.remote.delete(key!);
  await expect(f.create().verifiedReferences('shared', job.id)).rejects.toMatchObject({ code: 'verification_failed' });
  await f.create().resume('shared', job.id);
  expect(f.uploads).toBe(2);
  expect(f.remote.get(key!)).toEqual(Buffer.from('alpha'));
});

test('never overwrites an existing corrupt immutable object; a new job has a new namespace', async () => {
  const f = fixture(); write(f.source, 'a', 'alpha');
  const job = await f.create().prepare('shared', f.profile.id, [f.root]);
  await f.create().resume('shared', job.id);
  const [key] = f.remote.keys();
  f.remote.set(key!, Buffer.from('wrong'));
  await expect(f.create().verifiedReferences('shared', job.id)).rejects.toMatchObject({ code: 'verification_failed' });
  await expect(f.create().resume('shared', job.id)).rejects.toMatchObject({ code: 'verification_failed' });
  expect(f.remote.get(key!)).toEqual(Buffer.from('wrong'));
  expect(fs.readFileSync(path.join(f.source, 'a'))).toEqual(Buffer.from('alpha'));
  const replacement = await f.create().prepare('shared', f.profile.id, [f.root]);
  await f.create().resume('shared', replacement.id);
  expect(replacement.id).not.toBe(job.id);
  expect(f.remote.size).toBe(2);
});

test('rechecks the source tree after remote verification before returning activation input', async () => {
  const f = fixture(); write(f.source, 'a', 'alpha');
  const job = await f.create().prepare('shared', f.profile.id, [f.root]);
  await f.create().resume('shared', job.id);
  f.onVerify(() => { write(f.source, 'a', 'changed'); f.onVerify(); });
  await expect(f.create().verifiedReferences('shared', job.id)).rejects.toMatchObject({ code: 'source_changed' });
});

test('rejects source changes and added tree entries without activating or deleting local files', async () => {
  const f = fixture(); write(f.source, 'a', 'alpha');
  const job = await f.create().prepare('shared', f.profile.id, [f.root]);
  write(f.source, 'a', 'changed');
  await expect(f.create().resume('shared', job.id)).rejects.toMatchObject({ code: 'source_changed' });
  expect(await f.create().status('shared', job.id)).toMatchObject({ state: 'failed', error: 'source_changed' });
  await expect(f.create().verifiedReferences('shared', job.id)).rejects.toMatchObject({ code: 'verification_failed' });
  write(f.source, 'a', 'alpha'); write(f.source, '.state/new', 'surprise');
  await expect(f.create().resume('shared', job.id)).rejects.toMatchObject({ code: 'source_changed' });
  expect(fs.readFileSync(path.join(f.source, 'a'), 'utf8')).toBe('alpha');
  expect(fs.readFileSync(path.join(f.source, '.state/new'), 'utf8')).toBe('surprise');
});

test('rejects wrong scope, corrupted manifest, and changed configuration revision contents', async () => {
  const f = fixture(); write(f.source, 'a', 'alpha');
  const job = await f.create().prepare('shared', f.profile.id, [f.root]);
  await expect(f.create().status('owner', job.id)).rejects.toMatchObject({ code: 'not_found' });
  f.profile.bucket = 'different-bucket';
  await expect(f.create().resume('shared', job.id)).rejects.toMatchObject({ code: 'profile_changed' });
  f.profile.bucket = 'private-bucket';
  const file = path.join(f.home, 'storage/migrations', Buffer.from('shared').toString('base64url'), `${job.id}.json`);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.files[0].relative = '../outside';
  fs.writeFileSync(file, JSON.stringify(manifest));
  await expect(f.create().resume('shared', job.id)).rejects.toMatchObject({ code: 'corrupt_manifest' });
  expect(fs.readFileSync(path.join(f.source, 'a'), 'utf8')).toBe('alpha');
});

test('rejects symlinks, invalid exclusions, overlapping roots and simultaneous scope operations', async () => {
  const f = fixture(); write(f.source, 'a', 'alpha');
  fs.symlinkSync(path.join(f.source, 'a'), path.join(f.source, 'link'));
  await expect(f.create().prepare('shared', f.profile.id, [f.root])).rejects.toMatchObject({ code: 'invalid_request' });
  fs.unlinkSync(path.join(f.source, 'link'));
  await expect(f.create().prepare('shared', f.profile.id, [{ ...f.root, exclude: ['../outside'] }])).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(f.create().prepare('shared', f.profile.id, [f.root, { id: 'nested', directory: f.source }])).rejects.toMatchObject({ code: 'invalid_request' });
  const job = await f.create().prepare('shared', f.profile.id, [f.root]);
  const first = f.create().resume('shared', job.id);
  await expect(f.create().resume('shared', job.id)).rejects.toMatchObject({ code: 'busy' });
  await first;
});

test('rejects a symlinked storage metadata parent', async () => {
  const f = fixture(); write(f.source, 'a', 'alpha');
  const outside = path.join(f.home, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.home, 'storage'));
  await expect(f.create().prepare('shared', f.profile.id, [f.root])).rejects.toMatchObject({ code: 'invalid_request' });
  expect(fs.readdirSync(outside)).toEqual([]);
});

test('canonical root paths reject two aliases to the same source tree', async () => {
  const f = fixture(); write(f.source, 'a', 'alpha');
  const alias = path.join(f.home, 'parent-alias');
  fs.symlinkSync(f.home, alias);
  await expect(f.create().prepare('shared', f.profile.id, [f.root,
    { id: 'alias', directory: path.join(alias, 'actual-resources') }])).rejects.toMatchObject({ code: 'invalid_request' });
});
