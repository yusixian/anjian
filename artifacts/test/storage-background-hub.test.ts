import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { startHub } from '../src/server/hub';
import { machinePaths, registerProject } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { tempRoot, waitFor, writeArtboard, writeHtml } from './helpers';

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
