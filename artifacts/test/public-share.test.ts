import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

import { startHub, type Hub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { createStorageUsage } from '../src/server/storage/usage';
import { readRemoteArtifact } from '../src/server/remote-transfer';
import { tempRoot, writeArtboard } from './helpers';

const hubs: Hub[] = [];
const dirs: string[] = [];
afterEach(async () => { for (const h of hubs.splice(0)) await h.close(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const temp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-share-'))); dirs.push(d); return d; };
async function setup() {
  const home = temp(); const project = temp(); const fixture = tempRoot();
  fs.writeFileSync(path.join(fixture.viewer, 'share.html'), '<!doctype html><script src="/share.js"></script>公开分享');
  fs.writeFileSync(path.join(fixture.viewer, 'share.js'), 'console.log("public viewer")');
  const h = await startHub({ paths: machinePaths({ ANJIAN_SERVER_HOME: home }), host: '127.0.0.1', urlHost: '127.0.0.1', ports: [0], boardPorts: [0],
    publicOrigin: 'https://share.example', boardOrigin: 'https://preview.example', viewerDir: fixture.viewer, runtimeDir: fixture.runtime, token: 'test-secret-key', version: 'test' });
  hubs.push(h);
  const root = path.join(project, '.anjian/artifacts');
  fs.mkdirSync(path.join(root, 'html/demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'html/demo/index.html'), '<!doctype html><html><head></head><body>Original</body></html>');
  fs.writeFileSync(path.join(root, 'html/demo/asset.txt'), 'RESOURCE');
  fs.writeFileSync(path.join(root, 'html/demo/comments.json'), 'PRIVATE COMMENTS');
  fs.writeFileSync(path.join(root, 'html/demo/.secret'), 'SECRET');
  await h.register(project);
  const req = (p: string, init: RequestInit = {}, preview = false): Promise<Response> => new Promise((resolve, reject) => {
    const request = http.request(`http://127.0.0.1:${preview ? h.boardPort : h.port}${p}`, {
      method: init.method ?? 'GET', headers: { Host: preview ? 'preview.example' : 'share.example', ...init.headers as Record<string, string> },
    }, (response) => {
      const chunks: Buffer[] = []; response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers as Record<string, string> })));
    });
    request.on('error', reject); request.end(init.body);
  });
  const owner = { Cookie: `anjian_artifacts_${h.port}=test-secret-key`, Origin: 'https://share.example', 'Content-Type': 'application/json' };
  const action = (action: string, extra: object = {}) => req('/api/hub/share', { method: 'POST', headers: owner, body: JSON.stringify({ project, type: 'html', id: 'demo', action, expiresInDays: 7, ...extra }) });
  return { h, home, project, root, req, owner, action, viewer: fixture.viewer };
}

test('anonymous snapshot survives edits, rotates/revokes and exposes only scoped files', async () => {
  const { root, req, owner, action } = await setup();
  expect((await req('/api/hub/share?type=html&id=demo')).status).toBe(403);
  expect((await req('/api/hub/share', { method: 'POST', headers: { ...owner, Origin: 'https://evil.example' }, body: '{}' })).status).toBe(403);
  const created = await action('publish'); expect(created.status).toBe(200);
  const first = await created.json(); const link = new URL(first.share.url).pathname;
  const shell = await req(link); expect(shell.status).toBe(200); expect(await shell.text()).toContain(`${link}/app/share.js`);
  expect(shell.headers.get('content-security-policy')).toContain(`base-uri https://preview.example${link}/r/`);
  expect((await req(`${link}/app/share.js`)).status).toBe(200);
  const data = await (await req(`${link}/data`)).json();
  expect(Object.keys(data).sort()).toEqual(['contentBase', 'expiresAt', 'publishedAt', 'title', 'type'].sort());
  const content = new URL(data.contentBase).pathname;
  const resource = await req(`${content}index.html`, {}, true);
  expect(resource.status).toBe(200); expect(resource.headers.get('cache-control')).toBe('no-store');
  expect(resource.headers.get('content-security-policy')).toContain("connect-src 'none'");
  expect(resource.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
  fs.writeFileSync(path.join(root, 'html/demo/index.html'), '<html>Draft only</html>');
  expect(await (await req(`${content}index.html`, {}, true)).text()).toContain('Original');
  for (const file of ['comments.json', '.secret', '%2e%2e%2findex.json']) expect((await req(content + file, {}, true)).status).toBe(404);
  expect((await req(content + 'index.html')).status).toBe(404);
  expect((await req(`${link}/data`, { method: 'POST' })).status).toBe(405);
  expect((await req('/api/hub/artifacts')).status).toBe(403);
  const range = await req(content + 'asset.txt', { headers: { Range: 'bytes=0-2' } }, true);
  expect(range.status).toBe(206); expect(await range.text()).toBe('RES');
  const updated = await (await action('publish', { expiresInDays: undefined })).json();
  expect(updated.share.url).toBe(first.share.url); expect(updated.share.expiresAt).toBe(first.share.expiresAt);
  expect((await req(content + 'index.html', {}, true)).status).toBe(404);
  const rotated = await (await action('rotate')).json(); expect(rotated.share.url).not.toBe(first.share.url);
  expect((await req(`${link}/data`)).status).toBe(404);
  const next = new URL(rotated.share.url).pathname;
  expect((await req(next)).status).toBe(200);
  await action('revoke'); expect((await req(next)).status).toBe(404);
});

test('trash/restore and project unregister do not revive public access', async () => {
  const { h, project, req, owner, action } = await setup();
  const first = await (await action('publish')).json(); const link = new URL(first.share.url).pathname;
  const list = await (await req('/api/hub/artifacts', { headers: owner })).json();
  const item = list.artifacts.find((a: { id: string }) => a.id === 'demo');
  const trash = await (await req('/api/hub/trash', { method: 'POST', headers: owner, body: JSON.stringify({ items: [item] }) })).json();
  expect(trash.results[0].ok).toBe(true); expect((await req(link)).status).toBe(404);
  const restored = await req('/api/hub/trash/restore', { method: 'POST', headers: owner, body: JSON.stringify({ items: [{ project, trashId: trash.results[0].entry.trashId }] }) });
  expect((await restored.json()).results[0].ok).toBe(true); expect((await req(link)).status).toBe(404);
  const second = await (await action('publish')).json(); const next = new URL(second.share.url).pathname;
  await h.remove(project); await h.register(project); expect((await req(next)).status).toBe(404);
});

test('artboard/document data projection omits private state and rejects unknown preview host', async () => {
  const { h, project, root, req, owner } = await setup();
  writeArtboard(root, 'board', { version: 1, title: 'Board', pages: [{ id: 'p', name: 'Page' }], boards: { a: { page: 'p', file: 'pages/p/a.html', x: 0, y: 0, w: 300, h: 200, interactive: true, trim: true } } }, { 'pages/p/a.html': '<html><head></head><body>Board</body></html>' });
  fs.mkdirSync(path.join(root, 'document/doc'), { recursive: true });
  fs.writeFileSync(path.join(root, 'document/doc/doc.xml'), '<doc><h1>Hello</h1><p>Public body</p></doc>');
  for (const [type, id] of [['artboard', 'board'], ['document', 'doc']]) {
    const response = await req('/api/hub/share', { method: 'POST', headers: owner, body: JSON.stringify({ project, type, id, action: 'publish', expiresInDays: null }) });
    expect(response.status).toBe(200);
    const link = new URL((await response.json()).share.url).pathname;
    const data = await (await req(link + '/data')).json();
    expect(data.type).toBe(type); expect(data.comments).toBeUndefined(); expect(data.project).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(project); expect(data.expiresAt).toBeNull();
    expect((await req(new URL(data.contentBase).pathname + (type === 'document' ? 'doc.xml' : 'canvas.json'), {}, true)).status).toBe(404);
    if (type === 'artboard') {
      expect(data.canvas.boards.a).toMatchObject({ interactive: true, trim: true });
      const board = await req(new URL(data.contentBase).pathname + 'pages/p/a.html', {}, true);
      const html = await board.text();
      expect(board.status).toBe(200);
      expect(board.headers.get('content-security-policy')).toContain(`connect-src ${data.contentBase}`);
      expect(board.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
      expect(html).toContain('anjian:inspect');
      expect(html).toContain('anjian:board:capture');
      expect(html).not.toContain('anjian:tweaks');
      expect(html).not.toContain(project);
    }
    const foreign = await fetch(`http://127.0.0.1:${h.boardPort}${new URL(data.contentBase).pathname}index.html`, { headers: { Host: 'evil.example' } });
    expect(foreign.status).toBe(403);
  }
});

test('private capability paths preserve relative resources without reopening legacy content access', async () => {
  const { req, owner, root, h, project } = await setup();
  const response = await req('/api/artifacts/html/demo', { headers: owner });
  expect(response.status).toBe(200);
  const metadata = await response.json();
  expect(metadata.contentBase).toMatch(/^\/p\/[A-Za-z0-9_-]{43}\/$/);
  expect(metadata.contentExpiresAt).toBeGreaterThan(Date.now());
  const base = metadata.contentBase;
  const page = await req(base + 'index.html');
  expect(page.status).toBe(200);
  expect(page.headers.get('cache-control')).toBe('no-store');
  expect(page.headers.get('referrer-policy')).toBe('no-referrer');
  expect(await page.text()).toContain('Original');
  const asset = await req(base + 'asset.txt', { headers: { Range: 'bytes=0-2' } });
  expect(asset.status).toBe(206); expect(await asset.text()).toBe('RES');
  expect((await req(base + 'index.html', { method: 'POST' })).status).toBe(405);
  expect((await req(base + '%2e%2e%2fother/index.html')).status).toBe(404);
  expect((await req('/p/' + 'a'.repeat(43) + '/index.html')).status).toBe(404);
  const preview = await (await req('/api/preview/html/demo', { headers: owner })).json();
  expect(preview.contentBase).toBe(base);
  expect((await req(base + 'index.html', {}, true)).status).toBe(404);

  writeArtboard(root, 'private-board', { version: 1, title: 'Private', pages: [{ id: 'p', name: 'Page' }], boards: { a: { page: 'p', file: 'pages/p/a.html', x: 0, y: 0, w: 300, h: 200 } } }, { 'pages/p/a.html': '<html><body>Private board</body></html>' });
  const board = await (await req('/api/artifacts/artboard/private-board', { headers: owner })).json();
  expect(board.boardPath).toBe(board.contentBase);
  expect((await req('/c/artboard/private-board/pages/p/a.html', {}, true)).status).toBe(404);
  const content = await req(board.boardPath + 'pages/p/a.html', {}, true);
  expect(content.status).toBe(200); expect(await content.text()).toContain('Private board');
  await h.remove(project);
  expect((await req(base + 'index.html')).status).toBe(404);
});


test('instance quota rejects first publication and replacement without changing public content', async () => {
  const { home, root, req, action } = await setup();
  const settings = createStorageSettings(home);
  settings.setSharedLimit(0);
  const denied = await action('publish');
  expect(denied.status).toBe(413);
  expect((await denied.json()).code).toBe('storage_quota_exceeded');
  const snapshots = path.join(home, 'shares/snapshots');
  expect(fs.existsSync(snapshots) ? fs.readdirSync(snapshots) : []).toEqual([]);
  settings.setSharedLimit(100 * 1024 * 1024);
  const published = await action('publish'); expect(published.status).toBe(200);
  const first = await published.json();
  const link = new URL(first.share.url).pathname;
  const data = await (await req(`${link}/data`)).json();
  const content = new URL(data.contentBase).pathname;
  fs.writeFileSync(path.join(root, 'html/demo/index.html'), '<html>replacement</html>');
  settings.setSharedLimit(0);
  const replacement = await action('publish'); expect(replacement.status).toBe(413);
  expect((await replacement.json()).code).toBe('storage_quota_exceeded');
  expect(await (await req(`${content}index.html`, {}, true)).text()).toContain('Original');
  expect((await req(`${link}/data`)).status).toBe(200);
  expect((await action('revoke')).status).toBe(200);
  expect((await req(`${link}/data`)).status).toBe(404);
});


test('concurrent publications in different projects cannot both consume the remaining shared capacity', async () => {
  const f = await setup();
  const other = temp();
  const source = path.join(other, '.anjian/artifacts/html/other');
  fs.mkdirSync(source, { recursive: true }); fs.writeFileSync(path.join(source, 'index.html'), '<h1>Other</h1>');
  await f.h.register(other);
  await f.h.linkFor(f.project, 'html', 'demo');
  await f.h.linkFor(other, 'html', 'other');
  await vi.waitFor(() => {
    expect(fs.existsSync(path.join(f.root, '.state/html/demo/warnings.json'))).toBe(true);
    expect(fs.existsSync(path.join(other, '.anjian/artifacts/.state/html/other/warnings.json'))).toBe(true);
  });
  const usage = createStorageUsage({ projects: () => [f.project, other].map((dir) => ({ dir, owner: 'owner' })),
    snapshotsRoot: path.join(f.home, 'shares/snapshots'), snapshots: () => [] });
  const bytes = (project: string, id: string) => Object.values(readRemoteArtifact(project, `html/${id}`).files)
    .reduce((sum, encoded) => sum + Buffer.from(encoded, 'base64').length, 0);
  createStorageSettings(f.home).setSharedLimit((await usage.measure('owner')).shared + Math.max(bytes(f.project, 'demo'), bytes(other, 'other')));
  const results = await Promise.all([f.action('publish'), f.req('/api/hub/share', {
    method: 'POST', headers: f.owner, body: JSON.stringify({ project: other, type: 'html', id: 'other', action: 'publish', expiresInDays: 7 }),
  })]);
  expect(results.map((response) => response.status).sort()).toEqual([200, 413]);
  expect(fs.readdirSync(path.join(f.home, 'shares/snapshots'))).toHaveLength(1);
});

test('creates, edits and reviews a slide deck and publishes an isolated reading snapshot', async () => {
  const { action, owner, project, req, root } = await setup();
  const write = (url: string, body: unknown, headers = owner) =>
    req(url, { body: JSON.stringify(body), headers, method: 'POST' });
  const create = { project, title: 'Release briefing' };
  expect((await write('/api/hub/slides', create, { ...owner, Origin: 'https://other.example' })).status).toBe(403);
  const created = await write('/api/hub/slides', create);
  expect(created.status).toBe(201);
  const { id, url } = await created.json() as { id: string; url: string };
  expect(url).toMatch(/^\/slides\//);
  const address = url.split('/').at(-1);
  const endpoint = `/api/slides/${address}`;
  expect((await req(endpoint)).status).toBe(403);
  expect((await req(url, { headers: owner })).status).toBe(200);
  const initial = await (await req(endpoint, { headers: owner })).json();
  expect(initial.deck.title).toBe(create.title);
  const first = { id: 'opening', title: 'Opening', body: 'Public opener', notes: 'Private notes A' };
  const second = { id: 'plan', title: 'Plan', body: 'Public plan', notes: 'Private notes B' };
  const deck = { ...initial.deck, slides: [first, second] };
  const saved = await write(endpoint, { deck, revision: initial.revision });
  expect(saved.status).toBe(200);
  const current = await saved.json();
  const review = await write(`${endpoint}/comments`, { op: 'create', slideId: 'plan', text: 'Private review' });
  expect(review.status).toBe(200);
  const reordered = await write(endpoint, { deck: { ...deck, slides: [second, first] }, revision: current.revision });
  expect(reordered.status).toBe(200);
  const latest = await reordered.json();
  expect(latest.comments.threads[0]).toMatchObject({ anchor: { slideId: 'plan' } });
  expect((await write(endpoint, { deck, revision: current.revision })).status).toBe(409);

  const publish = await action('publish', { id, type: 'slides' });
  expect(publish.status).toBe(200);
  const share = new URL((await publish.json()).share.url).pathname;
  const data = await (await req(`${share}/data`)).json();
  expect(data.deck.slides).toEqual([
    { id: 'plan', title: 'Plan', body: 'Public plan' },
    { id: 'opening', title: 'Opening', body: 'Public opener' },
  ]);
  expect(JSON.stringify(data)).not.toContain('Private');
  expect((await req(`${new URL(data.contentBase).pathname}deck.json`, {}, true)).status).toBe(404);

  const preview = await (await req(`/api/preview/slides/${id}`, { headers: owner })).json();
  expect(preview.deck).toEqual(data.deck);
  const draft = { ...latest.deck, slides: [{ ...second, body: 'Unpublished edit' }, first] };
  expect((await write(endpoint, { deck: draft, revision: latest.revision })).status).toBe(200);
  expect((await (await req(`${share}/data`)).json()).deck).toEqual(data.deck);
  const dir = path.join(root, 'slides', id);
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'deck.json'), 'utf8'));
  expect(disk).toEqual(draft);

  const comments = path.join(dir, 'comments.json');
  fs.renameSync(comments, path.join(dir, 'comments.backup'));
  fs.mkdirSync(comments);
  const recoverable = await (await req(endpoint, { headers: owner })).json();
  expect(recoverable).toMatchObject({ deck: draft, commentsWarning: 'Unsafe comments.json path' });
  const successful = await write(endpoint, { deck, revision: recoverable.revision });
  expect(successful.status).toBe(200);
  expect(await successful.json()).toMatchObject({ deck, commentsWarning: 'Unsafe comments.json path' });
});

test('storyboard renders one private revision for both playback and export', async () => {
  const { owner, project, req, viewer } = await setup();
  fs.writeFileSync(path.join(viewer, 'preview.html'), '<!doctype html><title>generic preview</title>');
  const write = (url: string, payload: unknown) => req(url, {
    body: JSON.stringify(payload),
    headers: owner,
    method: 'POST',
  });
  const created = await write('/api/hub/storyboards', { project, title: 'Demo storyboard', language: 'en' });
  expect(created.status, await created.clone().text()).toBe(201);
  const { id, url } = await created.json() as { id: string; url: string };
  const endpoint = `/api${url}`;
  expect((await req(url, { headers: owner })).status).toBe(200);
  const preview = await req(`/preview${url}`, { headers: owner });
  expect(preview.status).toBe(200);
  expect(await preview.text()).not.toContain('generic preview');
  expect((await req(endpoint)).status).toBe(403);
  const initial = await (await req(endpoint, { headers: owner })).json();
  expect(initial.storyboard.tracks[0]).toMatchObject({ name: 'Video', kind: 'video' });
  const image = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=16x16', '-frames:v', '1',
    '-threads:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1']);
  const uploaded = await req(`${endpoint}/assets?name=opening.png`, {
    body: new Uint8Array(image),
    headers: { ...owner, 'Content-Type': 'image/png' },
    method: 'POST',
  });
  expect(uploaded.status, await uploaded.clone().text()).toBe(201);
  const { asset } = await uploaded.json();
  const assetUrl = `${endpoint}/assets?name=${encodeURIComponent(asset.path)}`;
  expect((await req(assetUrl)).status).toBe(403);
  const partialAsset = await req(assetUrl, { headers: { ...owner, Range: 'bytes=0-7' } });
  expect(partialAsset.status).toBe(206);
  expect(Buffer.from(await partialAsset.arrayBuffer())).toEqual(image.subarray(0, 8));

  const timeline = initial.storyboard;
  timeline.tracks[0].clips = [{ id: 'first', asset: asset.path, durationMs: 400, startMs: 0, trimMs: 0 }];
  const saved = await write(endpoint, { storyboard: timeline, revision: initial.revision });
  expect(saved.status, await saved.clone().text()).toBe(200);
  const { revision } = await saved.json();
  const comment = await write(`${endpoint}/comments`, { op: 'create', clipId: 'first', text: 'Review the timing' });
  expect(comment.status).toBe(200);
  timeline.tracks[0].clips[0].startMs = 100;
  const moved = await write(endpoint, { storyboard: timeline, revision });
  expect(moved.status).toBe(200);
  const current = await moved.json();
  expect(current.comments.threads[0].anchor).toEqual({ clipId: 'first' });
  expect((await write(`${endpoint}/render`, { revision })).status).toBe(409);

  const render = await write(`${endpoint}/render`, { revision: current.revision });
  expect(render.ok, await render.clone().text()).toBe(true);
  let job = await render.json();
  const jobUrl = `${endpoint}/render/${job.id}`;
  for (let i = 0; i < 60 && ['queued', 'running'].includes(job.status); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    job = await (await req(jobUrl, { headers: owner })).json();
  }
  expect(job).toMatchObject({ status: 'ready' });
  const video = `${jobUrl}/video`;
  expect((await req(video)).status).toBe(403);
  const playback = await req(video, { headers: { ...owner, Range: 'bytes=0-31' } });
  const download = await req(`${video}?download=1`, { headers: owner });
  expect(playback.status).toBe(206);
  expect(download.headers.get('content-disposition')).toContain('attachment');
  const mp4 = Buffer.from(await download.arrayBuffer());
  expect(mp4.toString('ascii', 4, 8)).toBe('ftyp');
  expect(Buffer.from(await playback.arrayBuffer())).toEqual(mp4.subarray(0, 32));
  const repeated = await write(`${endpoint}/render`, { revision: current.revision });
  expect(await repeated.json()).toMatchObject({ id: job.id, status: 'ready' });
  const share = await write('/api/hub/share', { action: 'publish', project, type: 'storyboard', id });
  expect(share.status).toBe(404);
});
