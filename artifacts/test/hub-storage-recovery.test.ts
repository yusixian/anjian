import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { type Hub, startHub } from '../src/server/hub';
import { createMemberStore } from '../src/server/member-store';
import { machinePaths, registerProject } from '../src/server/machine';
import { tempRoot, writeHtml } from './helpers';

const backendMock = vi.hoisted(() => ({
  factory: null as null | ((original: (...args: any[]) => any, args: any[]) => any),
}));
vi.mock('../src/server/storage/backend', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/server/storage/backend')>();
  return { ...original, createStorageBackend: (...args: Parameters<typeof original.createStorageBackend>) =>
    backendMock.factory ? backendMock.factory(original.createStorageBackend, args) : original.createStorageBackend(...args) };
});

const hubs: Hub[] = [];
afterEach(async () => {
  backendMock.factory = null;
  for (const hub of hubs.splice(0)) await hub.close();
});

function fixture() {
  const temp = tempRoot();
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-recovery-home-')));
  const token = 'r'.repeat(48);
  const options = { host: '127.0.0.1', urlHost: 'localhost', ports: [0], boardPorts: [0],
    viewerDir: temp.viewer, runtimeDir: temp.runtime, token, version: 'test', paths: machinePaths({ ANJIAN_SERVER_HOME: home }) };
  const project = (name: string, artifact = name) => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `anjian-recovery-${name}-`)));
    if (artifact) writeHtml(path.join(dir, '.anjian/artifacts'), artifact, { 'index.html': `<h1>${name}</h1>` });
    registerProject(options.paths.projects, dir);
    return dir;
  };
  const start = async () => { const hub = await startHub(options); hubs.push(hub); return hub; };
  const request = (hub: Hub, route: string, scope?: string) => fetch(`http://127.0.0.1:${hub.port}${route}${route.includes('?') ? '&' : '?'}key=${token}`,
    { headers: { Origin: `http://localhost:${hub.port}`, ...(scope ? { 'x-anjian-project': encodeURIComponent(scope) } : {}) } });
  return { home, options, project, start, request };
}

test('restores missing project files before project pruning and artifact indexing', async () => {
  const f = fixture();
  const dir = f.project('restored', '');
  let restored = false;
  backendMock.factory = () => ({
    async restore() {
      writeHtml(path.join(dir, '.anjian/artifacts'), 'recovered', { 'index.html': '<h1>Recovered from S3</h1>' });
      restored = true;
      return { conflicts: [], pendingScopes: [], failures: [] };
    },
    scopeFor: () => null,
    summary: () => ({ backend: 'local', bytes: 0, pending: false }),
  });
  const hub = await f.start();
  expect(restored).toBe(true);
  expect(hub.projects().map(({ dir: project }) => project)).toContain(dir);
  const listed = await (await f.request(hub, '/api/hub/artifacts')).json();
  expect(listed.artifacts.some((artifact: { id: string }) => artifact.id === 'recovered')).toBe(true);
  expect((await f.request(hub, '/html/recovered')).status).toBe(200);
});

test('a pending shared member is isolated while other owners remain available', async () => {
  const f = fixture();
  const owner = f.project('owner');
  const alice = f.project('alice');
  const bob = f.project('bob');
  const members = createMemberStore(f.home);
  for (const [id, login, dir] of [[2, 'alice', alice], [3, 'bob', bob]] as const) {
    const invite = members.invite({ id, login }, 1024);
    members.accept({ id, login }, invite.token);
    members.assignProject(dir, `github:${id}`);
  }
  backendMock.factory = () => ({
    async restore() { return { conflicts: [], pendingScopes: [], failures: [], pendingOwners: [{ scope: 'shared', owner: 'github:2' }] }; },
    scopeFor: () => 'shared',
    summary: (_scope: string, member?: string) => ({ backend: 's3', bytes: 0, pending: member === undefined || member === 'github:2' }),
  });
  const hub = await f.start();
  // Registration metadata stays intact for recovery; content enumeration is blocked.
  expect(hub.projects().map(({ dir }) => dir)).toEqual(expect.arrayContaining([owner, alice, bob]));
  await expect(hub.mountOf(alice)).rejects.toThrow();
  await expect(hub.register(alice)).rejects.toThrow();
  await expect(hub.remove(alice)).rejects.toThrow();
  await expect(hub.mountOf(bob)).resolves.toBeDefined();
  const listed = await (await f.request(hub, '/api/hub/artifacts')).json();
  expect(listed.artifacts.map((artifact: { id: string }) => artifact.id)).toEqual(expect.arrayContaining(['owner', 'bob']));
  expect(listed.artifacts.map((artifact: { id: string }) => artifact.id)).not.toContain('alice');
  expect((await f.request(hub, '/api/artifacts/html/alice', alice)).status).toBe(404);
  const storageResponse = await f.request(hub, '/api/storage?scope=shared');
  expect(storageResponse.status).toBe(200);
  const storage = await storageResponse.json();
  expect(storage.recoveryPending).toBe(true);
  expect(storage.backend).toBe('s3');
});

test('pending member with missing local cache retains registration without recreating source roots', async () => {
  const f = fixture();
  const alice = f.project('alice-missing', '');
  const members = createMemberStore(f.home);
  const invite = members.invite({ id: 2, login: 'alice' }, 1024);
  members.accept({ id: 2, login: 'alice' }, invite.token);
  members.assignProject(alice, 'github:2');
  backendMock.factory = () => ({
    async restore() { return { conflicts: [], pendingScopes: [], failures: [], pendingOwners: [{ scope: 'shared', owner: 'github:2' }] }; },
    scopeFor: () => 'shared',
    summary: (_scope: string, owner?: string) => ({ backend: 's3', bytes: 0, pending: owner === 'github:2' }),
  });
  const root = path.join(alice, '.anjian/artifacts');
  const trash = path.join(alice, '.anjian/.trash');
  const snapshots = path.join(f.home, 'shares/snapshots');
  expect(fs.existsSync(snapshots)).toBe(false);
  const hub = await f.start();
  expect(hub.projects().map(({ dir }) => dir)).toContain(alice);
  expect(fs.existsSync(root)).toBe(false);
  expect(fs.existsSync(trash)).toBe(false);
  expect(fs.existsSync(snapshots)).toBe(false);
  await expect(hub.mountOf(alice)).rejects.toThrow();
  await expect(hub.register(alice)).rejects.toThrow();
  await expect(hub.remove(alice)).rejects.toThrow();
  expect(fs.existsSync(root)).toBe(false);
  expect(fs.existsSync(trash)).toBe(false);
  expect(fs.existsSync(snapshots)).toBe(false);
  expect(hub.projects().map(({ dir }) => dir)).toContain(alice);
});

test('corrupt active binding rejects startup before opening its port', async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.home, 'storage/bindings'), { recursive: true });
  fs.writeFileSync(path.join(f.home, 'storage/bindings/active.json'), '{invalid');
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  await expect(startHub({ ...f.options, ports: [port] })).rejects.toThrow();
  const available = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => available.once('error', reject).listen(port, '127.0.0.1', resolve));
  } finally { await new Promise<void>((resolve) => available.close(() => resolve())); }
});
