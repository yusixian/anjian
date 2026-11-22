import fs from 'node:fs';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { type ArtifactsServer, startArtifactsServer } from '../src/server/app';
import { artifactPath } from '../src/server/artifact-address';
import {
  editWhiteboardPages,
  readWhiteboardScene,
  writeWhiteboardScene,
} from '../src/server/whiteboard';
import {
  emptyWhiteboardScene,
  MAX_WHITEBOARD_SCENE_BYTES,
  MAX_WHITEBOARD_SOURCE_BYTES,
  parseWhiteboardScene,
  WHITEBOARD_PAGES_FILE,
  WHITEBOARD_SCENE_FILE,
  whiteboardPageFile,
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
  const viewPage = (page: string) =>
    fetch(`${origin + endpoint}?page=${encodeURIComponent(page)}`, { headers: authorized });
  const post = (route: string, value: unknown, source = origin) =>
    fetch(origin + route, {
      method: 'POST',
      headers: { ...authorized, 'Content-Type': 'application/json', 'Origin': source },
      body: JSON.stringify(value),
    });
  const save = (value: WhiteboardScene, revision: string, page?: string) =>
    post(page ? `${endpoint}?page=${encodeURIComponent(page)}` : endpoint, {
      scene: value,
      revision,
    });
  const browser = (body: unknown) => post(`${endpoint}/comments`, body);
  const agent = (body: unknown) =>
    fetch(`${origin}/api/agent/whiteboard/sketches/comments?key=${server.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { agent, browser, dir, endpoint, file, origin, post, save, view, viewPage };
}

test('preserves the implicit main page and keeps saves fenced to the selected page', async () => {
  const f = await setup();
  const legacy = scene('legacy');
  fs.writeFileSync(f.file, `${JSON.stringify(legacy)}\n`);
  const manifest = path.join(f.dir, WHITEBOARD_PAGES_FILE);
  const main = (await (await f.view()).json()) as WhiteboardSnapshot;
  expect(main).toMatchObject({
    page: 'main',
    pages: [{ id: 'main', title: 'Main' }],
    scene: legacy,
  });
  expect(fs.existsSync(manifest)).toBe(false);

  const response = await f.post(`${f.endpoint}/pages`, { title: 'Design notes' });
  expect(response.status).toBe(200);
  const created = (await response.json()) as WhiteboardSnapshot;
  const extra = 'design-notes';
  expect(created).toMatchObject({
    page: extra,
    title: 'Review sketches',
    pages: [
      { id: 'main', title: 'Main' },
      { id: extra, title: 'Design notes' },
    ],
    scene: { elements: [] },
  });
  expect(JSON.parse(fs.readFileSync(manifest, 'utf8'))).toEqual({
    version: 1,
    pages: [{ id: extra, title: 'Design notes' }],
  });
  expect(fs.existsSync(path.join(f.dir, whiteboardPageFile(extra)))).toBe(true);
  expect((await f.save(scene('legacy'), main.revision, extra)).status).toBe(409);
  const saved = (await (
    await f.save(legacy, created.revision, extra)
  ).json()) as WhiteboardSnapshot;
  expect(saved.revision).not.toBe(main.revision);
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8'))).toEqual(legacy);

  const renamed = (await (
    await f.post(`${f.endpoint}/pages`, { page: extra, title: 'Finishes' })
  ).json()) as WhiteboardSnapshot;
  expect(renamed).toMatchObject({
    revision: saved.revision,
    page: extra,
    pages: [{ id: 'main' }, { id: extra, title: 'Finishes' }],
    scene: legacy,
  });
  expect((await f.viewPage('not-registered')).status).toBe(404);
  expect((await f.viewPage('../main')).status).toBe(400);
});

test('adds a page without invalidating edits started from an implicit blank main scene', async () => {
  const f = await setup();
  const initial = (await (await f.view()).json()) as WhiteboardSnapshot;
  expect(initial.revision).toBe('empty');
  expect(fs.existsSync(f.file)).toBe(false);

  expect((await f.post(`${f.endpoint}/pages`, { title: 'Second' })).status).toBe(200);
  const materialized = (await (await f.view()).json()) as WhiteboardSnapshot;
  expect(materialized.revision).toBe(initial.revision);
  expect(materialized.scene).toEqual(initial.scene);
  expect(fs.existsSync(f.file)).toBe(true);
  expect((await f.save(scene('draft'), initial.revision)).status).toBe(200);
});

test('associates comments with the selected page while preserving legacy anchors', async () => {
  const f = await setup();
  fs.writeFileSync(f.file, JSON.stringify(scene('shared-element', 'main-only')));
  const created = (await (
    await f.post(`${f.endpoint}/pages`, { title: 'Second' })
  ).json()) as WhiteboardSnapshot;
  expect((await f.save(scene('shared-element'), created.revision, created.page)).status).toBe(200);
  expect(
    (await f.browser({ op: 'create', elementIds: ['shared-element'], text: 'Main' })).status,
  ).toBe(200);
  expect(
    (
      await f.browser({
        op: 'create',
        page: created.page,
        elementIds: ['main-only'],
        text: 'Wrong page',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await f.agent({
        op: 'add',
        page: created.page,
        elementIds: ['shared-element'],
        text: 'Extra',
      })
    ).status,
  ).toBe(200);
  const snapshot = (await (await f.viewPage(created.page)).json()) as WhiteboardSnapshot;
  expect(snapshot.comments.threads.map(({ anchor }) => anchor)).toEqual([
    { elementIds: ['shared-element'] },
    { page: 'second', elementIds: ['shared-element'] },
  ]);
});

test('admits only source growth within the remote whiteboard transfer limit', async () => {
  const f = await setup();
  const first = editWhiteboardPages(f.dir, 'First', undefined);
  const second = editWhiteboardPages(f.dir, 'Second', undefined);
  const main = readWhiteboardScene(f.dir);
  expect(main.bytes).toBeGreaterThan(0);
  const manifestBytes = fs.statSync(path.join(f.dir, WHITEBOARD_PAGES_FILE)).size;
  const pad = (page: string, bytes: number) => {
    const file = path.join(f.dir, whiteboardPageFile(page));
    fs.appendFileSync(file, Buffer.alloc(bytes - fs.statSync(file).size, ' '));
  };
  pad(first.page, MAX_WHITEBOARD_SCENE_BYTES);
  pad(
    second.page,
    MAX_WHITEBOARD_SOURCE_BYTES - MAX_WHITEBOARD_SCENE_BYTES - main.bytes - manifestBytes,
  );
  expect((await f.save(scene('growth'), main.revision)).status).toBe(413);
  expect((await f.post(`${f.endpoint}/pages`, { title: 'Too much' })).status).toBe(413);
  expect(readWhiteboardScene(f.dir).revision).toBe(main.revision);
  expect(fs.existsSync(path.join(f.dir, whiteboardPageFile('too-much')))).toBe(false);
});

test('keeps external manifest edits while rolling back a staged page creation', async () => {
  const f = await setup();
  const other = { version: 1, pages: [{ id: 'from-agent', title: 'From agent' }] };
  const manifest = path.join(f.dir, WHITEBOARD_PAGES_FILE);
  expect(() =>
    editWhiteboardPages(f.dir, 'From browser', undefined, () => {
      fs.writeFileSync(manifest, JSON.stringify(other));
    }),
  ).toThrow('pages changed on disk');
  expect(JSON.parse(fs.readFileSync(manifest, 'utf8'))).toEqual(other);
  expect(fs.existsSync(f.file)).toBe(false);
  const pages = path.join(f.dir, 'pages');
  expect(fs.existsSync(pages) ? fs.readdirSync(pages) : []).toEqual([]);
  expect((await f.viewPage('from-agent')).status).toBe(404);
});

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
