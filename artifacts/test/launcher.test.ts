import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

const temp: string[] = [];
afterEach(() => temp.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function copyLauncher() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-launcher-'));
  temp.push(dir);
  fs.copyFileSync(path.resolve(__dirname, '../../skills/artifacts/app/anjian.cjs'), path.join(dir, 'anjian.cjs'));
  const env = { ...process.env, CODEX_THREAD_ID: '', CLAUDE_CODE_SESSION_ID: '', PATH: '' };
  return { dir, run: () => spawnSync(process.execPath, [path.join(dir, 'anjian.cjs'), '--version'], { env, encoding: 'utf8' }) };
}

test('missing local build fails without needing npm or network', () => {
  const { run } = copyLauncher();
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Anjian has not been built');
  expect(result.stderr).toContain('No upstream package will be downloaded');
});

test('local launcher forwards arguments and uses an isolated Anjian identity', () => {
  const { dir, run } = copyLauncher();
  fs.writeFileSync(path.join(dir, 'cli.cjs'), `console.log(JSON.stringify({args: process.argv.slice(2), version: process.env.ANJIAN_ARTIFACTS_VERSION, command: process.env.ANJIAN_ARTIFACTS_COMMAND}));`);
  const result = run();
  expect(result.status).toBe(0);
  const out = JSON.parse(result.stdout);
  expect(out.args).toEqual(['--version']);
  expect(out.version).toMatch(/^local-[0-9a-f]{12}$/);
  expect(out.command).toContain('anjian.cjs');
});
