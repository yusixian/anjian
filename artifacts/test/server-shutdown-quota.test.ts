import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { machinePaths, registerProject } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { tempRoot, writeDocument } from './helpers';

test('shutdown failure keeps the process and unsaved session alive until a signal retries it', async () => {
  const temp = tempRoot();
  const root = fs.realpathSync(temp.root);
  const project = path.join(root, 'project');
  const artifacts = path.join(project, '.anjian/artifacts');
  const original = '<doc><p>survive failed shutdown</p></doc>';
  writeDocument(artifacts, 'draft', { 'doc.xml': original });
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') });
  registerProject(paths.projects, project);
  const settings = createStorageSettings(paths.home);
  settings.setSharedLimit(0);
  const env: NodeJS.ProcessEnv = { ...process.env, ANJIAN_SERVER_HOME: paths.home, ARTIFACTS_HOST: '127.0.0.1',
    ARTIFACTS_URL_HOST: '127.0.0.1', ANJIAN_ARTIFACTS_PORTS: '0', ANJIAN_BOARD_PORTS: '0' };
  delete env.ANJIAN_PUBLIC_ORIGIN;
  delete env.ANJIAN_BOARD_ORIGIN;
  for (const key of Object.keys(env)) if (key.startsWith('ANJIAN_GITHUB_')) delete env[key];
  const child = spawn(process.execPath, [path.resolve('dist/server.cjs'), '--port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let stdout = ''; let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  try {
    await vi.waitFor(() => expect(stdout).toContain('"server-started"'), { timeout: 10_000 });
    const start = stdout.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).find(event => event?.type === 'server-started');
    const response = await fetch(`http://127.0.0.1:${start.port}/api/document/draft/state`);
    expect(response.status).toBe(200);
    await response.json();
    child.kill('SIGTERM');
    await vi.waitFor(() => expect(stderr).toContain('"server-stop-error"'), { timeout: 5000 });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    expect(stdout).not.toContain('"server-stopped"');
    expect(fs.existsSync(paths.stopped)).toBe(false);
    expect(fs.existsSync(paths.info)).toBe(true);
    const source = path.join(artifacts, 'document/draft/doc.xml');
    const snapshot = path.join(artifacts, '.state/document/draft/doc.loro');
    expect(fs.readFileSync(source, 'utf8')).toBe(original);
    expect(fs.existsSync(snapshot)).toBe(false);
    settings.setSharedLimit(1024 * 1024);
    child.kill('SIGTERM');
    await vi.waitFor(() => expect(child.exitCode).toBe(0), { timeout: 5000 });
    await exited;
    expect(stdout).toContain('"server-stopped"');
    expect(fs.existsSync(paths.stopped)).toBe(true);
    expect(fs.existsSync(paths.info)).toBe(false);
    expect(fs.statSync(snapshot).size).toBeGreaterThan(0);
    expect(fs.readFileSync(source, 'utf8')).toContain('survive failed shutdown');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
}, 20_000);
