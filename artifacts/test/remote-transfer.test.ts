import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

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
