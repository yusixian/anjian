import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { startArtifactsServer, type ArtifactsServer } from '../src/server/app';
import { get, openWs, readJson, sendWsText, tempRoot, waitFor, writeDocument } from './helpers';

const running: ArtifactsServer[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const server of running.splice(0)) await server.close(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
async function fixture() {
  const temp = tempRoot();
  writeDocument(temp.root, 'draft', { 'doc.xml': '<doc><p id="p1">saved content</p></doc>' });
  const server = await startArtifactsServer({ root: temp.root, viewerDir: temp.viewer, host: '127.0.0.1', urlHost: 'localhost', debounceMs: 10,
    documentTiming: { writeDelayMs: 60_000 } });
  running.push(server);
  const origin = `http://127.0.0.1:${server.port}`;
  const headers = { Cookie: `anjian_artifacts_${server.port}=${server.token}`, Origin: origin };
  await get(`${origin}/api/document/draft/state`, headers);
  const ws = await openWs(server.port, headers);
  const selection = path.join(temp.root, '.state/document/draft/selection.json');
  const sendSelection = (quote: string) => sendWsText(ws.socket!, JSON.stringify({ type: 'selection', artifact: 'document/draft', tab: 'one', human: true, quote, blockIds: ['p1'], heading: '' }));
  return { ...temp, server, origin, headers, ws, selection, sendSelection };
}

test('quiescence drains saves, pauses HTTP and socket inputs, then resumes the same socket', async () => {
  const f = await fixture();
  f.sendSelection('before'); await waitFor(() => fs.existsSync(f.selection));
  const snapshot = path.join(f.root, '.state/document/draft/doc.loro');
  expect(fs.existsSync(snapshot)).toBe(false);
  await f.server.quiesce(async () => {
    expect(fs.existsSync(snapshot)).toBe(true);
    expect(f.server.liveClients()).toBe(1);
    const response = await get(`${f.origin}/api/document/draft/state`, f.headers);
    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('1');
    expect((await openWs(f.server.port, f.headers)).status).toBe(503);
    f.sendSelection('after');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(readJson(f.selection).quote).toBe('before');
    expect(f.ws.socket!.destroyed).toBe(false);
  });
  await waitFor(() => readJson(f.selection).quote === 'after');
  expect((await get(`${f.origin}/api/document/draft/state`, f.headers)).status).toBe(200);
  expect(f.server.liveClients()).toBe(1);
  f.ws.socket!.destroy();
});

test('watcher input is retained during the snapshot and replayed when work fails', async () => {
  const f = await fixture();
  const warnings = path.join(f.root, '.state/document/draft/warnings.json');
  await expect(f.server.quiesce(async () => {
    const before = fs.readFileSync(warnings, 'utf8');
    fs.writeFileSync(path.join(f.root, 'document/draft/doc.xml'), '<doc><invalid');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fs.readFileSync(warnings, 'utf8')).toBe(before);
    throw new Error('provider failed');
  })).rejects.toThrow('provider failed');
  await waitFor(() => readJson(warnings).warnings.length > 0);
  expect((await get(`${f.origin}/api/document/draft/state`, f.headers)).status).toBe(200);
  expect(f.ws.socket!.destroyed).toBe(false);
  f.ws.socket!.destroy();
});

test('maintenance serializes and shutdown waits for the active snapshot', async () => {
  const f = await fixture();
  const entered = deferred(); const release = deferred();
  const first = f.server.quiesce(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  let closed = false;
  const close = f.server.close().then(() => { closed = true; });
  const second = f.server.quiesce(async () => { throw new Error('must not start after close'); });
  expect(closed).toBe(false);
  release.resolve();
  await first;
  await expect(second).rejects.toThrow('Project is stopping');
  await close;
  expect(closed).toBe(true);
});

test('a request already opening a document finishes before snapshot work begins', async () => {
  const f = await fixture();
  writeDocument(f.root, 'pending', { 'doc.xml': '<doc><p>pending request</p></doc>' });
  const entered = deferred(); const release = deferred();
  const readFile = fsPromises.readFile.bind(fsPromises);
  const snapshot = path.join(f.root, '.state/document/pending/doc.loro');
  const spy = vi.spyOn(fsPromises, 'readFile').mockImplementation(async (...args) => {
    if (args[0] === snapshot) { entered.resolve(); await release.promise; }
    return readFile(...args);
  });
  const requesting = get(`${f.origin}/api/document/pending/state`, f.headers);
  await entered.promise;
  let worked = false;
  const paused = f.server.quiesce(async () => { worked = true; expect(fs.existsSync(snapshot)).toBe(true); });
  try {
    await waitFor(() => f.server.liveClients() === 1);
    expect(worked).toBe(false);
  } finally { release.resolve(); }
  expect((await requesting).status).toBe(200);
  await paused; spy.mockRestore();
  expect(worked).toBe(true);
  f.ws.socket!.destroy();
});
