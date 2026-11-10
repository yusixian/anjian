import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

interface Request { method: string; path: string; hostname: string; query: Record<string, string>; headers: Record<string, string>; body?: AsyncIterable<Uint8Array> | Uint8Array }
const wire = vi.hoisted(() => ({
  objects: new Map<string, { body: Buffer; version: string }>(),
  calls: [] as Request[],
  fault: '' as '' | 'lost-put' | 'failed-put' | 'corrupt' | 'long' | 'short' | 'bad-length' | 'bad-version',
  sequence: 0,
}));
vi.mock('@smithy/node-http-handler', () => ({ NodeHttpHandler: class {
  async handle(request: Request) {
    wire.calls.push(request);
    const key = request.path;
    const response = (status: number, data: Buffer, headers: Record<string, string> = {}) => ({ response: { statusCode: status, headers, body: Readable.from([data.subarray(0, 17), data.subarray(17)]) } });
    if (request.method === 'PUT') {
      const chunks: Buffer[] = [];
      if (request.body instanceof Uint8Array) chunks.push(Buffer.from(request.body));
      else for await (const chunk of request.body!) chunks.push(Buffer.from(chunk));
      if (wire.fault === 'failed-put') throw new Error('provider failure with credentials that must not escape');
      if (wire.objects.has(key)) return response(412, Buffer.from('<Error><Code>PreconditionFailed</Code></Error>'));
      const object = { body: Buffer.concat(chunks), version: `version-${++wire.sequence}` };
      wire.objects.set(key, object);
      if (wire.fault === 'lost-put') throw new Error('socket closed after committed write');
      return response(200, Buffer.alloc(0), { 'x-amz-version-id': object.version });
    }
    if (request.method === 'DELETE') return response(204, Buffer.alloc(0));
    const object = wire.objects.get(key);
    if (!object) return response(404, Buffer.from('<Error><Code>NoSuchKey</Code></Error>'));
    let body = object.body;
    if (wire.fault === 'corrupt') { body = Buffer.from(body); body[0] = (body[0] ?? 0) ^ 1; }
    if (wire.fault === 'long') body = Buffer.concat([body, Buffer.from('extra')]);
    if (wire.fault === 'short') body = body.subarray(0, Math.max(0, body.length - 1));
    return response(200, body, { 'content-length': String(wire.fault === 'bad-length' ? body.length + 1 : object.body.length),
      'x-amz-version-id': wire.fault === 'bad-version' ? 'foreign-version' : object.version });
  }
  destroy() {}
} }));
import { createS3Objects, digestFile } from '../src/server/storage/objects';
import { testS3Connection } from '../src/server/storage/s3';
import { createStorageMigration } from '../src/server/storage/migration';

const homes: string[] = [];
const stores: ReturnType<typeof createS3Objects>[] = [];
beforeEach(() => { wire.objects.clear(); wire.calls.length = 0; wire.fault = ''; wire.sequence = 0; });
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
const settings = { endpoint: 'https://objects.example', bucket: 'private-bucket', region: 'auto', prefix: 'tenant-files', forcePathStyle: true };
const credentials = { accessKeyId: 'test-access', secretAccessKey: 'test-secret' };
const namespace = 'da67a169-2cd6-4a14-bfe4-7267ded10283';
function fixture(body = crypto.randomBytes(1024 * 1024)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-objects-')); homes.push(directory);
  const source = path.join(directory, 'source'); fs.writeFileSync(source, body);
  const store = createS3Objects(settings, credentials, namespace); stores.push(store);
  return { directory, source, body, store };
}

test('streams real file bytes through signed SDK requests, verifies them and restores a private temporary file', async () => {
  const f = fixture();
  const digest = await digestFile(f.source);
  expect(digest).toEqual({ bytes: f.body.length, sha256: crypto.createHash('sha256').update(f.body).digest('hex') });
  const ref = await f.store.upload(f.source, digest);
  expect(ref.key).toBe(`tenant-files/_anjian/objects/${namespace}/${digest.sha256}`);
  expect(ref.versionId).toBe('version-1');
  const restored = await f.store.download(ref, f.directory);
  expect(restored).not.toBe(f.source);
  expect(fs.readFileSync(restored)).toEqual(f.body);
  expect(fs.readFileSync(f.source)).toEqual(f.body);
  expect(fs.statSync(restored).mode & 0o777).toBe(0o600);
  expect(wire.calls.map(({ method }) => method)).toEqual(['PUT', 'GET', 'GET']);
  expect(wire.calls[0]!.headers.authorization).toContain('AWS4-HMAC-SHA256');
  expect(wire.calls[0]!.headers['if-none-match']).toBe('*');
  expect(wire.calls[0]!.headers['x-amz-checksum-sha256']).toBe(Buffer.from(digest.sha256, 'hex').toString('base64'));
  expect(wire.calls.slice(1).every((call) => call.query.versionId === 'version-1')).toBe(true);
});

test('retry after a lost PUT response or conditional conflict reads the existing object without replacing it', async () => {
  const f = fixture(Buffer.from('immutable bytes'));
  const digest = await digestFile(f.source);
  wire.fault = 'lost-put';
  const recovered = await f.store.upload(f.source, digest);
  wire.fault = '';
  const repeated = await f.store.upload(f.source, digest);
  expect(repeated).toEqual(recovered);
  expect(wire.sequence).toBe(1);
  expect(wire.objects.size).toBe(1);
  expect(wire.calls.map(({ method }) => method)).toEqual(['PUT', 'GET', 'PUT', 'GET']);
});

test.each(['corrupt', 'long', 'short', 'bad-length', 'bad-version'] as const)('rejects %s reads and removes unfinished temporary downloads', async (fault) => {
  const f = fixture(Buffer.from('original-content'));
  const ref = await f.store.upload(f.source, await digestFile(f.source));
  wire.fault = fault;
  await expect(f.store.download(ref, f.directory)).rejects.toMatchObject({ code: 'integrity_failed' });
  expect(fs.readdirSync(f.directory)).toEqual(['source']);
  expect(fs.readFileSync(f.source)).toEqual(f.body);
  expect(wire.calls.some(({ method }) => method === 'DELETE')).toBe(false);
});

test('never reports an unsuccessful write as verified or exposes provider errors', async () => {
  const f = fixture(); wire.fault = 'failed-put';
  await expect(f.store.upload(f.source, await digestFile(f.source))).rejects.toMatchObject({ code: 'transfer_failed', message: 'S3 资源传输失败，请检查连接、权限和服务状态后重试。' });
  expect(wire.objects.size).toBe(0);
});

test('empty files transfer correctly and changed content cannot pass read-back verification', async () => {
  const f = fixture(Buffer.alloc(0));
  const empty = await f.store.upload(f.source, await digestFile(f.source));
  expect(empty.bytes).toBe(0);
  expect(fs.readFileSync(await f.store.download(empty, f.directory))).toEqual(Buffer.alloc(0));
  fs.writeFileSync(f.source, 'same-size-before');
  const digest = await digestFile(f.source);
  fs.writeFileSync(f.source, 'same-size-after!');
  await expect(f.store.upload(f.source, digest)).rejects.toMatchObject({ code: 'source_changed' });
});

test('rejects forged keys and out-of-scope references before any network request', async () => {
  const f = fixture(); const digest = await digestFile(f.source);
  const ref = f.store.reference(digest);
  await expect(f.store.verify({ ...ref, key: 'someone-elses-secret' })).rejects.toMatchObject({ code: 'invalid_object' });
  await expect(f.store.verify({ ...ref, bytes: -1 })).rejects.toMatchObject({ code: 'invalid_object' });
  await expect(f.store.verify({ ...ref, versionId: '' })).rejects.toMatchObject({ code: 'invalid_object' });
  expect(() => createS3Objects(settings, credentials, '../../other')).toThrow('存储对象无效');
  expect(wire.calls).toHaveLength(0);
});

test('refuses symlink sources and download directories', async () => {
  const f = fixture(); const ref = f.store.reference(await digestFile(f.source));
  const link = path.join(f.directory, 'link'); fs.symlinkSync(f.source, link);
  await expect(digestFile(link)).rejects.toThrow();
  await expect(f.store.upload(link, ref)).rejects.toThrow();
  const linkedDirectory = path.join(f.directory, 'linked-dir'); fs.symlinkSync(f.directory, linkedDirectory);
  await expect(f.store.download(ref, linkedDirectory)).rejects.toMatchObject({ code: 'invalid_object' });
  expect(wire.calls).toHaveLength(0);
});


test('a retry cannot bless changed source bytes just because an old object exists', async () => {
  const f = fixture(Buffer.from('old-content'));
  const expected = await digestFile(f.source);
  await f.store.upload(f.source, expected);
  wire.calls.length = 0;
  fs.writeFileSync(f.source, 'new-content');
  await expect(f.store.upload(f.source, expected)).rejects.toMatchObject({ code: 'source_changed' });
  expect(wire.calls).toHaveLength(0);
});

test('probe cleanup recovers a lost PUT version before deleting it', async () => {
  wire.fault = 'lost-put';
  const result = await testS3Connection(settings, credentials);
  expect(result.ok).toBe(false);
  expect(result.steps.delete).toBe(true);
  expect(wire.calls.map(({ method }) => method)).toEqual(['PUT', 'GET', 'DELETE']);
  expect(wire.calls[2]!.query.versionId).toBe('version-1');
});

test('probe cleanup reports uncertainty if an unacknowledged write cannot be located', async () => {
  wire.fault = 'failed-put';
  const result = await testS3Connection(settings, credentials);
  expect(result.steps.delete).toBe(false);
  expect(result.cleanupKey).toBeTruthy();
  expect(wire.calls.map(({ method }) => method)).toEqual(['PUT', 'GET']);
});


test('migration uses the real SDK adapter, survives lost acknowledgements and never overwrites a corrupted object', async () => {
  const f = fixture(Buffer.from('binary artifact bytes'));
  const resources = path.join(f.directory, 'resources'); fs.mkdirSync(resources);
  fs.copyFileSync(f.source, path.join(resources, '.artifact-id'));
  const profile = { ...settings, credentials, id: namespace, scope: 'shared' };
  const create = () => createStorageMigration(f.directory, { resolveProfile: () => profile });
  const job = await create().prepare('shared', profile.id, [{ id: 'resources', directory: resources }]);
  wire.fault = 'lost-put';
  expect(await create().resume('shared', job.id)).toMatchObject({ state: 'verified', verifiedFiles: 1 });
  const puts = wire.calls.filter(({ method }) => method === 'PUT').length;
  wire.fault = '';
  expect(await create().resume('shared', job.id)).toMatchObject({ state: 'verified' });
  expect(wire.calls.filter(({ method }) => method === 'PUT')).toHaveLength(puts);
  const [stored] = wire.objects.values();
  stored!.body = Buffer.from('corrupted provider object');
  await expect(create().resume('shared', job.id)).rejects.toMatchObject({ code: 'verification_failed' });
  expect(await create().status('shared', job.id)).toMatchObject({ state: 'failed' });
  expect(wire.sequence).toBe(1);
  expect(wire.calls.some(({ method }) => method === 'DELETE')).toBe(false);
  expect(fs.readFileSync(path.join(resources, '.artifact-id'))).toEqual(f.body);
});
