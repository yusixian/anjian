import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { startHub } from '../src/server/hub';
import { machinePaths, registerProject } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { openWs, sendWsText, tempRoot, waitFor, writeArtboard, writeHtml, writeDocument } from './helpers';

test('background rounds retain the old file at quota and retry without another filesystem event', async () => {
  const temp = tempRoot(); const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project'); const artifacts = path.join(project, '.anjian/artifacts');
  const canvas = { version: 1 as const, pages: [{ id: 'p', name: 'P' }],
    boards: { a: { file: 'pages/a.html', page: 'p', x: 0, y: 0, w: 100, h: 100 } },
    groups: { q: { boards: ['a'], choose: true } },
    notes: { r: { page: 'p', kind: 'title' as const, x: 0, y: -400, text: 'Round' } } };
  writeArtboard(artifacts, 'board', canvas, { 'pages/a.html': '<html><body>Board</body></html>' });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') }); registerProject(paths.projects, project);
  const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1', ports: [0], boardPorts: [0], token: 'a'.repeat(48), version: 'test', viewerDir: temp.viewer, runtimeDir: temp.runtime });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const response = await fetch(`http://127.0.0.1:${hub.port}/api/agent/artboard/board/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'choose', group: 'q', board: 'a' }) });
    expect(response.status, await response.clone().text()).toBe(200);
    const rounds = path.join(artifacts, '.state/artboard/board/rounds.json');
    const old = fs.readFileSync(rounds, 'utf8');
    const settings = createStorageSettings(paths.home); settings.setSharedLimit(0);
    canvas.notes.r.text = 'Updated round title requiring more capacity';
    fs.writeFileSync(path.join(artifacts, 'artboard/board/canvas.json'), JSON.stringify(canvas));
    await waitFor(() => warning.mock.calls.some(([message]) => String(message).includes('Background artifact state')));
    // Drain both fs.watch and the one-second backup poll before restoring capacity.
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(fs.readFileSync(rounds, 'utf8')).toBe(old);
    const resumedAt = Date.now();
    settings.setSharedLimit(1024 * 1024);
    await waitFor(() => fs.readFileSync(rounds, 'utf8').includes(canvas.notes.r.text), 35_000);
    expect(Date.now() - resumedAt).toBeGreaterThan(20_000);
  } finally { warning.mockRestore(); await hub.close(); }
}, 40_000);


test('zero quota defers generated metadata while live artifact checks remain available', async () => {
  const temp = tempRoot(); const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project'); const artifacts = path.join(project, '.anjian/artifacts');
  writeHtml(artifacts, 'page', { 'index.html': '<html><body>Page</body></html>' });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') }); registerProject(paths.projects, project);
  const settings = createStorageSettings(paths.home); settings.setSharedLimit(0);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1', ports: [0], boardPorts: [0], token: 'a'.repeat(48), version: 'test', viewerDir: temp.viewer, runtimeDir: temp.runtime });
  try {
    const origin = `http://127.0.0.1:${hub.port}`;
    const check = () => fetch(origin + '/api/agent/html/page/check', { method: 'POST' });
    const checked = await check(); expect(checked.status).toBe(200);
    expect(await checked.json()).toMatchObject({ warnings: [], ran: false });
    await waitFor(() => warning.mock.calls.some(([message]) => String(message).includes('Background artifact state')));
    const file = path.join(artifacts, '.state/html/page/warnings.json');
    expect(fs.existsSync(file)).toBe(false);
    expect((await fetch(origin + '/api/artifacts/html/page')).status).toBe(200);
    settings.setSharedLimit(1024 * 1024);
    expect((await check()).status).toBe(200);
    await waitFor(() => fs.existsSync(file));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ warnings: [], ran: false });
  } finally { warning.mockRestore(); await hub.close(); }
});


test('WebSocket selection writes respect quota and remove obsolete Agent context', async () => {
  const temp = tempRoot(); const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project'); const artifacts = path.join(project, '.anjian/artifacts');
  writeDocument(artifacts, 'doc', { 'doc.xml': '<doc><p id="b">Selected content</p></doc>' });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') }); registerProject(paths.projects, project);
  const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1', ports: [0], boardPorts: [0], token: 'a'.repeat(48), version: 'test', viewerDir: temp.viewer, runtimeDir: temp.runtime });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ws = await openWs(hub.port, { Origin: `http://127.0.0.1:${hub.port}` }, '/ws?at=/document/doc');
  try {
    const send = (quote: string) => sendWsText(ws.socket!, JSON.stringify({ type: 'selection', artifact: 'document/doc', tab: 'tab', human: true, quote, blockIds: ['b'], heading: '' }));
    const file = path.join(artifacts, '.state/document/doc/selection.json');
    send('old'); await waitFor(() => fs.existsSync(file));
    const settings = createStorageSettings(paths.home); settings.setSharedLimit(0);
    send('new selection requiring more space');
    await waitFor(() => !fs.existsSync(file));
    settings.setSharedLimit(1024 * 1024);
    send('latest selection'); await waitFor(() => fs.existsSync(file));
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).quote).toBe('latest selection');
    ws.socket?.destroy(); await waitFor(() => !fs.existsSync(file));
  } finally { ws.socket?.destroy(); warning.mockRestore(); await hub.close(); }
});

test('recording quota recovery resumes media validation without editing the original', async () => {
  const temp = tempRoot(); const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project'); const artifacts = path.join(project, '.anjian/artifacts');
  writeArtboard(artifacts, 'recording', { version: 1, pages: [{ id: 'p', name: 'P' }],
    boards: { clip: { type: 'video', src: 'pages/clip.webm', page: 'p', x: 0, y: 0, w: 100, h: 100 } },
    groups: { g: { boards: ['clip'], verify: true } } }, { 'pages/clip.webm': 'original recording bytes' });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') }); registerProject(paths.projects, project);
  createStorageSettings(paths.home).setSharedLimit(0);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1', ports: [0], boardPorts: [0], token: 'a'.repeat(48), version: 'test', viewerDir: temp.viewer, runtimeDir: temp.runtime });
  try {
    const origin = `http://127.0.0.1:${hub.port}`;
    await vi.waitFor(async () => {
      const response = await fetch(origin + '/api/artifacts/artboard/recording');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.recordings.clip.status).toBe('original');
      expect(data.recordings.clip.warning).toContain('共享存储容量不足');
      expect(data.canvas.boards.clip.file).toBe('pages/clip.webm');
    }, { timeout: 3000 });
    expect(fs.existsSync(path.join(artifacts, '.state/recordings'))).toBe(false);
    const restoredAt = Date.now();
    createStorageSettings(paths.home).setSharedLimit(1024 * 1024);
    await vi.waitFor(async () => {
      const data = await (await fetch(origin + '/api/artifacts/artboard/recording')).json();
      expect(data.recordings.clip.status).toBe('original');
      // This fixture is intentionally not media: reaching ffprobe proves the
      // quota retry entered preparation without replacing or editing the source.
      expect(data.recordings.clip.warning).toContain('ffprobe');
    }, { timeout: 35_000, interval: 100 });
    expect(Date.now() - restoredAt).toBeGreaterThan(20_000);
    expect(fs.readFileSync(path.join(artifacts, 'artboard/recording/pages/clip.webm'), 'utf8')).toBe('original recording bytes');
  } finally { warning.mockRestore(); await hub.close(); }
}, 40_000);

test('document autosave defers normalization at zero quota and recovers without another edit', async () => {
  const temp = tempRoot(); const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project'); const artifacts = path.join(project, '.anjian/artifacts');
  const original = '<doc><p>readable while storage is full</p></doc>';
  writeDocument(artifacts, 'draft', { 'doc.xml': original });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') });
  registerProject(paths.projects, project);
  const settings = createStorageSettings(paths.home);
  settings.setSharedLimit(0);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1',
    ports: [0], boardPorts: [0], token: 'a'.repeat(48), version: 'test',
    viewerDir: temp.viewer, runtimeDir: temp.runtime });
  try {
    const origin = `http://127.0.0.1:${hub.port}`;
    const response = await fetch(origin + '/api/document/draft/state');
    expect(response.status).toBe(200);
    expect((await response.json()).snapshot).toBeTruthy();
    await new Promise(resolve => setTimeout(resolve, 700));
    const source = path.join(artifacts, 'document/draft/doc.xml');
    const snapshot = path.join(artifacts, '.state/document/draft/doc.loro');
    expect(fs.readFileSync(source, 'utf8')).toBe(original);
    expect(fs.existsSync(snapshot)).toBe(false);
    settings.setSharedLimit(1024 * 1024);
    await vi.waitFor(() => expect(fs.existsSync(snapshot)).toBe(true), { timeout: 8000, interval: 100 });
    expect(fs.readFileSync(source, 'utf8')).toContain('readable while storage is full');
    expect(fs.readFileSync(source, 'utf8')).toContain('id="');
  } finally {
    settings.setSharedLimit(1024 * 1024);
    warning.mockRestore();
    await hub.close();
  }
}, 12_000);

test('document comments remain readable at zero quota and normalize after capacity recovery', async () => {
  const temp = tempRoot(); const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project'); const artifacts = path.join(project, '.anjian/artifacts');
  const original = JSON.stringify({ threads: [{ anchor: { blockId: 'p', quote: '' },
    messages: [{ author: 'agent', text: 'Keep this comment readable' }] }] });
  writeDocument(artifacts, 'draft', { 'doc.xml': '<doc><p id="p">Text</p></doc>', 'comments.json': original });
  const file = path.join(artifacts, 'document/draft/comments.json');
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') });
  registerProject(paths.projects, project);
  const settings = createStorageSettings(paths.home); settings.setSharedLimit(0);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1',
    ports: [0], boardPorts: [0], token: 'a'.repeat(48), version: 'test',
    viewerDir: temp.viewer, runtimeDir: temp.runtime });
  try {
    const response = await fetch(`http://127.0.0.1:${hub.port}/api/document/draft/state`);
    expect(response.status).toBe(200);
    const { comments } = await response.json();
    expect(comments.threads[0].messages[0]).toMatchObject({ text: 'Keep this comment readable', id: expect.any(String) });
    await vi.waitFor(() => expect(warning).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    settings.setSharedLimit(1024 * 1024);
    // No subsequent GET or file edit: the existing background task must retry.
    await vi.waitFor(() => expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(comments),
      { timeout: 35_000, interval: 100 });
  } finally {
    settings.setSharedLimit(1024 * 1024);
    await hub.close();
    warning.mockRestore();
  }
}, 40_000);
