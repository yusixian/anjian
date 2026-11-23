import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import type { VerificationSnapshot } from '../src/shared/verification-runs';
import { tempRoot, writeDocument } from './helpers';

test('a private local document runs only its registered checks and retains the results', async () => {
  const fixture = tempRoot();
  const root = fs.realpathSync(fixture.root);
  const home = path.join(root, 'server');
  const project = path.join(root, 'project');
  const document = 'A12345678901234567890';
  const original = '<doc>\n  <p id="intro">Evidence captured earlier</p>\n</doc>\n';
  const dir = writeDocument(path.join(project, '.anjian/artifacts'), 'report', {
    'doc.xml': original,
    '.artifact-id': document,
  });
  const other = path.join(root, 'other');
  writeDocument(path.join(other, '.anjian/artifacts'), 'report', {
    'doc.xml': original,
    '.artifact-id': 'B12345678901234567890',
  });
  const hub = await startHub({
    host: '127.0.0.1',
    urlHost: 'localhost',
    ports: [0],
    boardPorts: [0],
    paths: machinePaths({ ANJIAN_SERVER_HOME: home }),
    viewerDir: fixture.viewer,
    runtimeDir: fixture.runtime,
    token: 't'.repeat(48),
    version: 'test',
  });
  try {
    await hub.register(project);
    await hub.register(other);
    const origin = new URL(hub.url).origin;
    const endpoint = origin + '/api/document/' + document + '/verification';
    const snapshot = async (): Promise<VerificationSnapshot> => (await fetch(endpoint)).json();
    const run = (id: string, originHeader = origin) =>
      fetch(endpoint + '/' + id, { method: 'POST', headers: { Origin: originHeader } });
    const waitForRuns = async (count: number) => {
      await expect.poll(async () => (await snapshot()).runs.length).toBe(count);
      const current = await snapshot();
      expect(current.running).toBeNull();
      return current.runs[0]!;
    };

    expect((await fetch(endpoint)).status).toBe(404);
    fs.writeFileSync(
      path.join(home, 'verification-checks.json'),
      JSON.stringify({
        reports: [
          {
            project,
            document,
            checks: [
              {
                id: 'pass',
                title: 'Test suite',
                command: [
                  process.execPath,
                  '-e',
                  'setTimeout(() => console.log("fresh evidence"), 750)',
                ],
              },
              {
                id: 'fail',
                title: 'Lint',
                command: [process.execPath, '-e', 'console.error("lint failed"); process.exit(7)'],
              },
            ],
          },
        ],
      }),
    );
    expect((await snapshot()).checks).toEqual([
      { id: 'pass', title: 'Test suite' },
      { id: 'fail', title: 'Lint' },
    ]);
    expect((await fetch(origin + '/api/document/B12345678901234567890/verification')).status).toBe(
      404,
    );
    expect((await run('unknown')).status).toBe(404);
    expect((await run('pass', 'https://test.invalid')).status).toBe(403);
    expect((await run('pass')).status).toBe(202);
    expect((await run('pass')).status).toBe(409);
    const passed = await waitForRuns(1);
    expect(passed).toMatchObject({ check: 'pass', status: 'passed', exitCode: 0 });
    expect(passed).not.toHaveProperty('output');
    const details = await (await fetch(endpoint + '/runs/' + passed.id)).json();
    expect(details.output).toContain('fresh evidence');
    expect(details.sha256).toBe(createHash('sha256').update(details.output).digest('hex'));
    expect((await run('fail')).status).toBe(202);
    expect(await waitForRuns(2)).toMatchObject({ check: 'fail', status: 'failed', exitCode: 7 });
    expect(fs.readFileSync(path.join(dir, 'doc.xml'), 'utf8').trim()).toBe(original.trim());
  } finally {
    await hub.close();
    for (const item of Object.values(fixture)) fs.rmSync(item, { force: true, recursive: true });
  }
}, 15_000);
