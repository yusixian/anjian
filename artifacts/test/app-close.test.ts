import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { type ArtifactsServer, startArtifactsServer } from '../src/server/app';
import { get, tempRoot, writeDocument } from './helpers';

const faults = vi.hoisted(() => ({
  recordingFailures: 0,
  documentFailures: 0,
  recordingCalls: 0,
  documentCalls: 0,
  documentGate: null as Promise<void> | null,
}));

vi.mock('../src/server/verify-recordings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/verify-recordings')>();
  return {
    ...actual,
    createVerifyRecordings: (...args: Parameters<typeof actual.createVerifyRecordings>) => {
      const registry = actual.createVerifyRecordings(...args);
      return { ...registry, async close() {
        faults.recordingCalls++;
        if (faults.recordingFailures-- > 0) throw new Error('injected recording close failure');
        await registry.close();
      } };
    },
  };
});

vi.mock('../src/server/documents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/documents')>();
  return {
    ...actual,
    createDocumentRegistry: (...args: Parameters<typeof actual.createDocumentRegistry>) => {
      const registry = actual.createDocumentRegistry(...args);
      return { ...registry, async close() {
        faults.documentCalls++;
        if (faults.documentFailures-- > 0) throw new Error('injected document close failure');
        await faults.documentGate;
        await registry.close();
      } };
    },
  };
});

const running: ArtifactsServer[] = [];
beforeEach(() => {
  faults.recordingFailures = 0;
  faults.documentFailures = 0;
  faults.recordingCalls = 0;
  faults.documentCalls = 0;
  faults.documentGate = null;
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

async function start() {
  const { root, viewer } = tempRoot();
  writeDocument(root, 'draft', { 'doc.xml': '<doc><p>Close must save this document</p></doc>' });
  const server = await startArtifactsServer({
    root, viewerDir: viewer, host: '127.0.0.1', urlHost: 'localhost',
    documentTiming: { writeDelayMs: 60_000 },
  });
  running.push(server);
  const response = await get(`http://127.0.0.1:${server.port}/api/document/draft/state`, {
    Cookie: `anjian_artifacts_${server.port}=${server.token}`,
  });
  expect(response.status).toBe(200);
  const snapshot = path.join(root, '.state/document/draft/doc.loro');
  expect(fs.existsSync(snapshot)).toBe(false);
  return { server, snapshot };
}

test('a recording close failure still flushes documents and can be retried', async () => {
  const { server, snapshot } = await start();
  faults.recordingFailures = 1;
  await expect(server.close()).rejects.toThrow('Project did not close completely');
  expect(faults.recordingCalls).toBe(1);
  expect(faults.documentCalls).toBe(1);
  expect(fs.existsSync(snapshot)).toBe(true);
  await server.close();
  expect(faults.recordingCalls).toBe(2);
  expect(faults.documentCalls).toBe(1);
});

test('a document close failure keeps the mount incomplete until retry flushes it', async () => {
  const { server, snapshot } = await start();
  faults.documentFailures = 1;
  await expect(server.close()).rejects.toThrow('Project did not close completely');
  expect(faults.recordingCalls).toBe(1);
  expect(faults.documentCalls).toBe(1);
  expect(fs.existsSync(snapshot)).toBe(false);
  await server.close();
  expect(faults.recordingCalls).toBe(1);
  expect(faults.documentCalls).toBe(2);
  expect(fs.existsSync(snapshot)).toBe(true);
});

test('concurrent closes share one drain and reject new main and board requests', async () => {
  const { server } = await start();
  let release!: () => void;
  faults.documentGate = new Promise<void>((resolve) => { release = resolve; });
  const first = server.close();
  const second = server.close();
  expect(second).toBe(first);
  try {
    await vi.waitFor(() => expect(faults.documentCalls).toBe(1));
    expect((await get(`http://127.0.0.1:${server.port}/`)).status).toBe(503);
    expect((await get(`http://127.0.0.1:${server.boardPort}/`)).status).toBe(503);
  } finally { release(); }
  await Promise.all([first, second]);
  await server.close();
  expect(faults.recordingCalls).toBe(1);
  expect(faults.documentCalls).toBe(1);
});

test('a partially closed mount retains its compatibility marker until retry succeeds', async () => {
  const { root, viewer } = tempRoot();
  const server = await startArtifactsServer({
    root, viewerDir: viewer, host: '127.0.0.1', urlHost: 'localhost',
    mount: { port: 49111, boardPort: 49112, token: 'mounted-test', version: 'test' },
  });
  running.push(server);
  const info = path.join(root, '.state/server-info');
  expect(fs.existsSync(info)).toBe(true);
  faults.documentFailures = 1;
  await expect(server.close()).rejects.toThrow('Project did not close completely');
  expect(fs.existsSync(info)).toBe(true);
  await server.close();
  expect(fs.existsSync(info)).toBe(false);
});
