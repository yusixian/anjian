import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { applyLocalFiles, filesHash, localFiles, validateFiles } from '../src/cli/remote-core';
import { MAX_SLIDE_DECK_BYTES } from '../src/shared/slides';
import {
  readRemoteArtifact,
  RemoteTransferError,
  writeRemoteArtifact,
} from '../src/server/remote-transfer';

const roots: string[] = [];
const project = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-remote-transfer-'));
  roots.push(root);
  return root;
};
const encode = (text: string | Buffer) => Buffer.from(text).toString('base64');
const write = (root: string, artifact: string, baseRevision: string | null, files: Record<string, string>) =>
  writeRemoteArtifact(root, artifact, { baseRevision, files });

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('remote artifact transfer', () => {
  test('creates a document, transfers binary assets, preserves comments and detects conflicts', () => {
    const root = project();
    const artifact = 'document/plan';
    expect(readRemoteArtifact(root, artifact)).toEqual({ revision: null, files: {} });
    const first = write(root, artifact, null, {
      'doc.xml': encode('<doc><p>one</p></doc>'),
      'assets/photo.png': encode(Buffer.from([0, 255, 127, 42])),
    });
    expect(first.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(readRemoteArtifact(root, artifact)).toEqual(first);

    const dir = path.join(root, '.anjian/artifacts/document/plan');
    fs.writeFileSync(path.join(dir, 'comments.json'), 'human feedback');
    fs.mkdirSync(path.join(dir, '.state'));
    fs.writeFileSync(path.join(dir, '.state', 'server.json'), 'server state');
    expect(readRemoteArtifact(root, artifact).revision).toBe(first.revision);
    expect(() => write(root, artifact, null, { 'doc.xml': encode('<doc/>') })).toThrowError(
      expect.objectContaining({ status: 409, code: 'revision_conflict' }),
    );
    const second = write(root, artifact, first.revision, { 'doc.xml': encode('<doc><p>two</p></doc>') });
    expect(second.revision).not.toBe(first.revision);
    expect(fs.existsSync(path.join(dir, 'assets/photo.png'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'comments.json'), 'utf8')).toBe('human feedback');
    expect(fs.readFileSync(path.join(dir, '.state/server.json'), 'utf8')).toBe('server state');
    expect(readRemoteArtifact(root, artifact)).toEqual(second);
  });

  test('accepts a board with its pages but never transfers board comments', () => {
    const root = project();
    const canvas = {
      version: 1,
      pages: [{ id: 'main', name: 'Main' }],
      boards: { demo: { page: 'main', file: 'pages/main/demo.html', x: 0, y: 0, w: 640, h: 400 } },
    };
    const result = write(root, 'artboard/demo', null, {
      'canvas.json': encode(JSON.stringify(canvas)),
      'pages/main/demo.html': encode('<html><body>hello</body></html>'),
    });
    expect(result.files['canvas.json']).toBeDefined();
    expect(() => write(root, 'artboard/bad', null, { 'canvas.json': encode(JSON.stringify(canvas)) }))
      .toThrowError(expect.objectContaining({ status: 400 }));
    expect(() => write(root, 'artboard/demo', result.revision, {
      ...result.files,
      'comments.json': encode('{}'),
    })).toThrowError(expect.objectContaining({ status: 400 }));
  });

  test('transfers only the whiteboard scene and preserves feedback across revision-checked updates', () => {
    const root = project();
    const artifact = 'whiteboard/diagram';
    const scene = (color: string) => ({
      'scene.excalidraw': encode(JSON.stringify({
        type: 'excalidraw',
        version: 2,
        elements: [],
        appState: { viewBackgroundColor: color },
      })),
    });
    expect(readRemoteArtifact(root, artifact)).toEqual({ revision: null, files: {} });
    const first = write(root, artifact, null, scene('#ffffff'));
    const dir = path.join(root, '.anjian/artifacts', artifact);
    fs.writeFileSync(path.join(dir, 'comments.json'), 'human feedback');
    fs.writeFileSync(path.join(dir, 'preview.svg'), 'local note');
    expect(readRemoteArtifact(root, artifact)).toEqual(first);

    for (const files of [
      { ...scene('#fcfcfc'), 'comments.json': encode('{}') },
      { ...scene('#fcfcfc'), 'assets/external.png': encode('contents') },
      { 'scene.excalidraw': encode('{"type":"not-excalidraw"}') },
    ]) {
      expect(() => write(root, artifact, first.revision, files)).toThrowError(
        expect.objectContaining({ status: 400 }),
      );
      expect(readRemoteArtifact(root, artifact)).toEqual(first);
    }
    const second = write(root, artifact, first.revision, scene('#f4f4f4'));
    expect(second.revision).not.toBe(first.revision);
    expect(() => write(root, artifact, first.revision, scene('#f3f3f3'))).toThrowError(
      expect.objectContaining({ status: 409, code: 'revision_conflict' }),
    );
    expect(readRemoteArtifact(root, artifact)).toEqual(second);
    expect(fs.readFileSync(path.join(dir, 'comments.json'), 'utf8')).toBe('human feedback');
    expect(fs.readFileSync(path.join(dir, 'preview.svg'), 'utf8')).toBe('local note');
  });

  test('transfers only listed whiteboard pages and removes obsolete scenes without touching feedback', () => {
    const root = project();
    const artifact = 'whiteboard/review';
    const scene = encode(JSON.stringify({ type: 'excalidraw', version: 2, elements: [] }));
    const manifest = (...ids: string[]) => encode(JSON.stringify({
      version: 1, pages: ids.map((id) => ({ id, title: id })),
    }));
    const initial = {
      'scene.excalidraw': scene,
      'pages.json': manifest('agenda', 'summary'),
      'pages/agenda.excalidraw': scene,
      'pages/summary.excalidraw': scene,
    };
    const first = write(root, artifact, null, initial);
    expect(readRemoteArtifact(root, artifact)).toEqual(first);
    const dir = path.join(root, '.anjian/artifacts', artifact);
    fs.writeFileSync(path.join(dir, 'comments.json'), 'human feedback');
    fs.writeFileSync(path.join(dir, 'pages/notes.txt'), 'unmanaged note');
    const orphan = path.join(dir, 'pages/orphan.excalidraw');
    fs.writeFileSync(orphan, 'unlisted scene data');
    expect(readRemoteArtifact(root, artifact)).toEqual(first);

    const withoutSummary = { ...initial, 'pages.json': manifest('agenda') };
    const invalidFiles = [
      withoutSummary,
      { ...initial, 'pages.json': manifest('agenda', 'agenda') },
      { ...initial, 'pages.json': manifest('agenda', '../summary') },
      { ...initial, 'pages.json': manifest('agenda', 'missing') },
      { ...initial, 'pages.json': manifest('main', 'agenda', 'summary') },
      { ...initial, 'pages/Agenda.excalidraw': scene },
      { ...initial, 'pages/summary.excalidraw': encode('{}') },
    ];
    for (const files of invalidFiles) {
      expect(() => write(root, artifact, first.revision, files)).toThrowError(
        expect.objectContaining({ status: 400 }),
      );
      expect(readRemoteArtifact(root, artifact)).toEqual(first);
    }

    const updated = {
      'scene.excalidraw': scene,
      'pages.json': manifest('agenda'),
      'pages/agenda.excalidraw': scene,
    };
    const next = write(root, artifact, first.revision, updated);
    expect(next.revision).not.toBe(first.revision);
    expect(readRemoteArtifact(root, artifact).files).toEqual(updated);
    expect(fs.existsSync(path.join(dir, 'pages/summary.excalidraw'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'comments.json'), 'utf8')).toBe('human feedback');
    expect(fs.readFileSync(path.join(dir, 'pages/notes.txt'), 'utf8')).toBe('unmanaged note');
    expect(fs.readFileSync(orphan, 'utf8')).toBe('unlisted scene data');
    expect(() => write(root, artifact, next.revision, {
      ...updated,
      'pages.json': manifest('agenda', 'orphan'),
      'pages/orphan.excalidraw': scene,
    })).toThrow('Unlisted whiteboard file already exists');
    expect(readRemoteArtifact(root, artifact)).toEqual(next);
    expect(fs.readFileSync(orphan, 'utf8')).toBe('unlisted scene data');
  });

  test('rejects unsafe paths, duplicate case, invalid payloads and oversized input without changing files', () => {
    const root = project();
    const original = write(root, 'html/preview', null, { 'index.html': encode('<html>safe</html>') });
    const attempts: Record<string, string>[] = [
      { 'index.html': original.files['index.html']!, '../escape': encode('x') },
      { 'index.html': original.files['index.html']!, 'assets\\evil': encode('x') },
      { 'index.html': original.files['index.html']!, '.state/key': encode('x') },
      { 'index.html': original.files['index.html']!, 'assets/a': encode('x'), 'assets/A': encode('x') },
      { 'index.html': 'abcd=' },
      { 'index.html': encode('<html>safe</html>'), 'COMMENTS.JSON': encode('{}') },
    ];
    for (const files of attempts) {
      expect(() => write(root, 'html/preview', original.revision, files)).toThrowError(RemoteTransferError);
      expect(readRemoteArtifact(root, 'html/preview')).toEqual(original);
    }
    expect(() => write(root, 'html/preview', original.revision, {
      'index.html': encode(Buffer.alloc(32 * 1024 * 1024 + 1)),
    })).toThrowError(expect.objectContaining({ status: 413 }));
    expect(readRemoteArtifact(root, 'html/preview')).toEqual(original);
  });

  test('refuses symlinked artifacts and symlinked contents', () => {
    const root = project();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-remote-outside-'));
    roots.push(outside);
    const parent = path.join(root, '.anjian/artifacts/document');
    fs.mkdirSync(parent, { recursive: true });
    fs.symlinkSync(outside, path.join(parent, 'link'));
    expect(() => readRemoteArtifact(root, 'document/link')).toThrowError(
      expect.objectContaining({ status: 409, code: 'unsafe_artifact' }),
    );
    const created = write(root, 'document/plan', null, { 'doc.xml': encode('<doc/>') });
    fs.symlinkSync(outside, path.join(parent, 'plan/assets'));
    expect(() => readRemoteArtifact(root, 'document/plan')).toThrowError(
      expect.objectContaining({ code: 'unsafe_artifact' }),
    );
    expect(() => write(root, 'document/plan', created.revision, created.files)).toThrowError(
      expect.objectContaining({ code: 'unsafe_artifact' }),
    );
  });

  test('does not create an artifact when the document is malformed', () => {
    const root = project();
    expect(() => write(root, 'document/bad', null, {
      'doc.xml': encode('<doc><p>broken</h2></doc>'),
    })).toThrowError(expect.objectContaining({ status: 400 }));
    expect(readRemoteArtifact(root, 'document/bad')).toEqual({ revision: null, files: {} });
  });

  test('keeps the original tree when staging cannot create a new resource', () => {
    const root = project();
    const first = write(root, 'document/plan', null, { 'doc.xml': encode('<doc/>') });
    const dir = path.join(root, '.anjian/artifacts/document/plan');
    // This legacy non-source file occupies the directory that an incoming asset would need.
    fs.writeFileSync(path.join(dir, 'assets'), 'legacy');
    expect(() => write(root, 'document/plan', first.revision, {
      'doc.xml': encode('<doc><p>changed</p></doc>'),
      'assets/new.txt': encode('new'),
    })).toThrow();
    expect(fs.readFileSync(path.join(dir, 'doc.xml'), 'utf8')).toBe('<doc/>');
    expect(fs.readFileSync(path.join(dir, 'assets'), 'utf8')).toBe('legacy');
    expect(fs.readdirSync(path.dirname(dir)).some((name) => name.startsWith('.remote-staging-')))
      .toBe(false);
  });
});

test('metadata-only directories remain absent until source is uploaded', () => {
  const root = project();
  const dir = path.join(root, '.anjian/artifacts/document/plan');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.artifact-id'), 'mounted');
  expect(readRemoteArtifact(root, 'document/plan')).toEqual({ revision: null, files: {} });
  expect(write(root, 'document/plan', null, { 'doc.xml': encode('<doc><p>first</p></doc>') }).revision).toMatch(/^sha256:/);
});


test('restores the previous document if prepared state commit fails', () => {
  const root = project();
  const original = write(root, 'document/rollback', null, { 'doc.xml': encode('<doc><p>old</p></doc>') });
  let aborted = false;
  expect(() => writeRemoteArtifact(root, 'document/rollback', {
    baseRevision: original.revision, files: { 'doc.xml': encode('<doc><p>new</p></doc>') },
  }, undefined, {
    xml: '<doc><p>new</p></doc>', stateDeltaBytes: 20,
    validate: () => undefined, stage: () => undefined,
    abort: () => { aborted = true; },
    commit: () => { throw new Error('snapshot could not be committed'); },
    finalize: () => undefined,
  })).toThrow('snapshot could not be committed');
  expect(aborted).toBe(true);
  expect(readRemoteArtifact(root, 'document/rollback')).toEqual(original);
});

test('restores source even when prepared state cleanup also fails', () => {
  const root = project();
  const original = write(root, 'document/rollback-abort', null, { 'doc.xml': encode('<doc><p>old</p></doc>') });
  expect(() => writeRemoteArtifact(root, 'document/rollback-abort', {
    baseRevision: original.revision, files: { 'doc.xml': encode('<doc><p>new</p></doc>') },
  }, undefined, {
    xml: '<doc><p>new</p></doc>', stateDeltaBytes: 0,
    validate: () => undefined, stage: () => undefined,
    abort: () => { throw new Error('cleanup failed'); },
    commit: () => { throw new Error('commit failed'); },
    finalize: () => undefined,
  })).toThrow('Remote artifact rollback failed');
  expect(readRemoteArtifact(root, 'document/rollback-abort')).toEqual(original);
});

test('charges a new artifact identity before the first upload, without needing a prior GET', () => {
  const root = project();
  const source = '<p>first upload</p>';
  let admitted = -1;
  writeRemoteArtifact(root, 'html/new-identity', { baseRevision: null, files: { 'index.html': encode(source) } },
    (bytes) => { admitted = bytes; });
  const dir = path.join(root, '.anjian/artifacts/html/new-identity');
  const identity = fs.statSync(path.join(dir, '.artifact-id')).size;
  expect(identity).toBeGreaterThan(0);
  expect(admitted).toBe(Buffer.byteLength(source) + identity);
});

test('generated state is calculated from staged source and included before any live mutation', () => {
  const root = project();
  const before = write(root, 'html/budget', null, { 'index.html': encode('a') });
  let stagedState = false;
  let checked = false;
  expect(() => writeRemoteArtifact(root, 'html/budget', {
    baseRevision: before.revision, files: { 'index.html': encode('ab') },
  }, (delta) => {
    checked = true;
    expect(delta).toBe(101);
    throw new RemoteTransferError(413, 'storage_quota_exceeded', 'quota');
  }, undefined, (directory) => {
    expect(fs.readFileSync(path.join(directory, 'index.html'), 'utf8')).toBe('ab');
    return { stateDeltaBytes: 100, validate() {}, stage() { stagedState = true; }, abort() {}, commit() {}, finalize() {} };
  })).toThrowError(expect.objectContaining({ code: 'storage_quota_exceeded' }));
  expect(checked).toBe(true);
  expect(stagedState).toBe(false);
  expect(readRemoteArtifact(root, 'html/budget')).toEqual(before);
  expect(fs.readdirSync(path.join(root, '.anjian/artifacts/html'))).toEqual(['budget']);
});

test('generated state commit failure restores both source and state', () => {
  const root = project();
  const before = write(root, 'html/rollback', null, { 'index.html': encode('old') });
  const stateFile = path.join(root, 'state.json'); fs.writeFileSync(stateFile, 'old state');
  expect(() => writeRemoteArtifact(root, 'html/rollback', {
    baseRevision: before.revision, files: { 'index.html': encode('new') },
  }, () => {}, undefined, () => ({
    stateDeltaBytes: 0, validate() {}, stage() {},
    commit() { fs.writeFileSync(stateFile, 'new state'); throw new Error('state install failed'); },
    abort() { fs.writeFileSync(stateFile, 'old state'); }, finalize() {},
  }))).toThrow('state install failed');
  expect(readRemoteArtifact(root, 'html/rollback')).toEqual(before);
  expect(fs.readFileSync(stateFile, 'utf8')).toBe('old state');
});

const deck = (body: string) => ({
  'deck.json': encode(JSON.stringify({
    version: 1,
    title: 'Design review',
    slides: [{ id: 'intro', title: 'Introduction', body, notes: 'Private notes' }],
  })),
});

test('transfers only the slide deck and preserves comments and revisions', () => {
  const root = project();
  const artifact = 'slides/design-review';
  const original = write(root, artifact, null, deck('First draft'));
  const dir = path.join(root, '.anjian/artifacts', artifact);
  const comments = path.join(dir, 'comments.json');
  fs.writeFileSync(comments, 'human feedback');
  expect(readRemoteArtifact(root, artifact)).toEqual(original);
  expect(() => write(root, artifact, null, deck('Outdated edit'))).toThrowError(
    expect.objectContaining({ code: 'revision_conflict' }),
  );
  const updated = write(root, artifact, original.revision, deck('Second draft'));
  expect(updated.files).toEqual(deck('Second draft'));
  expect(updated.revision).not.toBe(original.revision);
  expect(fs.readFileSync(comments, 'utf8')).toBe('human feedback');
});

test('rejects invalid slide source uploads and pull manifests', () => {
  const root = project();
  const artifact = 'slides/design-review';
  const original = write(root, artifact, null, deck('First draft'));
  expect(() => write(root, artifact, original.revision, {})).toThrowError(
    expect.objectContaining({ code: 'invalid_artifact' }),
  );
  const invalidFiles: Record<string, string>[] = [
    { 'deck.json': encode(Buffer.from([0xff])) },
    { 'deck.json': encode('{"version":1,"title":"Missing slides"}') },
    { 'deck.json': encode('{') },
    { 'deck.json': encode(Buffer.alloc(MAX_SLIDE_DECK_BYTES + 1)) },
    { ...original.files, 'comments.json': encode('{}') },
    { ...original.files, 'pages/extra.html': encode('<p>extra</p>') },
    { ...original.files, '../deck.json': encode('{}') },
    { 'Deck.json': original.files['deck.json']! },
  ];
  for (const files of invalidFiles) {
    expect(() => write(root, artifact, original.revision, files)).toThrowError(RemoteTransferError);
    expect(() => validateFiles(artifact, files)).toThrow();
    expect(readRemoteArtifact(root, artifact)).toEqual(original);
  }
  fs.writeFileSync(path.join(root, '.anjian/artifacts', artifact, 'deck.json'), '{');
  expect(() => readRemoteArtifact(root, artifact)).toThrowError(
    expect.objectContaining({ code: 'invalid_artifact' }),
  );
});

test('keeps malformed local slide bytes available for backup before replacing the deck', () => {
  const root = project();
  const artifact = 'slides/design-review';
  const dir = path.join(root, '.anjian/artifacts', artifact);
  fs.mkdirSync(dir, { recursive: true });
  const broken = Buffer.from([0x7b, 0xff]);
  fs.writeFileSync(path.join(dir, 'deck.json'), broken);
  fs.writeFileSync(path.join(dir, 'comments.json'), 'human feedback');

  const local = localFiles(root, artifact);
  expect(local).toEqual({ 'deck.json': encode(broken) });
  expect(() => validateFiles(artifact, local)).toThrow();
  applyLocalFiles(root, artifact, deck('Replacement'), filesHash(local));
  expect(localFiles(root, artifact)).toEqual(deck('Replacement'));
  expect(fs.readFileSync(path.join(dir, 'comments.json'), 'utf8')).toBe('human feedback');
});

test('storyboard transfer keeps the timeline and media together and excludes review history', () => {
  const root = project();
  const artifact = 'storyboard/demo';
  const files = {
    'timeline.json': encode(JSON.stringify({
      version: 1, title: 'Review', tracks: [{
        id: 'picture', name: 'Picture', kind: 'video', clips: [{
          id: 'first', asset: 'assets/opening.png', startMs: 0, trimMs: 0, durationMs: 500,
        }],
      }],
    })),
    'assets/opening.png': encode('fixture bytes'),
  };
  const saved = write(root, artifact, null, files);
  const dir = path.join(root, '.anjian/artifacts', artifact);
  fs.writeFileSync(path.join(dir, 'comments.json'), 'keep feedback');
  expect(readRemoteArtifact(root, artifact)).toEqual(saved);
  expect(() => write(root, artifact, saved.revision, {
    'timeline.json': files['timeline.json'],
  })).toThrow('missing storyboard asset');
  expect(() => validateFiles(artifact, { 'timeline.json': files['timeline.json'] })).toThrow('Missing storyboard asset');
  expect(() => write(root, artifact, saved.revision, {
    ...files, 'exports/demo.mp4': encode('generated'),
  })).toThrow('source file is not allowed');
  expect(readRemoteArtifact(root, artifact)).toEqual(saved);
  expect(fs.readFileSync(path.join(dir, 'comments.json'), 'utf8')).toBe('keep feedback');
});

test('validates realistic storyboard media manifests without recursive Base64 patterns', () => {
  const artifact = 'storyboard/remote';
  const files = {
    'timeline.json': encode(JSON.stringify({ version: 1, title: 'Review', tracks: [] })),
    'assets/footage.mp4': Buffer.alloc(4 * 1024 * 1024).toString('base64'),
  };
  expect(() => validateFiles(artifact, files)).not.toThrow();
});

test('storyboard transfers enforce the same media count limit as the editor', () => {
  const artifact = 'storyboard/count';
  const files = {
    'timeline.json': encode(JSON.stringify({ version: 1, title: 'Demo', tracks: [] })),
    ...Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`assets/clip-${i}.png`, 'YQ=='])),
  };
  expect(() => write(project(), artifact, null, files)).toThrow('too many media files');
  expect(() => validateFiles(artifact, files)).toThrow('too many media files');
});
