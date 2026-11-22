import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import type { PreparedRemoteDocument } from '../src/server/document-session';
import * as documentSession from '../src/server/document-session';
import { type Hub, startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import * as storageAdmission from '../src/server/storage/request-admission';
import { createStorageSettings } from '../src/server/storage/settings';
import { createStorageUsage } from '../src/server/storage/usage';
import { tempRoot } from './helpers';

const MASTER = 'm'.repeat(48);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function reservePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-remote-api-')));
  const home = path.join(root, 'server');
  const alpha = path.join(root, 'alpha');
  const beta = path.join(root, 'beta');
  for (const project of [alpha, beta]) fs.mkdirSync(path.join(project, '.anjian', 'artifacts'), { recursive: true });
  const temp = tempRoot();
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const paths = machinePaths({ ANJIAN_SERVER_HOME: home });
  const active: Hub[] = [];
  async function start() {
    const hub = await startHub({
      host: '127.0.0.1', urlHost: '127.0.0.1', publicOrigin: origin,
      ports: [port], boardPorts: [0], viewerDir: temp.viewer, runtimeDir: temp.runtime,
      paths, token: MASTER, version: '0.1.0', debounceMs: 20,
    });
    active.push(hub);
    return hub;
  }
  let hub = await start();
  await hub.register(alpha);
  await hub.register(beta);
  cleanups.push(async () => {
    await Promise.all(active.map((item) => item.close().catch(() => undefined)));
    fs.rmSync(root, { recursive: true, force: true });
    for (const dir of [temp.root, temp.viewer, temp.runtime]) fs.rmSync(dir, { recursive: true, force: true });
  });
  const id = (dir: string) => crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32);
  const request = (route: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    // The fixture restarts on the same port; do not reuse pre-restart pooled sockets.
    headers.set('Connection', 'close');
    return fetch(`${origin}${route}`, { ...init, headers });
  };
  async function login() {
    const pair = await request('/api/remote/auth/device', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test CLI' }),
    });
    expect(pair.status).toBe(200);
    const { deviceCode, userCode } = await pair.json() as { deviceCode: string; userCode: string };
    const loginPage = await request(`/connect?code=${userCode}`, { redirect: 'manual' });
    expect(loginPage.status).toBe(303);
    expect(loginPage.headers.get('location')).toBe('/login?returnTo=' + encodeURIComponent(`/connect?code=${userCode}`));
    const approve = await request(`/api/remote/auth/approve?key=${MASTER}`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: userCode, projects: [id(alpha)] }),
    });
    expect(approve.status).toBe(200);
    const claimed = await request('/api/remote/auth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceCode }),
    });
    expect(claimed.status).toBe(200);
    const { token } = await claimed.json() as { token: string };
    return { token, headers: { Authorization: `Bearer ${token}` } };
  }
  async function restart() {
    await hub.close();
    active.splice(active.indexOf(hub), 1);
    hub = await start();
    return hub;
  }
  return { alpha, beta, home, id, origin, request, login, restart, get hub() { return hub; } };
}

const encode = (text: string) => Buffer.from(text).toString('base64');

test('whiteboard sync and browser edits share current scene and keep feedback outside the manifest', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const artifact = 'whiteboard/diagram';
  const route = `/api/remote/projects/${fx.id(fx.alpha)}`;
  const browser = `/api/${artifact}`;
  const browserHeaders = { Origin: fx.origin, 'Content-Type': 'application/json' };
  const scene = (width: number) => ({
    type: 'excalidraw',
    version: 2,
    elements: [{ id: 'box', type: 'rectangle', x: 0, y: 0, width, height: 40 }],
  });
  const put = (project: string, baseRevision: string | null, width: number) => fx.request(
    `/api/remote/projects/${project}/artifacts/${artifact}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision, files: { 'scene.excalidraw': encode(JSON.stringify(scene(width))) } }),
    },
  );
  expect((await put(fx.id(fx.beta), null, 60)).status).toBe(404);
  const created = await put(fx.id(fx.alpha), null, 80);
  expect(created.status, await created.clone().text()).toBe(200);
  const first = await created.json() as { revision: string; url: string };
  expect(first.url).toMatch(/\/whiteboard\/[a-z0-9]{21}$/i);

  const current = await fx.request(`${browser}?key=${MASTER}`);
  expect(current.status, await current.clone().text()).toBe(200);
  const { revision: browserRevision } = await current.json() as { revision: string };
  const beforeEvents = await fx.request(`${route}/events`, { headers });
  expect(beforeEvents.status).toBe(200);
  const { cursor } = await beforeEvents.json() as { cursor: string };
  const comment = await fx.request(`${browser}/comments?key=${MASTER}`, {
    method: 'POST', headers: browserHeaders,
    body: JSON.stringify({ op: 'create', elementIds: ['box'], text: 'Review the width' }),
  });
  expect(comment.status, await comment.clone().text()).toBe(200);
  const events = await fx.request(`${route}/events?cursor=${encodeURIComponent(cursor)}`, { headers });
  expect(events.status).toBe(200);
  expect((await events.json()).events).toContainEqual(expect.objectContaining({ artifact, type: 'change' }));

  const amended = await put(fx.id(fx.alpha), first.revision, 120);
  expect(amended.status, await amended.clone().text()).toBe(200);
  const { revision: remoteRevision } = await amended.json() as { revision: string };
  expect((await put(fx.id(fx.alpha), first.revision, 90)).status).toBe(409);
  expect((await fx.request(`${browser}?key=${MASTER}`, {
    method: 'POST', headers: browserHeaders,
    body: JSON.stringify({ scene: scene(60), revision: browserRevision }),
  })).status).toBe(409);

  const refreshed = await fx.request(`${browser}?key=${MASTER}`);
  const newest = await refreshed.json() as { revision: string };
  const saved = await fx.request(`${browser}?key=${MASTER}`, {
    method: 'POST', headers: browserHeaders,
    body: JSON.stringify({ scene: scene(160), revision: newest.revision }),
  });
  expect(saved.status, await saved.clone().text()).toBe(200);
  expect((await put(fx.id(fx.alpha), remoteRevision, 90)).status).toBe(409);

  const fetched = await fx.request(`${route}/artifacts/${artifact}`, { headers });
  const { files } = await fetched.json() as { files: Record<string, string> };
  expect(Object.keys(files)).toEqual(['scene.excalidraw']);
  expect(JSON.parse(Buffer.from(files['scene.excalidraw']!, 'base64').toString())).toEqual(scene(160));
  const check = await fx.request(`${route}/agent/${artifact}/check`, { method: 'POST', headers });
  expect(check.status, await check.clone().text()).toBe(200);
  expect((await check.json()).warnings).toEqual([]);
  const comments = await fx.request(`${route}/agent/${artifact}/comments`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'list', all: true }),
  });
  expect(comments.status, await comments.clone().text()).toBe(200);
  expect((await comments.json()).threads).toMatchObject([
    { anchor: { elementIds: ['box'] }, messages: [{ text: 'Review the width' }] },
  ]);
});

test('a whiteboard comment rechecks the device grant before writing', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const dir = path.join(fx.alpha, '.anjian/artifacts/whiteboard/diagram');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'scene.excalidraw'), JSON.stringify({
    type: 'excalidraw', version: 2, elements: [{ id: 'box', type: 'rectangle' }],
  }));

  let resumeComment!: () => void;
  const waitForRevocation = new Promise<void>((resolve) => { resumeComment = resolve; });
  const refresh = storageAdmission.refreshRequestStorageAdmission;
  const paused = vi.spyOn(storageAdmission, 'refreshRequestStorageAdmission')
    .mockImplementationOnce(async (req) => { await waitForRevocation; await refresh(req); });
  const route = `/api/remote/projects/${fx.id(fx.alpha)}/agent/whiteboard/diagram/comments`;
  const pendingComment = fx.request(route, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'add', elementIds: ['box'], text: 'Review the box' }),
  });
  try {
    await vi.waitFor(() => expect(paused).toHaveBeenCalledTimes(1));
    expect((await fx.request('/api/remote/auth/session', { method: 'DELETE', headers })).status)
      .toBe(200);
    resumeComment();
    const response = await pendingComment;
    expect(response.status, await response.clone().text()).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
    expect(fs.existsSync(path.join(dir, 'comments.json'))).toBe(false);
  } finally {
    resumeComment();
    await pendingComment.catch(() => undefined);
    paused.mockRestore();
  }
});

test('a scoped device transfers its project with revision checks but cannot control the server', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const project = fx.id(fx.alpha);
  const other = fx.id(fx.beta);
  const list = await fx.request('/api/remote/projects', { headers });
  expect(list.status).toBe(200);
  expect((await list.json()).projects).toEqual([{ id: project, name: 'alpha' }]);

  const put = (projectId: string, baseRevision: string | null, text: string) => fx.request(
    `/api/remote/projects/${projectId}/artifacts/document/plan`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision, files: { 'doc.xml': encode(text) } }),
    },
  );
  expect((await put(other, null, '<doc><p>foreign</p></doc>')).status).toBe(404);
  const first = await put(project, null, '<doc><p>draft</p></doc>');
  expect(first.status).toBe(200);
  const created = await first.json() as { revision: string; url: string; files: Record<string, string> };
  expect(created.url).toContain('/document/');
  expect(created.url).not.toContain('key=');
  expect(created.url).not.toContain(MASTER);
  expect(created.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
  const second = await put(project, created.revision, '<doc><p>newer</p></doc>');
  expect(second.status, await second.clone().text()).toBe(200);
  expect((await put(project, created.revision, '<doc><p>stale</p></doc>')).status).toBe(409);
  const address = 'AbCdEfGhIjKlMnOpQrStU';
  fs.writeFileSync(path.join(fx.alpha, '.anjian/artifacts/document/plan/.artifact-id'), address + '\n');
  const review = (projectId: string, id = 'plan') =>
    fx.request(`/api/remote/projects/${projectId}/agent/document/${id}/review`, {
      method: 'POST', headers,
    });
  expect((await review(other)).status).toBe(404);
  const reviewed = await review(project);
  expect(reviewed.status).toBe(200);
  expect(await reviewed.json()).toMatchObject({ type: 'review', artifact: 'document/plan', empty: true });

  const versions = (projectId: string, id = 'plan') =>
    fx.request(`/api/remote/projects/${projectId}/agent/document/${id}/changes`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ versions: true }),
    });
  expect((await versions(other)).status).toBe(404);
  const listed = await versions(project);
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({ type: 'document-changes', latest: expect.any(String) });
  expect((await review(other, address)).status).toBe(404);
  expect((await review(project, address)).status).toBe(200);
  expect((await versions(other, address)).status).toBe(404);
  expect((await versions(project, address)).status).toBe(200);

  const fetched = await fx.request(`/api/remote/projects/${project}/artifacts/document/plan`, { headers });
  expect(fetched.status).toBe(200);
  expect(Buffer.from((await fetched.json()).files['doc.xml'], 'base64').toString()).toContain('newer');

  expect((await fx.request(`/api/remote/projects/${other}/artifacts/document/plan`, { headers })).status).toBe(404);
  expect((await fx.request(`/api/remote/projects/${other}/agent/document/plan/comments`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'list' }),
  })).status).toBe(404);
  expect((await fx.request(`/api/remote/projects/${other}/events`, { headers })).status).toBe(404);
  expect((await fx.request('/api/status', { headers })).status).toBe(403);
  expect((await fx.request('/api/hub/projects', { headers })).status).toBe(403);
  expect((await fx.request('/api/hub/stop', { method: 'POST', headers })).status).toBe(403);
  expect((await fx.request(`/api/remote/projects/${project}/artifacts/document/plan`, {
    headers: { ...headers, Origin: fx.origin },
  })).status).toBe(401);
  expect((await fx.request('/api/remote/auth/session', { method: 'DELETE', headers })).status).toBe(200);
  expect((await fx.request(`/api/remote/projects/${project}/artifacts/document/plan`, { headers })).status).toBe(401);
});

test('feedback cursor replays comments after the Hub restarts', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const project = fx.id(fx.alpha);
  const route = `/api/remote/projects/${project}`;
  const uploaded = await fx.request(`${route}/artifacts/document/feedback`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision: null, files: { 'doc.xml': encode('<doc><p>Review me</p></doc>') } }),
  });
  expect(uploaded.status).toBe(200);
  const first = await fx.request(`${route}/events`, { headers });
  expect(first.status).toBe(200);
  const { cursor } = await first.json() as { cursor: string };
  const xml = fs.readFileSync(path.join(fx.alpha, '.anjian/artifacts/document/feedback/doc.xml'), 'utf8');
  const blockId = /<p id="([^"]+)"/.exec(xml)?.[1];
  expect(blockId).toBeDefined();
  const comment = await fx.request(`${route}/agent/document/feedback/comments`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'add', blockId, text: 'Please update this' }),
  });
  expect(comment.status).toBe(200);
  const human = await fx.request(`/api/document/feedback/comments?key=${MASTER}`, {
    method: 'POST', headers: { Origin: fx.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'create', blockId, quote: 'Review me', text: 'Human feedback' }),
  });
  expect(human.status).toBe(200);
  const otherDevice = await fx.login();
  const unread = async (authorization: Record<string, string>) => {
    const response = await fx.request(`${route}/agent/document/feedback/comments`, {
      method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'list', agent: 'Codex' }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).threads;
  };
  expect((await unread(headers)).length).toBeGreaterThan(0);
  expect(await unread(headers)).toEqual([]);
  expect((await unread(otherDevice.headers)).length).toBeGreaterThan(0);
  const events = await fx.request(`${route}/events?cursor=${encodeURIComponent(cursor)}`, { headers });
  expect(events.status).toBe(200);
  const received = await events.json() as { events: { type: string; artifact: string }[] };
  expect(received.events.some((event) => event.type === 'doc-comments' && event.artifact === 'document/feedback')).toBe(true);
  await fx.restart();
  const replay = await fx.request(`${route}/events?cursor=${encodeURIComponent(cursor)}`, { headers });
  expect(replay.status).toBe(200);
  const after = await replay.json() as { events: { type: string; artifact: string }[] };
  expect(after.events.some((event) => event.type === 'doc-comments' && event.artifact === 'document/feedback')).toBe(true);
});


test('shared quota rejects HTTP uploads before replacing source files and reads fresh usage', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const settings = createStorageSettings(fx.home);
  const put = (id: string, baseRevision: string | null, text: string) => fx.request(
    `/api/remote/projects/${fx.id(fx.alpha)}/artifacts/html/${id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision, files: { 'index.html': encode(text) } }),
    });
  const first = await put('quota', null, '<h1>original</h1>');
  expect(first.status).toBe(200);
  const { revision } = await first.json();
  settings.setSharedLimit(0);
  const denied = await put('quota', revision, '<h1>original plus additional content</h1>');
  expect(denied.status).toBe(413);
  expect((await denied.json()).code).toBe('storage_quota_exceeded');
  expect(fs.readFileSync(path.join(fx.alpha, '.anjian/artifacts/html/quota/index.html'), 'utf8')).toBe('<h1>original</h1>');
  expect((await put('new', null, 'hello')).status).toBe(413);
  expect(fs.existsSync(path.join(fx.alpha, '.anjian/artifacts/html/new'))).toBe(false);
  expect((await put('quota', revision, 'small')).status).toBe(200);
});


test('first document upload counts its generated collaboration snapshot before writing', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const xml = '<doc><p>new document</p></doc>';
  const settings = createStorageSettings(fx.home);
  settings.setSharedLimit(Buffer.byteLength(xml));
  const response = await fx.request(`/api/remote/projects/${fx.id(fx.alpha)}/artifacts/document/new-doc`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision: null, files: { 'doc.xml': encode(xml) } }),
  });
  expect(response.status).toBe(413);
  expect((await response.json()).code).toBe('storage_quota_exceeded');
  expect(fs.existsSync(path.join(fx.alpha, '.anjian/artifacts/document/new-doc'))).toBe(false);
  expect(fs.existsSync(path.join(fx.alpha, '.anjian/artifacts/.state/document/new-doc/doc.loro'))).toBe(false);
});

test('document edit counts collaboration growth and keeps original XML and snapshot when denied', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const route = `/api/remote/projects/${fx.id(fx.alpha)}/artifacts/document/limited`;
  const put = (baseRevision: string | null, xml: string) => fx.request(route, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision, files: { 'doc.xml': encode(xml) } }),
  });
  const initial = await put(null, '<doc><p>first</p></doc>');
  expect(initial.status).toBe(200);
  const { revision } = await initial.json() as { revision: string };
  const xmlFile = path.join(fx.alpha, '.anjian/artifacts/document/limited/doc.xml');
  const snapshotFile = path.join(fx.alpha, '.anjian/artifacts/.state/document/limited/doc.loro');
  const previousXml = fs.readFileSync(xmlFile);
  const previousSnapshot = fs.readFileSync(snapshotFile);
  const usage = createStorageUsage({
    projects: () => [{ dir: fx.alpha, owner: 'owner' }, { dir: fx.beta, owner: 'owner' }],
    snapshotsRoot: path.join(fx.home, 'shares/snapshots'), snapshots: () => [],
  });
  createStorageSettings(fx.home).setSharedLimit((await usage.measure('owner')).shared + 1);
  const denied = await put(revision, '<doc><p>other</p></doc>');
  expect(denied.status).toBe(413);
  expect((await denied.json()).code).toBe('storage_quota_exceeded');
  expect(fs.readFileSync(xmlFile).equals(previousXml)).toBe(true);
  expect(fs.readFileSync(snapshotFile).equals(previousSnapshot)).toBe(true);
});


test('first document succeeds with a conservative XML and snapshot budget and no later uncharged growth', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const route = `/api/remote/projects/${fx.id(fx.alpha)}/artifacts/document/boundary`;
  const xml = '<doc><p>boundary</p></doc>';
  const usage = createStorageUsage({
    projects: () => [{ dir: fx.alpha, owner: 'owner' }, { dir: fx.beta, owner: 'owner' }],
    snapshotsRoot: path.join(fx.home, 'shares/snapshots'), snapshots: () => [],
  });
  // Ensure the mounted project metadata is present in the baseline.
  expect((await fx.request(route, { headers })).status).toBe(200);
  await vi.waitFor(() => expect(fs.existsSync(path.join(fx.alpha, '.anjian/artifacts/.state/document/boundary/warnings.json'))).toBe(true));
  const before = (await usage.measure('owner')).shared;
  let planned: PreparedRemoteDocument | undefined;
  let limit = 0;
  const original = documentSession.prepareNewRemoteDocument;
  const spy = vi.spyOn(documentSession, 'prepareNewRemoteDocument').mockImplementation((source, file) => {
    planned = original(source, file);
    queueMicrotask(() => {
      limit = before + Buffer.byteLength(planned!.xml) + planned!.stateDeltaBytes;
      createStorageSettings(fx.home).setSharedLimit(limit);
    });
    return planned;
  });
  let response: Response;
  try {
    response = await fx.request(route, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: null, files: { 'doc.xml': encode(xml) } }),
    });
  } finally { spy.mockRestore(); }
  expect(planned).toBeDefined();
  expect(response.status).toBe(200);
  const actual = (await usage.measure('owner')).shared;
  expect(actual).toBeLessThanOrEqual(limit);
  const doc = path.join(fx.alpha, '.anjian/artifacts/document/boundary/doc.xml');
  expect(fs.existsSync(doc)).toBe(true);
  // The admitted state delta also includes replacing warnings.json, so compare total usage above.
});

test('first document upload persists its warning state before acknowledgement and the next quota scan', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const route = `/api/remote/projects/${fx.id(fx.alpha)}/artifacts/document/metadata`;
  const put = (baseRevision: string | null, xml: string) => fx.request(route, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision, files: { 'doc.xml': encode(xml) } }),
  });
  const first = await put(null, '<doc><p>first</p></doc>');
  expect(first.status).toBe(200);
  const { revision } = await first.json() as { revision: string };
  const warnings = path.join(fx.alpha, '.anjian/artifacts/.state/document/metadata/warnings.json');
  const identity = path.join(fx.alpha, '.anjian/artifacts/document/metadata/.artifact-id');
  expect(fs.statSync(warnings).size).toBeGreaterThan(0);
  expect(fs.statSync(identity).size).toBeGreaterThan(0);
  const usage = createStorageUsage({
    projects: () => [{ dir: fx.alpha, owner: 'owner' }, { dir: fx.beta, owner: 'owner' }],
    snapshotsRoot: path.join(fx.home, 'shares/snapshots'), snapshots: () => [],
  });
  createStorageSettings(fx.home).setSharedLimit((await usage.measure('owner')).shared);
  const denied = await put(revision, '<doc><p>other</p></doc>');
  expect(denied.status).toBe(413);
  expect((await denied.json()).code).toBe('storage_quota_exceeded');
});

test('HTML generated state is charged and persisted before a successful upload responds', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const route = `/api/remote/projects/${fx.id(fx.alpha)}/artifacts/html/first-html`;
  const content = '<html><head><title>One</title></head><body>hello</body></html>';
  const put = (name: string) => fx.request(`/api/remote/projects/${fx.id(fx.alpha)}/artifacts/html/${name}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision: null, files: { 'index.html': encode(content) } }),
  });
  expect((await put('first-html')).status).toBe(200);
  const state = path.join(fx.alpha, '.anjian/artifacts/.state/html/first-html/warnings.json');
  const identity = path.join(fx.alpha, '.anjian/artifacts/html/first-html/.artifact-id');
  expect(JSON.parse(fs.readFileSync(state, 'utf8'))).toMatchObject({ warnings: [], ran: false });
  const usage = createStorageUsage({
    projects: () => [{ dir: fx.alpha, owner: 'owner' }, { dir: fx.beta, owner: 'owner' }],
    snapshotsRoot: path.join(fx.home, 'shares/snapshots'), snapshots: () => [],
  });
  const before = (await usage.measure('owner')).shared;
  createStorageSettings(fx.home).setSharedLimit(before + Buffer.byteLength(content) + fs.statSync(identity).size);
  const denied = await put('second-html');
  expect(denied.status).toBe(413);
  expect((await denied.json()).code).toBe('storage_quota_exceeded');
  expect(fs.existsSync(path.join(fx.alpha, '.anjian/artifacts/html/second-html'))).toBe(false);
  expect(fs.existsSync(path.join(fx.alpha, '.anjian/artifacts/.state/html/second-html/warnings.json'))).toBe(false);
  expect((await fx.request(route, { headers })).status).toBe(200);
});

test('artboard generated layout and warnings are charged before a second creation', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const route = `/api/remote/projects/${fx.id(fx.alpha)}/artifacts/artboard/`;
  const canvas = JSON.stringify({ version: 1, title: 'First', pages: [{ id: 'main', name: 'Main' }],
    boards: { demo: { page: 'main', file: 'pages/main/demo.html', x: 0, y: 0, w: 640, h: 400 } } });
  const html = '<html><body>board</body></html>';
  const put = (id: string, baseRevision: string | null, spec = canvas) => fx.request(`${route}${id}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision, files: { 'canvas.json': encode(spec), 'pages/main/demo.html': encode(html) } }),
  });
  const created = await put('first-board', null);
  expect(created.status).toBe(200);
  const { revision } = await created.json() as { revision: string };
  const stateDir = path.join(fx.alpha, '.anjian/artifacts/.state/artboard/first-board');
  expect(fs.statSync(path.join(stateDir, 'layout.json')).size).toBeGreaterThan(0);
  expect(fs.statSync(path.join(stateDir, 'warnings.json')).size).toBeGreaterThan(0);
  const identitySize = fs.statSync(path.join(fx.alpha, '.anjian/artifacts/artboard/first-board/.artifact-id')).size;
  const usage = createStorageUsage({
    projects: () => [{ dir: fx.alpha, owner: 'owner' }, { dir: fx.beta, owner: 'owner' }],
    snapshotsRoot: path.join(fx.home, 'shares/snapshots'), snapshots: () => [],
  });
  const before = (await usage.measure('owner')).shared;
  createStorageSettings(fx.home).setSharedLimit(before + Buffer.byteLength(canvas) + Buffer.byteLength(html) + identitySize);
  const denied = await put('second-board', null);
  expect(denied.status).toBe(413);
  expect((await denied.json()).code).toBe('storage_quota_exceeded');
  expect(fs.existsSync(path.join(fx.alpha, '.anjian/artifacts/artboard/second-board'))).toBe(false);
  expect(fs.existsSync(path.join(fx.alpha, '.anjian/artifacts/.state/artboard/second-board/layout.json'))).toBe(false);
  const expandedLayout = JSON.stringify({ version: 1, title: 'Fir', pages: [{ id: 'main', name: 'Main' }],
    boards: { demo: { page: 'main', file: 'pages/main/demo.html', x: 999, y: 0, w: 640, h: 400 } } });
  expect(Buffer.byteLength(expandedLayout)).toBe(Buffer.byteLength(canvas));
  const originalCanvas = fs.readFileSync(path.join(fx.alpha, '.anjian/artifacts/artboard/first-board/canvas.json'));
  const originalLayout = fs.readFileSync(path.join(stateDir, 'layout.json'));
  createStorageSettings(fx.home).setSharedLimit(before);
  const deniedUpdate = await put('first-board', revision, expandedLayout);
  expect(deniedUpdate.status).toBe(413);
  expect((await deniedUpdate.json()).code).toBe('storage_quota_exceeded');
  expect(fs.readFileSync(path.join(fx.alpha, '.anjian/artifacts/artboard/first-board/canvas.json')).equals(originalCanvas)).toBe(true);
  expect(fs.readFileSync(path.join(stateDir, 'layout.json')).equals(originalLayout)).toBe(true);
  // The first board and its generated metadata remain readable after rejection.
  expect((await fx.request(`${route}first-board`, { headers })).status).toBe(200);
  expect(revision).toMatch(/^sha256:/);
});

test('scoped CLI document comments cannot bypass shared quota through forwarding', async () => {
  const fx = await fixture(); const { headers } = await fx.login();
  const dir = path.join(fx.alpha, '.anjian/artifacts/document/comment-budget'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'doc.xml'), '<doc><p id="budget-block">Review</p></doc>');
  const route = `/api/remote/projects/${fx.id(fx.alpha)}/agent/document/comment-budget/comments`;
  const settings = createStorageSettings(fx.home); settings.setSharedLimit(0);
  const post = () => fx.request(route, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'add', blockId: 'budget-block', text: 'blocked until capacity is available' }) });
  const denied = await post();
  expect(denied.status, await denied.clone().text()).toBe(413);
  expect(fs.existsSync(path.join(dir, 'comments.json'))).toBe(false);
  settings.setSharedLimit(1024 * 1024);
  expect((await post()).status).toBe(200);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'comments.json'), 'utf8')).threads).toHaveLength(1);
});

test('board human, agent and CLI choice operations share quota admission', async () => {
  const fx = await fixture(); const { headers } = await fx.login();
  const dir = path.join(fx.alpha, '.anjian/artifacts/artboard/board-budget'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.html'), '<p>Option A</p>');
  fs.writeFileSync(path.join(dir, 'canvas.json'), JSON.stringify({ version: 1, pages: [{ id: 'p', name: 'P' }],
    boards: { a: { file: 'a.html', page: 'p', x: 0, y: 0, w: 200, h: 100 } },
    groups: { q: { boards: ['a'], choose: true } }, notes: { r: { page: 'p', kind: 'title', x: 0, y: -400, text: 'Round' } } }));
  const remote = `/api/remote/projects/${fx.id(fx.alpha)}/agent/artboard/board-budget/comments`;
  const settings = createStorageSettings(fx.home); settings.setSharedLimit(0);
  const cli = (body: object) => fx.request(remote, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const human = await fx.request(`/api/artboard/board-budget/comments?key=${MASTER}`, { method: 'POST', headers: { Origin: fx.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'create', anchor: { page: 'p', board: 'a', x: 1, y: 1 }, text: 'human quota' }) });
  expect(human.status, await human.clone().text()).toBe(413);
  const direct = await fx.request(`/api/agent/artboard/board-budget/comments?key=${MASTER}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'add', board: 'a', text: 'agent quota' }) });
  expect(direct.status, await direct.clone().text()).toBe(413);
  expect((await cli({ op: 'choose', group: 'q', board: 'a' })).status).toBe(413);
  const file = path.join(dir, 'comments.json'); expect(fs.existsSync(file)).toBe(false);
  settings.setSharedLimit(1024 * 1024);
  expect((await cli({ op: 'choose', group: 'q', board: 'a' })).status).toBe(200);
  const before = fs.readFileSync(file, 'utf8');
  settings.setSharedLimit(0);
  const denied = await cli({ op: 'submit', round: 'r', submit: true });
  expect(denied.status, await denied.clone().text()).toBe(413);
  expect(fs.readFileSync(file, 'utf8')).toBe(before);
  settings.setSharedLimit(1024 * 1024);
  expect((await cli({ op: 'submit', round: 'r', submit: true })).status).toBe(200);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).threads).toHaveLength(2);
});

test('CLI unread cursor writes cannot bypass storage quota', async () => {
  const fx = await fixture(); const { headers } = await fx.login();
  const dir = path.join(fx.alpha, '.anjian/artifacts/document/cursor-budget'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'doc.xml'), '<doc><p id="b1">Review</p></doc>');
  const human = await fx.request(`/api/document/cursor-budget/comments?key=${MASTER}`, {
    method: 'POST', headers: { Origin: fx.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'create', blockId: 'b1', quote: 'Review', text: 'Please review' }),
  });
  expect(human.status, await human.clone().text()).toBe(200);
  const route = `/api/remote/projects/${fx.id(fx.alpha)}/agent/document/cursor-budget/comments`;
  const settings = createStorageSettings(fx.home); settings.setSharedLimit(0);
  const post = () => fx.request(route, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'list' }) });
  const denied = await post(); expect(denied.status, await denied.clone().text()).toBe(413);
  const file = path.join(fx.alpha, '.anjian/artifacts/.state/document/cursor-budget/comment-cursors.json');
  expect(fs.existsSync(file)).toBe(false);
  settings.setSharedLimit(1024 * 1024);
  const retry = await post(); expect(retry.status, await retry.clone().text()).toBe(200);
  expect((await retry.json()).threads).toHaveLength(1);
  expect((await (await post()).json()).threads).toHaveLength(0);
});

test('comment receipts bind to the authenticated device even when session names match', async () => {
  const fx = await fixture();
  const first = await fx.login();
  const second = await fx.login();
  const artifact = 'document/receipt-device';
  const dir = path.join(fx.alpha, '.anjian/artifacts', artifact);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'doc.xml'), '<doc><p id="b1">Review</p></doc>');
  const human = await fx.request(`/api/${artifact}/comments?key=${MASTER}`, {
    method: 'POST', headers: { Origin: fx.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'create', blockId: 'b1', quote: 'Review', text: 'Please review' }),
  });
  expect(human.status).toBe(200);
  const post = (headers: Record<string, string>, body: object, project = fx.id(fx.alpha)) =>
    fx.request(`/api/remote/projects/${project}/agent/${artifact}/comments`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'codex:shared-name', ...body }),
    });
  const original = await post(first.headers, { op: 'receipt-list' });
  expect(original.status).toBe(200);
  const { threads: [{ receipts }] } = await original.json();
  expect(await (await post(second.headers, { op: 'confirm-read', receipts })).json()).toEqual({ confirmed: 0 });
  const settings = createStorageSettings(fx.home);
  settings.setSharedLimit(0);
  expect((await post(first.headers, { op: 'confirm-read', receipts })).status).toBe(413);
  settings.setSharedLimit(1024 * 1024);
  expect(await (await post(first.headers, { op: 'confirm-read', receipts })).json()).toEqual({ confirmed: 2 });
  expect((await (await post(first.headers, { op: 'receipt-list' })).json()).threads).toEqual([]);
  expect((await (await post(second.headers, { op: 'receipt-list' })).json()).threads).toHaveLength(1);
  expect((await post(first.headers, { op: 'receipt-list' }, fx.id(fx.beta))).status).toBe(404);
});

test('document download at zero quota returns persisted bytes without uncharged normalization', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const settings = createStorageSettings(fx.home);
  settings.setSharedLimit(0);
  const directory = path.join(fx.alpha, '.anjian/artifacts/document/read-budget');
  fs.mkdirSync(directory, { recursive: true });
  const original = '<doc><p>download this original</p></doc>';
  const file = path.join(directory, 'doc.xml');
  const snapshot = path.join(fx.alpha, '.anjian/artifacts/.state/document/read-budget/doc.loro');
  fs.writeFileSync(file, original);
  const route = `/api/remote/projects/${fx.id(fx.alpha)}/artifacts/document/read-budget`;
  try {
    const response = await fx.request(route, { headers });
    expect(response.status, await response.clone().text()).toBe(200);
    const downloaded = await response.json();
    expect(Buffer.from(downloaded.files['doc.xml'], 'base64').toString()).toBe(original);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.existsSync(snapshot)).toBe(false);
    const again = await fx.request(route, { headers });
    expect((await again.json()).revision).toBe(downloaded.revision);
    settings.setSharedLimit(1024 * 1024);
    const normalized = await (await fx.request(route, { headers })).json();
    expect(fs.existsSync(snapshot)).toBe(true);
    expect(Buffer.from(normalized.files['doc.xml'], 'base64').toString()).toContain('id="');
    const updated = await fx.request(route, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: normalized.revision, files: { 'doc.xml': encode('<doc><p>next edit</p></doc>') } }),
    });
    expect(updated.status, await updated.clone().text()).toBe(200);
    expect(fs.readFileSync(file, 'utf8')).toContain('next edit');
  } finally { settings.setSharedLimit(1024 * 1024); }
});

test('a linked device can transfer a deck and review it by stable slide ID', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const project = fx.id(fx.alpha);
  const other = fx.id(fx.beta);
  const prefix = `/api/remote/projects/${project}`;
  const artifact = 'slides/briefing';
  const deck = {
    version: 1,
    title: 'Briefing',
    slides: [{ id: 'plan', title: 'Plan', body: 'Customer rollout', notes: 'Internal notes' }],
  };
  const files = { 'deck.json': encode(JSON.stringify(deck)) };
  const json = (method: string, body: unknown) => ({
    method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const uploaded = await fx.request(`${prefix}/artifacts/${artifact}`, json('PUT', { baseRevision: null, files }));
  expect(uploaded.status, await uploaded.clone().text()).toBe(200);
  const source = await uploaded.json();
  expect(source).toMatchObject({ files, revision: expect.stringMatching(/^sha256:/) });
  const comment = (body: unknown, projectId = project) =>
    fx.request(`/api/remote/projects/${projectId}/agent/${artifact}/comments`, json('POST', body));
  const addition = { op: 'add', slideId: 'plan', text: 'Clear next steps', cursor: 'review-device' };
  expect((await comment(addition, other)).status).toBe(404);
  expect((await comment({ ...addition, slideId: 'missing' })).status).toBe(409);
  expect((await comment(addition)).status).toBe(200);
  const listed = await comment({ op: 'list', all: true, cursor: 'review-device' });
  expect(listed.status, await listed.clone().text()).toBe(200);
  expect((await listed.json()).threads[0]).toMatchObject({ anchor: { slideId: 'plan' } });

  const fetched = await fx.request(`${prefix}/artifacts/${artifact}`, { headers });
  expect(fetched.status).toBe(200);
  expect(await fetched.json()).toMatchObject({ files, revision: source.revision });
  const checked = await fx.request(`${prefix}/agent/${artifact}/check`, json('POST', {}));
  expect(checked.status, await checked.clone().text()).toBe(200);
  expect((await checked.json()).warnings).toEqual([]);
});

test('a linked device syncs storyboards and keeps clip reviews outside the source manifest', async () => {
  const fx = await fixture();
  const { headers } = await fx.login();
  const prefix = `/api/remote/projects/${fx.id(fx.alpha)}`;
  const source = `${prefix}/artifacts/storyboard/demo`;
  const comments = `${prefix}/agent/storyboard/demo/comments`;
  const json = (method: string, body: unknown) => ({
    method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const timeline = {
    version: 1, title: 'Demo', tracks: [{
      id: 'picture', kind: 'video', name: 'Picture', clips: [{
        id: 'opening', asset: 'assets/cover.png', durationMs: 250, startMs: 0, trimMs: 0,
      }],
    }],
  };
  const files = {
    'timeline.json': encode(JSON.stringify(timeline)),
    'assets/cover.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcXQAAAAASUVORK5CYII=',
  };
  const uploaded = await fx.request(source, json('PUT', { baseRevision: null, files }));
  expect(uploaded.status, await uploaded.clone().text()).toBe(200);
  const snapshot = await uploaded.json();
  const pushed = await fx.request(comments, json('POST', { op: 'add', clipId: 'opening', text: 'Tighten the opening' }));
  expect(pushed.status, await pushed.clone().text()).toBe(200);
  const listed = await fx.request(comments, json('POST', { op: 'list', all: true }));
  expect((await listed.json()).threads[0]).toMatchObject({ anchor: { clipId: 'opening' } });
  const checked = await fx.request(`${prefix}/agent/storyboard/demo/check`, json('POST', {}));
  expect(checked.status, await checked.clone().text()).toBe(200);
  expect((await checked.json()).warnings).toEqual([]);
  const pulled = await fx.request(source, { headers });
  expect(await pulled.json()).toMatchObject({ files, revision: snapshot.revision });
});
