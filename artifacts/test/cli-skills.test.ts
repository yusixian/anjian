import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

const temps: string[] = [];
afterEach(() => temps.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const source = path.resolve(__dirname, '../../skills/artifacts');
const references = [
  'artboard.md',
  'artboard-prototype.md',
  'claude-artifacts.md',
  'document.md',
  'html.md',
  'icons.md',
  'remote.md',
  'ui.md',
  'examples/today-inbox.html',
];

function fixture(launcher = false) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-skills-')));
  temps.push(dir);
  const app = path.join(dir, 'app');
  const project = path.join(dir, 'project');
  fs.mkdirSync(app);
  fs.mkdirSync(project);
  fs.copyFileSync(path.resolve(__dirname, '../dist/cli.cjs'), path.join(app, 'cli.cjs'));
  if (launcher) {
    for (const name of [
      'anjian.cjs',
      'comment-subscriptions.cjs',
      'comment-watch.cjs',
      'comment-threads.cjs',
      'codex-comment-watch.cjs',
    ])
      fs.copyFileSync(path.join(source, 'app', name), path.join(app, name));
  }
  const entry = path.join(app, launcher ? 'anjian.cjs' : 'cli.cjs');
  const state = path.join(dir, 'state');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [entry, ...args], {
      cwd: project,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        PATH: '',
        HOME: dir,
        CODEX_THREAD_ID: '00000000-0000-4000-8000-000000000006',
        ANJIAN_CLIENT_HOME: path.join(state, 'client'),
        ANJIAN_SERVER_HOME: path.join(state, 'server'),
        ANJIAN_RUNTIME_DIR: path.join(state, 'runtime'),
        XDG_CONFIG_HOME: path.join(state, 'config'),
      },
    });
  return { run, project, state };
}

test.each([false, true])(
  'standalone CLI reads all embedded documents without source or side effects (launcher=%s)',
  (launcher) => {
    const { run, project, state } = fixture(launcher);
    const list = run('skills', 'list', '--json');
    expect(list.status, list.stderr).toBe(0);
    expect(JSON.parse(list.stdout).skills).toEqual([{ name: 'artifacts', references }]);
    expect(run('skills', 'list').stdout).toContain('artifacts');
    for (const reference of ['SKILL.md', ...references]) {
      const args = [
        'skills',
        'get',
        'artifacts',
        ...(reference === 'SKILL.md' ? [] : ['--reference', reference]),
      ];
      const markdown = run(...args);
      expect(markdown.status, markdown.stderr).toBe(0);
      const json = run(...args, '--json');
      expect(json.status, json.stderr).toBe(0);
      const value = JSON.parse(json.stdout);
      expect(value.reference).toBe(reference);
      expect(markdown.stdout).toBe(value.content + '\n');
      // Verify the complete source survives embedding, including the final byte.
      const original = fs.readFileSync(path.join(source, reference), 'utf8');
      expect(value.content).toContain(original.replaceAll('node app/anjian.cjs', value.command));
      expect(value.command).toContain(launcher ? 'anjian.cjs' : 'cli.cjs');
    }
    for (const args of [['--help'], ['skills', '--help'], ['remote', 'status', '--json']]) {
      const result = run(...args);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('skills get artifacts');
    }
    expect(fs.readdirSync(project)).toEqual([]);
    expect(fs.existsSync(state)).toBe(false);
  },
  30_000,
);

test('launcher help and rejected skills reads never register an artifact subscription', () => {
  const { run, project, state } = fixture(true);
  expect(run('start', '--help', '--artifact', 'document/demo').status).toBe(0);
  expect(run('skills', 'get', 'artifacts', '--artifact', 'document/demo').status).toBe(1);
  expect(fs.readdirSync(project)).toEqual([]);
  expect(fs.existsSync(state)).toBe(false);
});

test.each([
  '../remote.md',
  '/etc/passwd',
  'C:\\secret',
  'app/anjian.cjs',
  '__proto__',
  'toString',
  'remote.md/../SKILL.md',
  'missing.md',
])('rejects non-allowlisted reference %s', (reference) => {
  const { run } = fixture();
  const result = run('skills', 'get', 'artifacts', '--reference', reference, '--json');
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).error).toContain('reference');
});

test.each([
  ['get', 'unknown'],
  ['get'],
  ['list', 'artifacts'],
  ['list', '--reference', 'remote.md'],
  ['unknown'],
])('rejects invalid skills arguments %j', (...args) => {
  const { run } = fixture();
  const result = run('skills', ...args, '--json');
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).error).toBeTruthy();
});

test('unbound remote command keeps error exit code and adds an actionable guide', () => {
  const { run } = fixture();
  const result = run('pull', '--artifact', 'document/demo', '--json');
  expect(result.status).toBe(1);
  const value = JSON.parse(result.stdout);
  expect(value.error).toContain('not linked');
  expect(value.nextStep).toContain('skills get artifacts --reference remote.md');
});
