import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { type Hub, startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { createStorageUsage } from '../src/server/storage/usage';
import * as documentSession from '../src/server/document-session';
import type { PreparedRemoteDocument } from '../src/server/document-session';
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
