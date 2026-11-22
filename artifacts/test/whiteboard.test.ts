import fs from 'node:fs';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { type ArtifactsServer, startArtifactsServer } from '../src/server/app';
import { artifactPath } from '../src/server/artifact-address';
import { readWhiteboardScene, writeWhiteboardScene } from '../src/server/whiteboard';
import {
  emptyWhiteboardScene,
  parseWhiteboardScene,
  WHITEBOARD_SCENE_FILE,
  type WhiteboardScene,
  type WhiteboardSnapshot,
} from '../src/shared/whiteboard';
import { tempRoot } from './helpers';

const active: ArtifactsServer[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((server) => server.close()));
});

const scene = (...ids: string[]): WhiteboardScene => ({
  ...emptyWhiteboardScene(),
  appState: { name: 'Review sketches' },
  elements: ids.map((id) => ({ id, type: 'rectangle', x: 20, y: 40, width: 100, height: 80 })),
});

async function setup() {
  const { root, viewer, runtime } = tempRoot();
  const dir = path.join(root, 'whiteboard', 'sketches');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, WHITEBOARD_SCENE_FILE);
  const server = await startArtifactsServer({
    root,
    viewerDir: viewer,
    runtimeDir: runtime,
    host: '0.0.0.0',
    urlHost: 'localhost',
  });
  active.push(server);
  const origin = `http://127.0.0.1:${server.port}`;
  const endpoint = `/api${artifactPath(root, 'whiteboard', 'sketches')}`;
  const authorized = { Cookie: `anjian_artifacts_${server.port}=${server.token}` };
  const view = (headers: Record<string, string> = {}) =>
    fetch(origin + endpoint, { headers: { ...authorized, ...headers } });
  const post = (route: string, value: unknown, source = origin) =>
    fetch(origin + route, {
      method: 'POST',
      headers: { ...authorized, 'Content-Type': 'application/json', 'Origin': source },
      body: JSON.stringify(value),
    });
  const save = (value: WhiteboardScene, revision: string) =>
    post(endpoint, { scene: value, revision });
  const browser = (body: unknown) => post(`${endpoint}/comments`, body);
  const agent = (body: unknown) =>
    fetch(`${origin}/api/agent/whiteboard/sketches/comments?key=${server.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { agent, browser, dir, endpoint, file, origin, post, save, view };
}

test('saves a native scene, detects outside changes, and fences concurrent browser saves', async () => {
  const f = await setup();
  const start = await f.view();
  expect(start.status).toBe(200);
  const initial = (await start.json()) as WhiteboardSnapshot;
  expect(initial).toMatchObject({ revision: 'empty', scene: { elements: [] } });
  expect(fs.existsSync(f.file)).toBe(false);
  expect(
    (
      await f.save(
        { ...scene('invalid'), elements: [{ id: 'stroke', type: 'freedraw' }] },
        initial.revision,
      )
    ).status,
  ).toBe(400);
  expect(fs.existsSync(f.file)).toBe(false);

  const saved = await f.save(scene('a'), initial.revision);
  expect(saved.status).toBe(200);
  const current = (await saved.json()) as WhiteboardSnapshot;
  expect(current.title).toBe('Review sketches');
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8'))).toEqual(scene('a'));
  expect((await f.view({ 'If-None-Match': saved.headers.get('etag')! })).status).toBe(304);

  fs.writeFileSync(f.file, JSON.stringify(scene('agent')));
  expect((await f.save(scene('lost'), current.revision)).status).toBe(409);
  const outside = (await (await f.view()).json()) as WhiteboardSnapshot;
  expect(outside.scene.elements[0]?.id).toBe('agent');

  const results = await Promise.all([
    f.save(scene('b'), outside.revision),
    f.save(scene('c'), outside.revision),
  ]);
  expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
  expect((await fetch(f.origin + f.endpoint)).status).toBe(403);
  expect(
    (
      await f.post(
        f.endpoint,
        { scene: scene('hijack'), revision: outside.revision },
        'https://another.example',
      )
    ).status,
  ).toBe(403);
});

test('persists multi-element anchors and exposes replies and read cursors across Agent and browser', async () => {
  const f = await setup();
  fs.writeFileSync(f.file, JSON.stringify(scene('a', 'b')));
  const previous = await f.view();
  const create = await f.browser({
    op: 'create',
    elementIds: ['a', 'b'],
    text: 'Compare these two.',
  });
  expect(create.status).toBe(200);
  const { threads } = await create.json();
  const first = threads[0];
  expect(first.anchor).toEqual({ elementIds: ['a', 'b'] });
  expect((await f.view({ 'If-None-Match': previous.headers.get('etag')! })).status).toBe(200);

  const issue = await (await f.agent({ op: 'list', agent: 'Fixture' })).json();
  expect(issue.threads[0]).toMatchObject({
    id: first.id,
    anchor: first.anchor,
    waitingOn: 'agent',
  });
  expect((await (await f.agent({ op: 'list', agent: 'Fixture' })).json()).threads).toEqual([]);
  expect(
    (await f.agent({ op: 'reply', threadId: first.id, text: 'I kept both variations.' })).status,
  ).toBe(200);
  expect((await f.browser({ op: 'status', threadId: first.id, status: 'resolved' })).status).toBe(
    200,
  );
  const reopened = (await (await f.view()).json()) as WhiteboardSnapshot;
  expect(reopened.comments.threads[0]).toMatchObject({
    anchor: first.anchor,
    status: 'resolved',
    messages: [{ text: 'Compare these two.' }, { text: 'I kept both variations.' }],
  });
  expect(
    (await f.browser({ op: 'create', elementIds: ['missing'], text: 'No anchor.' })).status,
  ).toBe(409);
  expect((await f.agent({ op: 'add', elementIds: ['b'], text: 'My alternative.' })).status).toBe(
    200,
  );
  const commentsFile = path.join(f.dir, 'comments.json');
  fs.writeFileSync(commentsFile, 'unfinished agent comment edit');
  expect(
    (await f.browser({ op: 'create', elementIds: ['a'], text: 'Keep both edits.' })).status,
  ).toBe(409);
  expect(fs.readFileSync(commentsFile, 'utf8')).toBe('unfinished agent comment edit');
});

test('rejects malformed and unsafe scene inputs and never overwrites a failed save', async () => {
  const f = await setup();
  expect(parseWhiteboardScene(scene('duplicate', 'duplicate'))).toBeNull();
  expect(
    parseWhiteboardScene({
      ...scene(),
      elements: [{ id: 'x', type: 'text', link: 'java\nscript:ignored' }],
    }),
  ).toBeNull();
  expect(() =>
    writeWhiteboardScene(f.dir, scene('too-large-for-account'), 'empty', () => {
      throw new Error('quota exhausted');
    }),
  ).toThrow('quota exhausted');
  expect(fs.existsSync(f.file)).toBe(false);

  expect(() =>
    writeWhiteboardScene(f.dir, scene('browser'), 'empty', () => {
      fs.writeFileSync(f.file, JSON.stringify(scene('agent-racing')));
    }),
  ).toThrow('changed on disk');
  expect(readWhiteboardScene(f.dir).scene).toEqual(scene('agent-racing'));
  expect(fs.readdirSync(f.dir).some((file) => file.endsWith('.tmp'))).toBe(false);

  fs.writeFileSync(f.file, 'incomplete agent edit');
  expect((await f.view()).status).toBe(422);
  expect((await f.save(scene('keep-agent-file'), 'empty')).status).toBe(409);
  expect(fs.readFileSync(f.file, 'utf8')).toBe('incomplete agent edit');
  expect(() => readWhiteboardScene(f.dir)).toThrow('not a valid Excalidraw scene');
});
