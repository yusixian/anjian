import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { startHub, type Hub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
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
  return { h, home, project, root, req, owner, action };
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
  writeArtboard(root, 'board', { version: 1, title: 'Board', pages: [{ id: 'p', name: 'Page' }], boards: { a: { page: 'p', file: 'pages/p/a.html', x: 0, y: 0, w: 300, h: 200 } } }, { 'pages/p/a.html': '<html><head></head><body>Board</body></html>' });
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
    const foreign = await fetch(`http://127.0.0.1:${h.boardPort}${new URL(data.contentBase).pathname}index.html`, { headers: { Host: 'evil.example' } });
    expect(foreign.status).toBe(403);
  }
});
