import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';

import { waitFor, writeDocument } from './helpers';

const launcher = path.resolve(__dirname, '../../skills/artifacts/app/anjian.cjs');
const exec = promisify(execFile);

test('custom host routes the configured project, retries failure and keeps receipts separate', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-host-')));
  const project = path.join(root, 'project');
  const sibling = path.join(root, 'sibling');
  const env = {
    ...process.env,
    ANJIAN_SERVER_HOME: path.join(root, 'hub'),
    ANJIAN_RUNTIME_DIR: path.join(root, 'runtime'),
    ANJIAN_ARTIFACTS_PORTS: '0',
    ANJIAN_ARTIFACTS_BOARD_PORTS: '0',
    CODEX_THREAD_ID: 'c54b3da8-3866-4451-8f6d-8dddbcdd1299',
  };
  const run = async (dir: string, ...args: string[]) =>
    JSON.parse(
      (await exec(process.execPath, [launcher, ...args, '--project-dir', dir, '--json'], { env }))
        .stdout,
    );
  for (const dir of [project, sibling])
    for (const id of ['keep', 'drop'])
      writeDocument(path.join(dir, '.anjian', 'artifacts'), id, {
        'doc.xml': '<doc><p id="intro">Draft for review</p></doc>',
      });
  const adapter = path.join(root, 'adapter.cjs');
  fs.writeFileSync(
    adapter,
    `
    const fs = require('node:fs');
    const event = JSON.parse(fs.readFileSync(0, 'utf8'));
    const attempts = process.argv[2];
    const fail = !fs.existsSync(attempts);
    fs.appendFileSync(attempts, JSON.stringify({ event, selected: process.env.ANJIAN_FEEDBACK_SESSION }) + '\\n');
    if (fail) process.exitCode = 4;
  `,
  );
  const attempts = path.join(root, 'attempts.ndjson');
  const config = path.join(root, 'host.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      host: 'custom',
      name: 'Review Desk',
      session: 'terminal:session-1',
      command: [process.execPath, adapter, attempts],
      artifacts: ['document/keep', 'document/drop'],
    }),
  );
  const child = spawn(
    process.execPath,
    [launcher, 'feedback-host', '--project-dir', project, '--config', config, '--json'],
    { env },
  );
  const exited = once(child, 'exit');
  const messages: Record<string, unknown>[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => messages.push(JSON.parse(line)));
  const rows = () =>
    fs.existsSync(attempts)
      ? fs
          .readFileSync(attempts, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  const post = async (dir: string, id: string) => {
    const startup = await run(
      dir,
      'start',
      '--artifact',
      `document/${id}`,
      '--no-open',
      '--background',
    );
    const page = new URL(startup.link);
    page.hostname = '127.0.0.1';
    const preview = await fetch(page);
    expect(preview.status).toBe(200);
    await preview.arrayBuffer();
    const endpoint = new URL(page);
    endpoint.pathname = `/api/document/${id}/comments`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Origin': page.origin, 'Referer': page.href, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'create',
        blockId: 'intro',
        quote: 'Draft',
        text: 'Please review the draft',
      }),
    });
    expect(response.status, await response.text()).toBe(200);
  };
  try {
    await waitFor(() => messages.some((message) => message.type === 'feedback-host-ready'));
    child.stdin.write('{"action":"unsubscribe","artifact":"document/drop"}\n');
    await waitFor(() => messages.some((message) => message.type === 'feedback-subscription'));
    await post(sibling, 'keep');
    await post(project, 'drop');
    await post(project, 'keep');
    await waitFor(
      () => messages.some((message) => message.type === 'feedback-delivery-error'),
      5000,
    );
    await waitFor(() => rows().length === 2, 9000);
    for (const row of rows())
      expect(row).toEqual({
        event: {
          type: 'anjian-comments',
          host: 'custom',
          name: 'Review Desk',
          session: 'custom:terminal:session-1',
          artifact: 'document/keep',
          projectDir: project,
        },
        selected: 'custom:terminal:session-1',
      });
    const session = 'custom:terminal:session-1';
    const read = ['comment', 'list', '--artifact', 'document/keep', '--session', session];
    expect((await run(project, ...read, '--peek')).threads).toHaveLength(1);
    expect((await run(project, ...read)).threads).toHaveLength(1);
    expect((await run(project, ...read, '--peek')).threads).toHaveLength(0);
    expect(
      (
        await run(
          project,
          'comment',
          'list',
          '--artifact',
          'document/keep',
          '--session',
          'custom:different',
          '--peek',
        )
      ).threads,
    ).toHaveLength(1);
    expect(rows()).toHaveLength(2);
    await run(project, 'stop');
    await post(project, 'drop');
    await post(project, 'keep');
    await waitFor(() => rows().length === 3, 8000);
    expect(rows().map(({ event }) => event.artifact)).toEqual(Array.from({length: 3}).fill('document/keep'));
    child.stdin.end();
    expect((await exited)[0]).toBe(0);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    await run(project, 'stop');
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 25_000);
