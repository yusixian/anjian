import { LoroDoc } from 'loro-crdt';
import { createLoroBinding } from '@haklex/rich-collab-loro';
import { $getRoot, $isElementNode, $isTextNode } from 'lexical';
import { createDocumentHeadlessEditor } from '../src/server/document-headless';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { startHub, type Hub } from '../src/server/hub';
import { machinePaths, registerProject } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { createCommentStore } from '../src/server/document-comments';
import { tempRoot, writeDocument } from './helpers';

const hubs: Hub[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const hub of hubs.splice(0)) await hub.close(); });
const op = { op: 'create' as const, blockId: 'b1', quote: 'hello', text: 'new comment' };

test('comment admission and write failures leave memory and the saved file unchanged', () => {
  const { root } = tempRoot(); const file = path.join(root, 'comments.json');
  const store = createCommentStore(file);
  const original = store.apply(op); const saved = fs.readFileSync(file, 'utf8');
  expect(() => store.apply({ ...op, text: 'denied' }, () => { throw new Error('quota'); })).toThrow('quota');
  expect(store.current()).toEqual(original);
  expect(fs.readFileSync(file, 'utf8')).toBe(saved);
  const fail = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk full'); });
  expect(() => store.applyAgent({ op: 'add', blockId: 'b1', quote: 'hello', text: 'failed' })).toThrow('disk full');
  fail.mockRestore();
  expect(store.current()).toEqual(original);
  expect(fs.readFileSync(file, 'utf8')).toBe(saved);
  expect(store.apply({ ...op, text: 'retry' }).threads).toHaveLength(2);
});

test('Hub enforces document comment quota before saving or broadcasting, without deadlocking synchronization', async () => {
  const temp = tempRoot(); const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project'); const artifacts = path.join(project, '.anjian/artifacts');
  writeDocument(artifacts, 'doc', { 'doc.xml': '<doc><p id="b1">hello</p></doc>' });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') }); registerProject(paths.projects, project);
  const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1', ports: [0], boardPorts: [0], token: 'a'.repeat(48), version: 'test', viewerDir: temp.viewer, runtimeDir: temp.runtime }); hubs.push(hub);
  const mount = await hub.mountOf(project);
  const settings = createStorageSettings(paths.home); settings.setSharedLimit(0);
  const messages: unknown[] = [];
  mount.onMessage((message) => { if (message.type === 'doc-comments') messages.push(message); });
  const origin = `http://127.0.0.1:${hub.port}`;
  const post = (url: string, body: object, agent = false) => fetch(origin + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(!agent ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  const route = '/api/document/doc/comments';
  const [denied, synced] = await Promise.all([post(route, op), post('/api/storage?scope=personal', { action: 'sync' })]);
  expect(denied.status, await denied.clone().text()).toBe(413);
  expect(synced.status).toBe(200);
  const file = path.join(artifacts, 'document/doc/comments.json');
  expect(fs.existsSync(file)).toBe(false);
  expect(messages).toHaveLength(0);
  const agent = await post('/api/agent/document/doc/comments', { op: 'add', blockId: 'b1', text: 'agent comment' }, true);
  expect(agent.status, await agent.clone().text()).toBe(413);
  expect(messages).toHaveLength(0);
  settings.setSharedLimit(1024 * 1024);
  const saved = await post(route, { ...op, text: 'x'.repeat(2000) });
  expect(saved.status).toBe(200);
  const { comments } = await saved.json();
  expect(comments.threads).toHaveLength(1);
  settings.setSharedLimit(0);
  const edited = await post(route, { op: 'edit', threadId: comments.threads[0].id, messageId: comments.threads[0].messages[0].id, text: 'shorter' });
  expect(edited.status, await edited.clone().text()).toBe(200);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).threads[0].messages[0].text).toBe('shorter');
});


test('Hub rejects document content before live import and accepts the same update after quota is raised', async () => {
  const temp = tempRoot(); const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project'); const artifacts = path.join(project, '.anjian/artifacts');
  writeDocument(artifacts, 'doc', { 'doc.xml': '<doc><p id="b1">hello</p></doc>' });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') }); registerProject(paths.projects, project);
  const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1', ports: [0], boardPorts: [0], token: 'a'.repeat(48), version: 'test', viewerDir: temp.viewer, runtimeDir: temp.runtime }); hubs.push(hub);
  const mount = await hub.mountOf(project);
  const origin = `http://127.0.0.1:${hub.port}`;
  const state = await (await fetch(origin + '/api/document/doc/state')).json();
  const peer = new LoroDoc(); peer.import(Buffer.from(state.snapshot, 'base64'));
  const editor = createDocumentHeadlessEditor(); const binding = createLoroBinding(editor, peer);
  const from = peer.oplogVersion();
  editor.update(() => {
    const paragraph = $getRoot().getFirstChild();
    if (!$isElementNode(paragraph)) throw new Error('Expected paragraph');
    const text = paragraph.getFirstChild();
    if (!$isTextNode(text)) throw new Error('Expected text');
    text.setTextContent('hello quota guarded document');
  }, { discrete: true });
  const update = peer.export({ mode: 'update', from }); binding.dispose();
  const settings = createStorageSettings(paths.home); settings.setSharedLimit(0);
  const messages: unknown[] = []; mount.onMessage(message => { if (message.type === 'doc-update') messages.push(message); });
  const post = () => fetch(origin + '/api/document/doc/update', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(update) });
  const denied = await post(); expect(denied.status, await denied.clone().text()).toBe(413);
  expect(messages).toEqual([]);
  const file = path.join(artifacts, 'document/doc/doc.xml');
  expect(fs.readFileSync(file, 'utf8')).not.toContain('quota guarded');
  settings.setSharedLimit(1024 * 1024);
  const saved = await post(); expect(saved.status, await saved.clone().text()).toBe(204);
  expect(messages).toHaveLength(1);
  expect(fs.readFileSync(file, 'utf8')).toContain('hello quota guarded document');
});
