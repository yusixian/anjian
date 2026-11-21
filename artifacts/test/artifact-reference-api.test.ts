import fs from 'node:fs';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { tempRoot, writeArtboard, writeHtml } from './helpers';

const cleanup: (() => Promise<void>)[] = [];
const stableId = 'A'.repeat(21);
const missingId = 'b'.repeat(21);
const htmlReference = '/api/artifact-reference/html/';
const artboardReference = '/api/artifact-reference/artboard/';

afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});

async function fixture() {
  const temp = tempRoot();
  const home = fs.realpathSync(temp.root);
  const project = path.join(home, 'project');
  const root = path.join(project, '.anjian/artifacts');
  fs.mkdirSync(root, { recursive: true });
  const hub = await startHub({
    host: '0.0.0.0',
    urlHost: 'localhost',
    ports: [0],
    boardPorts: [0],
    boardOrigin: 'https://preview.example',
    paths: machinePaths({ ANJIAN_SERVER_HOME: path.join(home, 'server') }),
    viewerDir: temp.viewer,
    runtimeDir: temp.runtime,
    token: 't'.repeat(48),
    version: 'test',
  });
  cleanup.push(async () => {
    await hub.close();
    for (const dir of Object.values(temp)) fs.rmSync(dir, { recursive: true, force: true });
  });
  await hub.register(project);
  const base = `http://localhost:${hub.port}`;
  const headers = { Cookie: `anjian_artifacts_${hub.port}=${hub.token}`, Origin: base };
  const request = (route: string, init?: RequestInit) => fetch(base + route, init);
  const get = (route: string) => request(route, { headers });
  const post = (route: string, body: object) =>
    request(route, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { home, project, root, hub, request, get, post };
}

function writePreview(root: string, slug = 'preview') {
  return writeHtml(root, slug, {
    'index.html': '<!doctype html><title>Private preview</title><p>Draft</p>',
    '.artifact-id': `${stableId}\n`,
  });
}

test('reference resolves the exact stable ID across a rename and disappears from trash or an unregistered project', async () => {
  const { hub, root, project, get, post } = await fixture();
  const dir = writePreview(root);
  const slugOnly = writeHtml(root, missingId, { 'index.html': '<title>Slug only</title>' });
  const route = htmlReference + stableId;
  const expected = { href: `/html/${stableId}?ref=1`, title: 'Private preview' };
  async function resolve() {
    const result = await get(route);
    expect(result.status).toBe(200);
    return result.json();
  }

  expect(await resolve()).toEqual(expected);
  expect((await get(htmlReference + missingId)).status).toBe(404);
  expect((await get(`/html/${missingId}?ref=1`)).status).toBe(404);
  expect(fs.existsSync(path.join(slugOnly, '.artifact-id'))).toBe(false);
  const corrupt = writeHtml(root, stableId, {
    'index.html': '<title>Damaged metadata</title>',
    '.artifact-id': 'invalid ID',
  });
  expect(await resolve()).toEqual(expected);
  expect((await get(expected.href)).status).toBe(200);
  expect(fs.readFileSync(path.join(corrupt, '.artifact-id'), 'utf8')).toBe('invalid ID');

  fs.renameSync(dir, path.join(root, 'html', 'moved'));
  fs.writeFileSync(path.join(root, 'html/moved/index.html'), '<title>Moved preview</title>');
  expect(await resolve()).toEqual({ ...expected, title: 'Moved preview' });
  const moved = await get(expected.href);
  expect(moved.status).toBe(200);
  expect(await moved.text()).toContain('<title>Moved preview</title>');

  const list = await (await get('/api/hub/artifacts')).json();
  const item = list.artifacts.find((artifact: { id: string }) => artifact.id === 'moved');
  expect(item).toBeDefined();
  const trash = await post('/api/hub/trash', { items: [item] });
  expect(trash.status).toBe(200);
  const { results } = await trash.json();
  expect(results[0].ok).toBe(true);
  expect((await get(route)).status).toBe(404);
  expect((await get(expected.href)).status).toBe(404);

  const restore = await post('/api/hub/trash/restore', {
    items: [{ project, trashId: results[0].entry.trashId }],
  });
  expect((await restore.json()).results[0].ok).toBe(true);
  expect(await resolve()).toEqual({ ...expected, title: 'Moved preview' });

  await hub.remove(project);
  expect((await get(route)).status).toBe(404);
  expect((await get(expected.href)).status).toBe(404);
});

test('a trashed directory name does not shadow another artifact with that stable address', async () => {
  const { root, get, post } = await fixture();
  const address = 'b'.repeat(21);
  writeHtml(root, 'target', {
    'index.html': '<title>Live target</title>',
    '.artifact-id': address,
  });
  writePreview(root, address);
  const list = await (await get('/api/hub/artifacts')).json();
  const item = list.artifacts.find((artifact: { id: string }) => artifact.id === address);
  expect(item).toBeDefined();
  const trash = await post('/api/hub/trash', { items: [item] });
  expect((await trash.json()).results[0].ok).toBe(true);
  const reference = await get(htmlReference + address);
  expect(reference.status).toBe(200);
  expect(await reference.json()).toEqual({ href: `/html/${address}?ref=1`, title: 'Live target' });
});

test('duplicate stable IDs across projects fail closed', async () => {
  const { home, hub, root, get } = await fixture();
  writePreview(root);
  const other = path.join(home, 'other');
  writePreview(path.join(other, '.anjian/artifacts'), 'copy');
  await hub.register(other);
  const result = await get(htmlReference + stableId);
  expect(result.status).toBe(404);
  expect(await result.text()).not.toContain('Private preview');
});

test('same-name artboard groups and boards resolve independently and only verify groups expose a verdict', async () => {
  const { root, get, post } = await fixture();
  const dir = writeArtboard(
    root,
    'review',
    {
      version: 1,
      title: 'Design review',
      pages: [{ id: 'p', name: 'Page' }],
      boards: {
        same: {
          title: 'Board title',
          file: 'pages/board.html',
          page: 'p',
          x: 0,
          y: 0,
          w: 300,
          h: 200,
        },
        evidence: { file: 'pages/evidence.html', page: 'p', x: 350, y: 0, w: 300, h: 200 },
      },
      groups: {
        same: { title: 'Group title', boards: ['evidence'], verify: true },
      },
    },
    {
      '.artifact-id': `${stableId}\n`,
      'pages/board.html':
        '<html><head><title>Board preview</title></head><body>Board</body></html>',
      'pages/evidence.html':
        '<html><head><title>Evidence</title></head><body>Evidence</body></html>',
    },
  );
  const route = artboardReference + stableId;
  const group = { href: `/artboard/${stableId}?ref=1&group=same`, title: 'Group title' };
  const board = { href: `/artboard/${stableId}?ref=1&board=same`, title: 'Board title' };
  expect(await (await get(route)).json()).toEqual({
    href: `/artboard/${stableId}?ref=1`,
    title: 'Design review',
  });
  expect(await (await get(route + '?group=same')).json()).toEqual({ ...group, review: 'pending' });
  expect(await (await get(route + '?board=same')).json()).toEqual(board);
  expect((await get(board.href)).status).toBe(200);

  const approve = await post('/api/artboard/review/comments', {
    op: 'create',
    anchor: { page: 'p', group: 'same', verdict: 'pass', x: 0, y: 0 },
    text: '通过',
  });
  expect(approve.status, await approve.clone().text()).toBe(200);
  expect(await (await get(route + '?group=same')).json()).toEqual({ ...group, review: 'pass' });
  expect(await (await get(route + '?board=same')).json()).toEqual(board);

  const canvasPath = path.join(dir, 'canvas.json');
  const canvas = JSON.parse(fs.readFileSync(canvasPath, 'utf8'));
  canvas.boards.same.title = 12;
  canvas.groups.same.title = true;
  fs.writeFileSync(canvasPath, JSON.stringify(canvas));
  expect(await (await get(route + '?board=same')).json()).toEqual({
    ...board,
    title: 'Design review',
  });
  expect(await (await get(route + '?group=same')).json()).toEqual({
    ...group,
    title: 'Design review',
    review: 'pass',
  });
  canvas.boards.same.title = 'Board title';
  delete canvas.groups.same;
  fs.writeFileSync(canvasPath, JSON.stringify(canvas));
  expect((await get(route + '?group=same')).status).toBe(404);
  expect(await (await get(route + '?board=same')).json()).toEqual(board);
  expect((await get(route + '?board=missing')).status).toBe(404);
  expect([400, 404]).toContain((await get(route + '?board=same&group=same')).status);
  expect([400, 404]).toContain((await get(artboardReference + 'review')).status);
});

test('a public snapshot token does not grant access to the private reference', async () => {
  const { root, project, request, get, post } = await fixture();
  writePreview(root);
  const published = await post('/api/hub/share', {
    project,
    type: 'html',
    id: 'preview',
    action: 'publish',
  });
  expect(published.status, await published.clone().text()).toBe(200);
  const snapshot = new URL((await published.json()).share.url);
  expect((await request(snapshot.pathname + '/data')).status).toBe(200);

  const route = htmlReference + stableId;
  const unknown = await request(htmlReference + missingId);
  expect(unknown.status).toBe(404);
  const privateReference = await request(route);
  expect(privateReference.status).toBe(404);
  const body = await unknown.text();
  expect(await privateReference.text()).toBe(body);

  const token = snapshot.pathname.split('/').at(-1)!;
  const withSnapshot = await request(route, {
    headers: { Authorization: `Bearer ${token}`, Referer: snapshot.href },
  });
  expect(withSnapshot.status).toBe(404);
  expect(await withSnapshot.text()).toBe(body);

  const revoke = await post('/api/hub/share', {
    project,
    type: 'html',
    id: 'preview',
    action: 'revoke',
  });
  expect(revoke.status).toBe(200);
  expect((await request(snapshot.pathname + '/data')).status).toBe(404);
  expect((await get(route)).status).toBe(200);
  const anonymousNavigation = await request(`/html/${stableId}?ref=1`, { redirect: 'manual' });
  expect(anonymousNavigation.status).toBe(303);
  expect(anonymousNavigation.headers.get('location')).toMatch(/^\/login\?returnTo=/);
});
