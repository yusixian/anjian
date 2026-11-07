import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { type Hub, startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
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
  const request = (route: string, init?: RequestInit) => fetch(`${origin}${route}`, init);
  async function login() {
    const pair = await request('/api/remote/auth/device', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test CLI' }),
    });
    expect(pair.status).toBe(200);
    const { deviceCode, userCode } = await pair.json() as { deviceCode: string; userCode: string };
    expect((await request(`/connect?code=${userCode}`)).status).toBe(403);
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
  expect(second.status).toBe(200);
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
