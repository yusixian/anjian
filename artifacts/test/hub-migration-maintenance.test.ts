import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { createStorageMigration } from '../src/server/storage/migration';
import { tempRoot, writeHtml } from './helpers';

test('Hub prepares migration only after mounted project writers finish closing', async () => {
  const temp = tempRoot();
  const home = path.join(temp.root, 'home');
  const project = path.join(fs.realpathSync(temp.root), 'project');
  const artifacts = path.join(project, '.anjian/artifacts');
  writeHtml(artifacts, 'sample', { 'index.html': 'old' });
  const hub = await startHub({ host: '127.0.0.1', urlHost: 'localhost', ports: [0], boardPorts: [0],
    token: 'm'.repeat(48), version: 'test', viewerDir: temp.viewer, runtimeDir: temp.runtime,
    paths: machinePaths({ ANJIAN_SERVER_HOME: home }) });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  try {
    await hub.register(project);
    fs.mkdirSync(path.join(home, 'shares/snapshots'), { recursive: true });
    const settings = createStorageSettings(home);
    const profile = settings.save('shared', { endpoint: 'https://objects.example', bucket: 'private-bucket', region: 'auto', prefix: 'files', forcePathStyle: true }, { accessKeyId: 'test-id', secretAccessKey: 'test-secret' });
    settings.recordTest('shared', profile.id, { ok: true, checkedAt: Date.now(), steps: { write: true, read: true, delete: true } });
    const mounted = await hub.mountOf(project);
    const close = mounted.close;
    const closed = vi.fn(async () => {
      await waiting;
      await close();
      fs.writeFileSync(path.join(artifacts, 'html/sample/index.html'), 'the final persisted revision');
    });
    mounted.close = closed;
    const origin = `http://localhost:${hub.port}`;
    let responded = false;
    const preparing = fetch(`${origin}/api/storage/migrations?scope=shared`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', profileId: profile.id }) }).then(async (response) => { responded = true; expect(response.status).toBe(201); return response.json(); });
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
    expect(responded).toBe(false);
    release();
    const { job } = await preparing;
    expect(job.state).toBe('prepared');
    // The persisted job can still inspect the same source after the drain; the old bytes were not captured.
    const engine = createStorageMigration(home, { resolveProfile: settings.resolve });
    const summary = await engine.status('shared', job.id);
    expect(summary.bytes).toBeGreaterThanOrEqual(Buffer.byteLength('the final persisted revision'));
    const manifestPath = path.join(home, 'storage/migrations', Buffer.from('shared').toString('base64url'), `${job.id}.json`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.files.find((file: { relative: string }) => file.relative === 'html/sample/index.html').digest.bytes).toBe(Buffer.byteLength('the final persisted revision'));
  } finally { release(); await hub.close(); }
});
