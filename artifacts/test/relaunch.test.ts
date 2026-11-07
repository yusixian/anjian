import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { relaunchCommand, spawnAfterExit } from '../src/server/relaunch';
import { waitFor } from './helpers';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-relaunch-'));

test('relaunches through the launcher that started the server', () => {
  const launcher = '/Users/me/skills/artifacts/app/anjian-artifacts.cjs';
  expect(relaunchCommand({ ANJIAN_ARTIFACTS_LAUNCHER: `node "${launcher}"` }, temp())).toEqual([
    process.execPath,
    launcher,
  ]);
});

test('without a launcher it runs the CLI beside the server', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'cli.cjs'), '');
  expect(relaunchCommand({}, dir)).toEqual([process.execPath, path.join(dir, 'cli.cjs')]);
});

test('with neither there is nothing to relaunch with', () => {
  expect(relaunchCommand({}, temp())).toBeNull();
});

test('the relaunch waits until the old server has exited', async () => {
  const dir = temp();
  const marker = path.join(dir, 'ran');
  const old = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  spawnAfterExit(old.pid!, [
    process.execPath,
    '-e',
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(fs.existsSync(marker)).toBe(false);
  old.kill('SIGTERM');
  await waitFor(() => fs.existsSync(marker), 5000);
});
