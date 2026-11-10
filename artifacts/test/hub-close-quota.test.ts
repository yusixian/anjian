import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { startHub } from '../src/server/hub';
import { machinePaths, registerProject } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { tempRoot, writeDocument } from './helpers';

test('Hub retains a quota-rejected closing mount and saves it on a later close retry', async () => {
  const temp = tempRoot();
  const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project');
  const artifacts = path.join(project, '.anjian/artifacts');
  const original = '<doc><p>retain this document</p></doc>';
  writeDocument(artifacts, 'draft', { 'doc.xml': original });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') });
  registerProject(paths.projects, project);
  const settings = createStorageSettings(paths.home);
  settings.setSharedLimit(0);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  let controls = 0;
  const hub = await startHub({ paths, host: '127.0.0.1', urlHost: '127.0.0.1',
    ports: [0], boardPorts: [0], token: 'a'.repeat(48), version: 'test',
    viewerDir: temp.viewer, runtimeDir: temp.runtime,
    control: { stop: () => { controls++; }, relaunch: () => { controls++; return true; } } });
  try {
    const response = await fetch(`http://127.0.0.1:${hub.port}/api/document/draft/state`);
    expect(response.status).toBe(200);
    expect((await response.json()).snapshot).toBeTruthy();
    const before = hub.mounted();
    expect(before).toHaveLength(1);
    for (const action of ['stop', 'restart']) {
      const origin = `http://127.0.0.1:${hub.port}`;
      const blocked = await fetch(origin + '/api/hub/' + action, { method: 'POST', headers: { Origin: origin } });
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toMatchObject({ code: 'document_save_blocked' });
    }
    expect(controls).toBe(0);
    const closing = hub.close();
    expect(hub.close()).toBe(closing);
    await expect(closing).rejects.toThrow('Hub did not close completely');
    expect(hub.mounted()).toEqual(before);
    const file = path.join(artifacts, 'document/draft/doc.xml');
    const snapshot = path.join(artifacts, '.state/document/draft/doc.loro');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.existsSync(snapshot)).toBe(false);
    const origin = `http://127.0.0.1:${hub.port}`;
    expect((await fetch(origin + '/api/document/draft/state')).status).toBe(200);
    const limit = await fetch(origin + '/api/storage?scope=shared', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'limit', bytes: 1024 * 1024 }),
    });
    expect(limit.status, await limit.clone().text()).toBe(200);
    await hub.close();
    expect(hub.mounted()).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toContain('retain this document');
    expect(fs.statSync(snapshot).size).toBeGreaterThan(0);
    await hub.close();
  } finally {
    settings.setSharedLimit(1024 * 1024);
    await hub.close();
    warning.mockRestore();
  }
});
