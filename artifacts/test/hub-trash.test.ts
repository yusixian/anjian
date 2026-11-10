import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import type { HubArtifact } from '../src/shared/hub';
import { type Hub, startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { tempRoot, writeDocument, writeHtml } from './helpers';

const hubs: Hub[] = [];
afterEach(async () => { for (const hub of hubs.splice(0)) await hub.close(); });

async function fixture() {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-trash-api-')));
  const root = path.join(project, '.anjian/artifacts');
  writeDocument(root, 'plan', { 'doc.xml': '<doc><p>Keep this document</p></doc>' });
  writeHtml(root, 'preview', { 'index.html': '<h1>Keep this HTML</h1>' });
  const temp = tempRoot();
  const token = 't'.repeat(48);
  const paths = machinePaths({ ANJIAN_SERVER_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-trash-hub-')) });
  const hub = await startHub({
    host: '0.0.0.0', urlHost: 'localhost', viewerDir: temp.viewer, runtimeDir: temp.runtime,
    ports: [0], boardPorts: [0], version: '0.1.0', token,
    paths,
  });
  hubs.push(hub);
  await hub.register(project);
  const base = `http://localhost:${hub.port}`;
  const request = (route: string, init?: RequestInit) => fetch(`${base}${route}${route.includes('?') ? '&' : '?'}key=${token}`, init);
  const post = (route: string, items: unknown[], origin = base) => request(route, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
  });
  const list = async (): Promise<HubArtifact[]> => (await (await request('/api/hub/artifacts')).json()).artifacts;
  return { hub, project, root, base, token, request, post, list, settings: createStorageSettings(paths.home) };
}

test.each(['/api/hub/trash', '/api/hub/trash/restore', '/api/hub/trash/purge'])(
  '%s preserves live documents and trash entries when quota blocks saving', async (route) => {
    const f = await fixture();
    try {
      const items = await f.list();
      const html = items.find(item => item.type === 'html')!;
      const trashed = (await (await f.post('/api/hub/trash', [html])).json()).results[0].entry;
      // The earlier trash operation may have saved all existing documents.
      // Create a fresh one so this operation must allocate its first snapshot.
      f.settings.setSharedLimit(0);
      writeDocument(f.root, 'quota-draft', { 'doc.xml': '<doc><p>Save before trash</p></doc>' });
      const doc = (await f.list()).find(item => item.id === 'quota-draft')!;
      const stateRoute = '/api/document/quota-draft/state';
      const state = await f.request(stateRoute);
      expect(state.status, await state.clone().text()).toBe(200);
      const mounts = f.hub.mounted();
      const original = fs.readFileSync(path.join(f.root, 'document/quota-draft/doc.xml'), 'utf8');
      const input = route === '/api/hub/trash' ? doc : { project: trashed.project, trashId: trashed.trashId };
      const denied = (await (await f.post(route, [input])).json()).results[0];
      expect(denied).toMatchObject({ ok: false, code: 'document_save_blocked' });
      expect(denied.error).toContain('存储设置');
      expect(f.hub.mounted()).toEqual(mounts);
      expect((await f.request(stateRoute)).status).toBe(200);
      expect(fs.readFileSync(path.join(f.root, 'document/quota-draft/doc.xml'), 'utf8')).toBe(original);
      expect(fs.existsSync(path.join(f.root, '.state/document/quota-draft/doc.loro'))).toBe(false);
      const trash = await (await f.request('/api/hub/trash')).json();
      expect(trash.entries.map((entry: { trashId: string }) => entry.trashId)).toEqual([trashed.trashId]);
      f.settings.setSharedLimit(1024 * 1024);
      expect((await (await f.post(route, [input])).json()).results[0].ok).toBe(true);
    } finally { f.settings.setSharedLimit(1024 * 1024); }
  },
);

test('bulk trash preserves a live document and restores its original opaque URL', async () => {
  const f = await fixture();
  const before = await f.list();
  const doc = before.find((a) => a.type === 'document')!;
  const response = await f.post('/api/hub/trash', before);
  expect(response.status).toBe(200);
  const { results } = await response.json();
  expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true]);
  expect(await f.list()).toEqual([]);
  expect((await f.request(doc.url)).status).toBe(410);
  const trash = await (await f.request('/api/hub/trash')).json();
  expect(trash.entries).toHaveLength(2);
  expect(trash.deployment).toBe('self-hosted');
  const refs = trash.entries.map((entry: { project: string; trashId: string }) => ({ project: entry.project, trashId: entry.trashId }));
  expect((await (await f.post('/api/hub/trash/restore', refs)).json()).results.every((r: { ok: boolean }) => r.ok)).toBe(true);
  const restored = await f.list();
  expect(restored.map((a) => a.url).sort()).toEqual(before.map((a) => a.url).sort());
  expect(fs.readFileSync(path.join(f.root, 'document/plan/doc.xml'), 'utf8')).toContain('Keep this document');
  expect((await f.request(doc.url)).status).toBe(200);
  expect(fs.existsSync(path.join(f.root, '.state/document/plan/doc.loro'))).toBe(true);
});

test('trash rejects unauthenticated, foreign-origin and unregistered-project mutations', async () => {
  const f = await fixture();
  const [item] = await f.list();
  expect((await fetch(f.base + '/api/hub/trash')).status).toBe(403);
  expect((await f.post('/api/hub/trash', [item], 'https://attacker.invalid')).status).toBe(403);
  expect((await f.post('/api/hub/trash', [{ ...item, id: '../outside' }])).status).toBe(400);
  const results = (await (await f.post('/api/hub/trash', [{ ...item, project: '/not-registered' }, item])).json()).results;
  expect(results[0]).toMatchObject({ ok: false, code: 'project_not_found' });
  expect(results[1].ok).toBe(true);
  expect(await f.list()).toHaveLength(1);
});

test('concurrent duplicate deletion is idempotent and restoration does not overwrite a new file', async () => {
  const f = await fixture();
  const item = (await f.list()).find((a) => a.type === 'html')!;
  const responses = await Promise.all([f.post('/api/hub/trash', [item]), f.post('/api/hub/trash', [item])]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  expect(bodies.every((body) => body.results[0].ok)).toBe(true);
  expect(bodies[0].results[0].entry.trashId).toBe(bodies[1].results[0].entry.trashId);
  writeHtml(f.root, 'preview', { 'index.html': '<h1>A different file</h1>' });
  const entry = bodies[0].results[0].entry;
  const result = (await (await f.post('/api/hub/trash/restore', [{ project: f.project, trashId: entry.trashId }])).json()).results[0];
  expect(result).toMatchObject({ ok: false, code: 'restore_conflict' });
  expect(fs.readFileSync(path.join(f.root, 'html/preview/index.html'), 'utf8')).toContain('different file');
});

test('scoped CLI pushes cannot resurrect a deleted artifact, even after purge', async () => {
  const f = await fixture();
  const id = crypto.createHash('sha256').update(f.project).digest('hex').slice(0, 32);
  const pair = await (await fetch(f.base + '/api/remote/auth/device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'trash test' }) })).json();
  await f.request('/api/remote/auth/approve', { method: 'POST', headers: { Origin: f.base, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pair.userCode, projects: [id] }) });
  const credentials = await (await fetch(f.base + '/api/remote/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceCode: pair.deviceCode }) })).json();
  const item = (await f.list()).find((a) => a.type === 'html')!;
  const entry = (await (await f.post('/api/hub/trash', [item])).json()).results[0].entry;
  const push = () => fetch(`${f.base}/api/remote/projects/${id}/artifacts/html/preview`, { method: 'PUT', headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision: null, files: { 'index.html': Buffer.from('<h1>Unexpected resurrection</h1>').toString('base64') } }) });
  expect((await push()).status).toBe(409);
  expect((await (await f.post('/api/hub/trash/purge', [{ project: f.project, trashId: entry.trashId }])).json()).results[0].ok).toBe(true);
  expect((await push()).status).toBe(409);
  expect(fs.existsSync(path.join(f.root, 'html/preview'))).toBe(false);
});

test('a deleted slug in one project does not shadow another project’s live artifact', async () => {
  const f = await fixture();
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-trash-other-')));
  writeDocument(path.join(other, '.anjian/artifacts'), 'plan', { 'doc.xml': '<doc><p>Other project</p></doc>' });
  await f.hub.register(other);
  const item = (await f.list()).find((a) => a.project === f.project && a.type === 'document')!;
  expect((await (await f.post('/api/hub/trash', [item])).json()).results[0].ok).toBe(true);
  expect((await f.request('/document/plan')).status).toBe(200);
  expect((await f.request('/document/plan', { headers: { 'x-anjian-project': encodeURIComponent(other) } })).status).toBe(200);
  expect((await f.request('/document/plan', { headers: { 'x-anjian-project': encodeURIComponent(f.project) } })).status).toBe(410);
  expect((await f.request(item.url)).status).toBe(410);
});
