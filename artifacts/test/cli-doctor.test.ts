import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

const cli = path.resolve(__dirname, '../../skills/artifacts/app/cli.cjs');

test.skipIf(process.platform === 'win32')('doctor reads only Anjian hook states via stdio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-doctor-'));
  try {
    const codex = path.join(dir, 'codex');
    fs.writeFileSync(
      codex,
      `#!/usr/bin/env node
const assert = require('node:assert/strict');
const readline = require('node:readline');
assert.deepEqual(process.argv.slice(2), ['app-server', '--listen', 'stdio://']);
const send = (id, result) => console.log(JSON.stringify({ id, result }));
let initialized = false;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  switch (request.method) {
    case 'initialize':
      assert.equal(request.params.capabilities.experimentalApi, true);
      return send(request.id, {});
    case 'initialized':
      initialized = true;
      return;
    case 'hooks/list':
      assert.ok(initialized);
      assert.deepEqual(request.params.cwds, [process.cwd()]);
      return send(request.id, { data: [{ hooks: [
        { pluginId: 'anjian@local', eventName: 'sessionStart', enabled: true, trustStatus: 'trusted' },
        { pluginId: 'anjian@local', eventName: 'userPromptSubmit', enabled: true, trustStatus: 'modified', command: 'private hook argument' },
        { pluginId: 'another@local', eventName: 'sessionEnd', enabled: true, trustStatus: 'trusted' },
      ] }] });
    default:
      process.exit(1);
  }
});`,
      { mode: 0o700 },
    );
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'doctor',
        'codex',
        '--codex-bin',
        codex,
        '--project-dir',
        fs.realpathSync(dir),
        '--json',
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      type: 'codex-hook-doctor',
      status: 'attention',
      hooks: [
        { event: 'sessionStart', status: 'trusted' },
        { event: 'userPromptSubmit', status: 'modified' },
        { event: 'sessionEnd', status: 'missing' },
      ],
    });
    expect(result.stdout).not.toContain('private hook argument');
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});
