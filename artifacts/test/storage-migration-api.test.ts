import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import type { Principal } from '../src/server/member-store';
import { createStorageMigrationApi } from '../src/server/storage/migration-api';
import { createStorageMigration, type MigrationProfile } from '../src/server/storage/migration';
import type { FileDigest, StoredObject } from '../src/server/storage/objects';
import { createStorageSettings } from '../src/server/storage/settings';

const homes: string[] = [];
const servers: http.Server[] = [];
const handlers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-migration-api-'))); homes.push(home);
  const source = path.join(home, 'resources'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'index.html'), '<h1>Trusted source</h1>');
  const settings = createStorageSettings(home);
  const values = { endpoint: 'https://objects.example', bucket: 'private-bucket', region: 'auto', prefix: 'files', forcePathStyle: true };
  const credentials = { accessKeyId: 'key', secretAccessKey: 'secret' };
  const profile = settings.save('shared', values, credentials);
  settings.recordTest('shared', profile.id, { ok: true, checkedAt: Date.now(), steps: { write: true, read: true, delete: true } });
  const personal = settings.save('github:2', values, credentials);
  settings.recordTest('github:2', personal.id, { ok: true, checkedAt: Date.now(), steps: { write: true, read: true, delete: true } });
  const ownerProfile = settings.save('owner', values, credentials);
  settings.recordTest('owner', ownerProfile.id, { ok: true, checkedAt: Date.now(), steps: { write: true, read: true, delete: true } });
  const remote = new Map<string, Buffer>();
  let uploadGate: ReturnType<typeof deferred> | undefined;
  let failUpload = false;
  const createObjects = (_profile: unknown, _secret: unknown, namespace: string) => ({
    reference(digest: FileDigest): StoredObject { return { ...digest, key: `files/_anjian/objects/${namespace}/${digest.sha256}` }; },
    async upload(file: string, digest: FileDigest) {
      await uploadGate?.promise;
      if (failUpload) throw new Error('provider unavailable');
      const bytes = fs.readFileSync(file);
      const ref = this.reference(digest);
      if (bytes.length !== digest.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== digest.sha256) throw new Error('changed source');
      remote.set(ref.key, bytes);
      return ref;
    },
    async verify(ref: StoredObject) {
      const bytes = remote.get(ref.key);
      if (!bytes || bytes.length !== ref.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new Error('missing object');
      return ref;
    },
    close() {},
  });
  const migration = createStorageMigration(home, {
    resolveProfile: (scope, id): MigrationProfile => settings.resolve(scope, id), createObjects,
  });
  const identity = { owner: true, member: true, version: 0 };
  const principal = (req: http.IncomingMessage): Principal | null => {
    if (req.headers.authorization === 'Bearer owner' && identity.owner) return { id: 'owner', role: 'owner', sessionVersion: identity.version };
    if (req.headers.authorization === 'Bearer member' && identity.member) return { id: 'github:2', role: 'member', githubId: 2, sessionVersion: identity.version };
    return null;
  };
  const readBody = async (req: http.IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const part of req) chunks.push(Buffer.from(part));
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  const server = http.createServer(); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const plan = vi.fn(async (scope: string) => ({ scope, roots: [{ id: 'trusted', directory: source, owner: scope === 'shared' ? 'owner' : scope }], fingerprint: 'trusted' }));
  const handler = createStorageMigrationApi({ migration, plan, settings, origin, principal: (req) => principal(req), readBody });
  handlers.push(handler);
  server.on('request', (req, res) => { void handler(req, res, new URL(req.url ?? '/', origin)); });
  const request = async (scope: 'shared' | 'personal', auth: 'owner' | 'member', body?: object, requestOrigin = origin) => fetch(`${origin}/api/storage/migrations?scope=${scope}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${auth}`, Origin: requestOrigin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { home, source, settings, profile, personal, ownerProfile, migration, plan, handler, identity, request, origin, remote,
    waitUpload() { uploadGate = deferred(); return uploadGate; },
    failUpload(value: boolean) { failUpload = value; } };
}

test('prepares only trusted roots for the current tested draft and lists persistent summaries', async () => {
  const f = await fixture();
  expect((await f.request('shared', 'member')).status).toBe(403);
  expect((await f.request('shared', 'owner', undefined, 'https://evil.invalid')).status).toBe(403);
  expect((await f.request('shared', 'owner', { action: 'prepare', profileId: f.profile.id }, 'https://evil.invalid')).status).toBe(403);
  expect((await f.request('shared', 'owner', { action: 'prepare', profileId: f.profile.id,
    roots: [{ id: 'evil', directory: '/etc' }] })).status).toBe(400);
  expect((await f.request('shared', 'owner', { action: 'prepare', profileId: crypto.randomUUID() })).status).toBe(409);
  expect(f.plan).not.toHaveBeenCalled();
  const response = await f.request('shared', 'owner', { action: 'prepare', profileId: f.profile.id });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.job).toMatchObject({ scope: 'shared', state: 'prepared', files: 1 });
  expect(JSON.stringify(body)).not.toContain(f.source);
  expect(JSON.stringify(body)).not.toContain('secret');
  expect(f.plan).toHaveBeenCalledExactlyOnceWith('shared');
  const restarted = createStorageMigration(f.home, { resolveProfile: (scope, id): MigrationProfile => f.settings.resolve(scope, id) });
  expect((await restarted.list('shared')).map((job) => job.id)).toContain(body.job.id);
  const listed = await (await f.request('shared', 'owner')).json();
  expect(listed.jobs).toEqual([expect.objectContaining({ id: body.job.id, running: false })]);
  expect(JSON.stringify(listed)).not.toContain(f.source);
  expect((await f.request('personal', 'member', { action: 'resume', id: body.job.id })).status).toBe(404);
});

test('rechecks membership after planning before any manifest is created', async () => {
  const f = await fixture();
  const gate = deferred();
  f.plan.mockImplementationOnce(async (scope) => { await gate.promise; return { scope, roots: [{ id: 'trusted', directory: f.source, owner: scope }], fingerprint: 'trusted' }; });
  const request = f.request('personal', 'member', { action: 'prepare', profileId: f.personal.id });
  await vi.waitFor(() => expect(f.plan).toHaveBeenCalledOnce());
  f.identity.member = false;
  gate.resolve();
  expect((await request).status).toBe(403);
  expect(await f.migration.list('github:2')).toEqual([]);
});

test('resumes in background, reports progress, rejects duplicate runs, and survives handler restart', async () => {
  const f = await fixture();
  const prepared = await (await f.request('shared', 'owner', { action: 'prepare', profileId: f.profile.id })).json();
  const gate = f.waitUpload();
  const started = await f.request('shared', 'owner', { action: 'resume', id: prepared.job.id });
  expect(started.status).toBe(202);
  expect((await started.json()).running).toBe(true);
  await vi.waitFor(async () => expect((await f.migration.status('shared', prepared.job.id)).state).toBe('copying'));
  expect((await (await f.request('shared', 'owner')).json()).jobs[0]).toMatchObject({ state: 'copying', running: true });
  expect((await f.request('shared', 'owner', { action: 'resume', id: prepared.job.id })).status).toBe(409);
  gate.resolve();
  await vi.waitFor(async () => expect((await f.migration.status('shared', prepared.job.id)).state).toBe('verified'));
  expect((await (await f.request('shared', 'owner')).json()).jobs[0]).toMatchObject({ state: 'verified', running: false });
  const restarted = createStorageMigration(f.home, { resolveProfile: (scope, id): MigrationProfile => f.settings.resolve(scope, id) });
  expect((await restarted.list('shared'))[0]).toMatchObject({ id: prepared.job.id, state: 'verified' });
  expect(fs.readFileSync(path.join(f.source, 'index.html'), 'utf8')).toContain('Trusted source');
});

test('failed copy persists as retryable and close drains an in-flight task', async () => {
  const f = await fixture();
  const prepared = await (await f.request('shared', 'owner', { action: 'prepare', profileId: f.profile.id })).json();
  f.failUpload(true);
  expect((await f.request('shared', 'owner', { action: 'resume', id: prepared.job.id })).status).toBe(202);
  await vi.waitFor(async () => expect((await f.migration.status('shared', prepared.job.id)).state).toBe('failed'));
  await vi.waitFor(async () => expect((await (await f.request('shared', 'owner')).json()).jobs[0]).toMatchObject({ state: 'failed', running: false }));
  f.failUpload(false);
  const gate = f.waitUpload();
  expect((await f.request('shared', 'owner', { action: 'resume', id: prepared.job.id })).status).toBe(202);
  await vi.waitFor(async () => expect((await f.migration.status('shared', prepared.job.id)).state).toBe('copying'));
  const closing = f.handler.close();
  gate.resolve();
  await closing;
  expect((await f.migration.status('shared', prepared.job.id)).state).toBe('failed');
  expect((await f.request('shared', 'owner')).status).toBe(503);
});

test('refuses a prepared job after its server-planned ownership changes', async () => {
  const f = await fixture();
  const prepared = await (await f.request('shared', 'owner', { action: 'prepare', profileId: f.profile.id })).json();
  f.plan.mockImplementation(async (scope) => ({
    scope, roots: [{ id: 'trusted', directory: f.source, owner: 'github:2' }], fingerprint: 'transferred',
  }));
  expect((await f.request('shared', 'owner', { action: 'resume', id: prepared.job.id })).status).toBe(202);
  await vi.waitFor(async () => expect(await f.migration.status('shared', prepared.job.id)).toMatchObject({
    state: 'failed', error: 'source_changed', verifiedFiles: 0,
  }));
  expect(f.remote.size).toBe(0);
  expect((await (await f.request('shared', 'owner')).json()).jobs[0].running).toBe(false);
});

test('stops an in-flight copy when the server-planned ownership changes', async () => {
  const f = await fixture();
  const prepared = await (await f.request('shared', 'owner', { action: 'prepare', profileId: f.profile.id })).json();
  const gate = f.waitUpload();
  expect((await f.request('shared', 'owner', { action: 'resume', id: prepared.job.id })).status).toBe(202);
  await vi.waitFor(async () => expect((await f.migration.status('shared', prepared.job.id)).state).toBe('copying'));
  f.plan.mockImplementation(async (scope) => ({
    scope, roots: [{ id: 'trusted', directory: f.source, owner: 'github:2' }], fingerprint: 'transferred',
  }));
  gate.resolve();
  await vi.waitFor(async () => expect(await f.migration.status('shared', prepared.job.id)).toMatchObject({
    state: 'failed', error: 'source_changed', verifiedFiles: 0,
  }));
  expect((await (await f.request('shared', 'owner')).json()).jobs[0].running).toBe(false);
});

test('rejects a symbolic-link migration scope directory when listing jobs', async () => {
  const f = await fixture();
  const scopeDirectory = path.join(f.home, 'storage', 'migrations', Buffer.from('shared').toString('base64url'));
  fs.mkdirSync(path.dirname(scopeDirectory), { recursive: true });
  fs.symlinkSync(f.source, scopeDirectory);
  await expect(f.migration.list('shared')).rejects.toMatchObject({ code: 'invalid_request' });
});

test('lists only the 20 newest persisted migration summaries', async () => {
  const f = await fixture();
  let clock = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => ++clock);
  const ids: string[] = [];
  for (let index = 0; index < 21; index++) {
    const job = await f.migration.prepare('shared', f.profile.id, [{ id: 'trusted', directory: f.source, owner: 'owner' }]);
    ids.push(job.id);
  }
  const jobs = await f.migration.list('shared');
  expect(jobs).toHaveLength(20);
  expect(jobs.map((job) => job.id)).not.toContain(ids[0]);
  expect(new Set(jobs.map((job) => job.id)).size).toBe(20);
});

test('caps background copies at two scopes while keeping other requests available', async () => {
  const f = await fixture();
  const shared = await (await f.request('shared', 'owner', { action: 'prepare', profileId: f.profile.id })).json();
  const owner = await (await f.request('personal', 'owner', { action: 'prepare', profileId: f.ownerProfile.id })).json();
  const member = await (await f.request('personal', 'member', { action: 'prepare', profileId: f.personal.id })).json();
  const gate = f.waitUpload();
  expect((await f.request('shared', 'owner', { action: 'resume', id: shared.job.id })).status).toBe(202);
  expect((await f.request('personal', 'owner', { action: 'resume', id: owner.job.id })).status).toBe(202);
  await vi.waitFor(async () => {
    expect((await f.migration.status('shared', shared.job.id)).state).toBe('copying');
    expect((await f.migration.status('owner', owner.job.id)).state).toBe('copying');
  });
  expect((await f.request('personal', 'member', { action: 'resume', id: member.job.id })).status).toBe(409);
  expect((await f.request('personal', 'member')).status).toBe(200);
  gate.resolve();
  await vi.waitFor(async () => {
    expect((await f.migration.status('shared', shared.job.id)).state).toBe('verified');
    expect((await f.migration.status('owner', owner.job.id)).state).toBe('verified');
  });
});
