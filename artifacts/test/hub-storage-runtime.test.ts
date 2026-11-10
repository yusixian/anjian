import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { startHub, type Hub } from '../src/server/hub';
import { machinePaths, registerProject } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { createStorageMigration } from '../src/server/storage/migration';
import { createStorageBackend } from '../src/server/storage/backend';
import type { FileDigest, StoredObject } from '../src/server/storage/objects';
import { tempRoot, writeHtml } from './helpers';

const remote = vi.hoisted(() => ({ data: new Map<string, Buffer>(), fail: false }));
vi.mock('../src/server/storage/objects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/storage/objects')>();
  return { ...actual, createS3Objects: (_settings: unknown, _credentials: unknown, namespace: string) => ({
    reference(digest: FileDigest): StoredObject { return { ...digest, key: `${namespace}/${digest.sha256}` }; },
    async verify(ref: StoredObject) {
      if (remote.fail) throw new Error('private provider failure');
      const data = remote.data.get(ref.key);
      if (!data || data.length !== ref.bytes || crypto.createHash('sha256').update(data).digest('hex') !== ref.sha256) throw new Error('missing object');
      return ref;
    },
    async upload(file: string, digest: FileDigest) {
      if (remote.fail) throw new Error('private provider failure');
      const ref = this.reference(digest); remote.data.set(ref.key, fs.readFileSync(file));
      return this.verify(ref);
    },
    async download(ref: StoredObject, directory: string) {
      await this.verify(ref);
      const target = path.join(directory, crypto.randomUUID()); fs.writeFileSync(target, remote.data.get(ref.key)!); return target;
    },
    close() {},
  }) };
});
const hubs: Hub[] = [];
afterEach(async () => { remote.fail = false; for (const hub of hubs.splice(0)) await hub.close(); remote.data.clear(); });

async function fixture(local = false) {
  const temp = tempRoot(); const base = fs.realpathSync(temp.root);
  const home = path.join(base, 'home'); const project = path.join(base, 'project');
  const artifacts = path.join(project, '.anjian/artifacts');
  writeHtml(artifacts, 'sample', { 'index.html': '<h1>original</h1>' });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: home }); registerProject(paths.projects, project);
  const settings = createStorageSettings(home);
  const profile = settings.save('shared', { endpoint: 'https://objects.example', bucket: 'private-bucket', region: 'auto', prefix: '', forcePathStyle: true }, { accessKeyId: 'fixture', secretAccessKey: 'fixture' });
  settings.recordTest('shared', profile.id, { ok: true, checkedAt: Date.now(), steps: { write: true, read: true, delete: true } });
  const migration = createStorageMigration(home, { resolveProfile: settings.resolve });
  const backend = createStorageBackend(home, { migration, resolveProfile: settings.resolve });
  const job = await migration.prepare('shared', profile.id, [{ id: 'project', directory: artifacts, owner: 'owner', kind: 'artifacts' }]);
  await migration.resume('shared', job.id); if (!local) await backend.activate('shared', job.id, async () => {});
  const start = async () => { const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1', ports: [0], boardPorts: [0], token: 't'.repeat(48), version: 'test', viewerDir: temp.viewer, runtimeDir: temp.runtime }); hubs.push(hub); return hub; };
  const request = (hub: Hub, route: string, body?: unknown) => {
    const origin = `http://127.0.0.1:${hub.port}`;
    return fetch(origin + route, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { Origin: origin, 'Content-Type': 'application/json' } });
  };
  return { home, project, artifacts, backend, settings, profile, start, request };
}

test('live S3 dirty markers permit editing and manual synchronization retains the mounted session', async () => {
  const f = await fixture(); const hub = await f.start();
  const mount = await hub.mountOf(f.project);
  expect(f.backend.summary('shared', 'owner').pending).toBe(true);
  const before = await (await f.request(hub, '/api/storage?scope=personal')).json();
  expect(before).toMatchObject({ backend: 's3', recoveryPending: false, sync: { state: 'pending' } });
  fs.writeFileSync(path.join(f.artifacts, 'html/sample/index.html'), '<h1>local edit</h1>');
  const synced = await f.request(hub, '/api/storage?scope=personal', { action: 'sync' });
  expect(synced.status, await synced.clone().text()).toBe(200);
  expect(await synced.json()).toMatchObject({ sync: { state: 'ready', lastSyncedAt: expect.any(Number) } });
  expect(await hub.mountOf(f.project)).toBe(mount);
  expect([...remote.data.values()].some((data) => data.toString().includes('local edit'))).toBe(true);
  expect(f.backend.summary('shared', 'owner').pending).toBe(true);
  expect((await f.request(hub, '/html/sample')).status).toBe(200);
});

test('provider failure retains local edits and live access, while restart requires explicit recovery', async () => {
  const f = await fixture(); const hub = await f.start();
  await hub.mountOf(f.project);
  const source = path.join(f.artifacts, 'html/sample/index.html');
  fs.writeFileSync(source, '<h1>keep local</h1>'); remote.fail = true;
  const failed = await f.request(hub, '/api/storage?scope=personal', { action: 'sync' });
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('private provider');
  expect(await (await f.request(hub, '/api/storage?scope=personal')).json()).toMatchObject({ recoveryPending: false, sync: { state: 'error' } });
  expect((await f.request(hub, '/html/sample')).status).toBe(200);
  expect(fs.readFileSync(source, 'utf8')).toContain('keep local');
  remote.fail = false;
  expect((await f.request(hub, '/api/storage?scope=personal', { action: 'sync' })).status).toBe(200);
  await hub.close(); hubs.splice(hubs.indexOf(hub), 1);
  const restarted = await f.start();
  expect(await (await f.request(restarted, '/api/storage?scope=personal')).json()).toMatchObject({ recoveryPending: true, sync: { state: 'recovery' } });
  await expect(restarted.mountOf(f.project)).rejects.toThrow('存储尚未恢复');
  expect(fs.readFileSync(source, 'utf8')).toContain('keep local');
  expect((await f.request(restarted, '/api/storage?scope=personal', { action: 'recover-local' })).status).toBe(400);
  const recovery = { action: 'recover-local', confirm: 'use-retained-local-files' };
  remote.fail = true;
  expect((await f.request(restarted, '/api/storage?scope=personal', recovery)).status).toBe(503);
  await expect(restarted.mountOf(f.project)).rejects.toThrow('存储尚未恢复');
  remote.fail = false;
  expect((await f.request(restarted, '/api/storage?scope=personal', recovery)).status).toBe(200);
  expect(await (await f.request(restarted, '/api/storage?scope=personal')).json()).toMatchObject({ recoveryPending: false, sync: { state: 'ready' } });
  expect((await f.request(restarted, '/html/sample')).status).toBe(200);
});

test('recovery refuses a missing resource directory without recreating it', async () => {
  const f = await fixture(); const hub = await f.start();
  await hub.mountOf(f.project);
  expect((await f.request(hub, '/api/storage?scope=personal', { action: 'sync' })).status).toBe(200);
  await hub.close(); hubs.splice(hubs.indexOf(hub), 1);
  fs.renameSync(f.artifacts, f.artifacts + '-retained');
  const restarted = await f.start();
  const result = await f.request(restarted, '/api/storage?scope=personal', { action: 'recover-local', confirm: 'use-retained-local-files' });
  expect(result.status).toBe(503);
  expect(fs.existsSync(f.artifacts)).toBe(false);
  await expect(restarted.mountOf(f.project)).rejects.toThrow('存储尚未恢复');
});

test('verified GUI activation protects shared then personal bindings without replacing mounted editors', async () => {
  const f = await fixture(true); const hub = await f.start();
  const mount = await hub.mountOf(f.project);
  const prepareAndActivate = async (scope: 'shared' | 'personal', profileId: string) => {
    const url = `/api/storage/migrations?scope=${scope}`;
    const prepared = await f.request(hub, url, { action: 'prepare', profileId });
    expect(prepared.status, await prepared.clone().text()).toBe(201);
    const { job } = await prepared.json();
    const activate = { action: 'activate', id: job.id, confirm: 'retain-original-files' };
    expect((await f.request(hub, url, { action: 'activate', id: job.id })).status).toBe(400);
    expect((await f.request(hub, url, activate)).status).not.toBe(200);
    expect((await f.request(hub, url, { action: 'resume', id: job.id })).status).toBe(202);
    await vi.waitFor(async () => {
      const { jobs } = await (await f.request(hub, url)).json();
      expect(jobs.find((entry: { id: string }) => entry.id === job.id)).toMatchObject({ state: 'verified', running: false });
    });
    const response = await f.request(hub, url, activate);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await hub.mountOf(f.project)).toBe(mount);
    expect(await (await f.request(hub, '/api/storage?scope=personal')).json()).toMatchObject({ backend: 's3', recoveryPending: false });
    expect(f.backend.summary(scope === 'personal' ? 'owner' : scope, 'owner').pending).toBe(true);
    const { jobs } = await (await f.request(hub, url)).json();
    expect(jobs.find((entry: { id: string }) => entry.id === job.id).active).toBe(true);
    fs.writeFileSync(path.join(f.artifacts, 'html/sample/index.html'), '<h1>after activation</h1>');
    // A lost success response can be retried without resetting to the old snapshot.
    expect((await f.request(hub, url, activate)).status).toBe(200);
    expect(fs.readFileSync(path.join(f.artifacts, 'html/sample/index.html'), 'utf8')).toContain('after activation');
  };
  await prepareAndActivate('shared', f.profile.id);
  const personal = f.settings.save('owner', { endpoint: 'https://personal.example', bucket: 'own', region: 'auto', prefix: '', forcePathStyle: true }, { accessKeyId: 'fixture', secretAccessKey: 'fixture' });
  f.settings.recordTest('owner', personal.id, { ok: true, checkedAt: Date.now(), steps: { write: true, read: true, delete: true } });
  await prepareAndActivate('personal', personal.id);
  expect(f.backend.scopeFor('owner')).toBe('owner');
  expect(await (await f.request(hub, '/api/storage?scope=personal')).json()).toMatchObject({ allocation: 'personal', usage: { total: expect.any(Number) } });
  expect(await (await f.request(hub, '/api/storage?scope=shared')).json()).toMatchObject({ allocation: 'shared', usage: { total: 0 } });
});
