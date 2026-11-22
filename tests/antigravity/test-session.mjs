import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import antigravity from '../../skills/artifacts/app/antigravity-session.cjs';

const { delimiter, dirname, join } = path;

const fakeAgy = `#!${process.execPath}
const { appendFileSync, existsSync } = require('node:fs');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(args)) process.exit(2);
if (process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID) process.exit(3);

(async () => {
  for await (const line of createInterface({ input: process.stdin })) {
    const received = JSON.parse(line);
    if (received.event !== 'user' || typeof received.message?.content !== 'string') process.exit(2);
    const prompt = received.message.content;
    appendFileSync(process.env.AGY_TEST_LOG, JSON.stringify(prompt) + '\\n');
    if (prompt === 'hold this turn') {
      for (let i = 0; i < 500 && !existsSync(process.env.AGY_TEST_RELEASE); i++) await delay(10);
    }
    console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'completed turn' } }));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
`;

const isWindows = process.platform === 'win32';

async function until(assertion) {
  for (let i = 0; ; i++) {
    try {
      return await assertion();
    } catch (error) {
      if (i >= 300) throw error;
      await delay(10);
    }
  }
}

function capture(stream) {
  let text = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => (text += chunk));
  return () => text;
}

async function fixtures(t) {
  const dir = await mkdtemp(join(tmpdir(), 'anjian-antigravity-test-'));
  const project = join(dir, 'workspace');
  const app = join(project, '.anjian/artifacts');
  const binary = join(dir, 'agy');
  const sessions = [];
  t.after(async () => {
    for (const session of sessions) {
      await session.release();
      session.input.end();
    }
    try {
      await Promise.all(sessions.map((session) => session.done));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
  await mkdir(app, { recursive: true });
  await writeFile(binary, fakeAgy, { mode: 0o700 });

  async function writeJson(relative, value) {
    const file = join(app, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }

  function launch(name, artifacts) {
    const input = new PassThrough();
    const output = new PassThrough();
    const errors = new PassThrough();
    const logPath = join(dir, name + '.jsonl');
    const releasePath = join(dir, name + '.release');
    const stdout = capture(output);
    const stderr = capture(errors);
    const done = antigravity.runAntigravitySession({
      project,
      artifacts,
      input,
      output,
      errors,
      env: {
        ...process.env,
        AGY_TEST_LOG: logPath,
        AGY_TEST_RELEASE: releasePath,
        CLAUDE_CODE_SESSION_ID: 'inherited-claude-session',
        CODEX_SESSION_ID: 'inherited-codex-session',
        CODEX_THREAD_ID: 'inherited-codex-thread',
        PATH: [dir, process.env.PATH].join(delimiter),
      },
      pollMs: 10,
    });
    const session = {
      done,
      input,
      async prompts() {
        const contents = await readFile(logPath, 'utf8').catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return '';
        });
        return contents.trim().split('\n').filter(Boolean).map(JSON.parse);
      },
      release: () => writeFile(releasePath, ''),
      stderr,
      stdout,
    };
    sessions.push(session);
    return session;
  }

  return {
    async comment(artifact, text) {
      await writeJson(artifact + '/comments.json', {
        threads: [
          {
            id: 'review',
            status: 'open',
            messages: [{ id: 'note', author: 'human', at: '2026-11-22T00:00:00Z', text }],
          },
        ],
      });
    },
    async heartbeatFiles(artifact) {
      return readdir(join(app, '.state/agy-comment-watch/opened', artifact)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
      });
    },
    launch,
    async round(state, summary) {
      await mkdir(join(app, 'artboard/options'), { recursive: true });
      await writeJson('.state/artboard/options/rounds.json', {
        rounds: [{ id: 'page:p', state, groups: ['alternatives'], summary }],
      });
    },
  };
}

const receipt = /--session agy:([0-9a-f-]{36})\b/i;

test(
  'routes comments per Antigravity session and waits for the active turn',
  { skip: isWindows },
  async (t) => {
    const f = await fixtures(t);
    const first = f.launch('first', ['document/plan']);
    const second = f.launch('second', ['document/notes']);
    first.input.write('hold this turn\n');
    second.input.write('check the other document\n');
    await until(async () => {
      assert.deepEqual(await first.prompts(), ['hold this turn']);
      assert.match(second.stdout(), /completed turn/);
    });

    await f.comment('document/ignored', 'unrelated review');
    await f.comment('document/plan', 'private plan review');
    await f.comment('document/notes', 'private notes review');
    await until(async () => {
      assert.equal((await second.prompts()).length, 2);
    });
    assert.deepEqual(await first.prompts(), ['hold this turn']);
    await first.release();
    await until(async () => {
      assert.equal((await first.prompts()).length, 2);
    });

    const [, firstNotice] = await first.prompts();
    const [, secondNotice] = await second.prompts();
    assert.match(firstNotice, /document\/plan/);
    assert.match(secondNotice, /document\/notes/);
    assert.doesNotMatch(firstNotice, /document\/(notes|ignored)|private plan review/);
    assert.doesNotMatch(secondNotice, /document\/(plan|ignored)|private notes review/);
    assert.match(firstNotice, receipt);
    assert.match(secondNotice, receipt);
    const firstId = firstNotice.match(receipt)[1];
    const secondId = secondNotice.match(receipt)[1];
    assert.notEqual(firstId, secondId);
    assert.deepEqual(await f.heartbeatFiles('document/plan'), [firstId + '.alive']);
    assert.deepEqual(await f.heartbeatFiles('document/notes'), [secondId + '.alive']);

    first.input.end('first queued prompt\nsecond queued prompt\n');
    second.input.end();
    assert.equal(await first.done, 0, first.stderr());
    assert.equal(await second.done, 0, second.stderr());
    assert.deepEqual((await first.prompts()).slice(2), [
      'first queued prompt',
      'second queued prompt',
    ]);
    assert.deepEqual(await f.heartbeatFiles('document/plan'), []);
    assert.deepEqual(await f.heartbeatFiles('document/notes'), []);
  },
);

test(
  'delivers submitted and withdrawn artboard rounds to the open session',
  { skip: isWindows },
  async (t) => {
    const f = await fixtures(t);
    await f.round('open');
    const session = f.launch('choices', ['artboard/options']);
    const other = f.launch('other', ['document/notes']);
    session.input.write('open the choices\n');
    other.input.write('open the notes\n');
    await until(async () => {
      assert.equal((await f.heartbeatFiles('artboard/options')).length, 1);
      assert.match(session.stdout(), /completed turn/);
      assert.match(other.stdout(), /completed turn/);
    });
    const summary = {
      choices: [{ group: 'alternatives', answer: 'Pinned toolbar' }],
      threads: [{ id: 'review-toolbar', anchor: 'toolbar', text: 'Keep the undo button visible' }],
    };
    await f.round('submitted', summary);
    await until(async () => {
      assert.match((await session.prompts())[1] ?? '', /submitted/i);
    });
    await f.round('open', summary);
    await until(async () => {
      assert.match((await session.prompts())[2] ?? '', /withdrawn/i);
    });
    const [, submitted, withdrawn] = await session.prompts();
    for (const notice of [submitted, withdrawn]) {
      assert.match(notice, /artboard\/options/);
      assert.match(notice, /page:p/);
      assert.match(notice, receipt);
      assert.match(notice, /Run: .*comment list --json/);
    }
    assert.match(submitted, /Pinned toolbar/);
    assert.match(submitted, /review-toolbar/);
    assert.match(submitted, /Keep the undo button visible/);
    assert.doesNotMatch(withdrawn, /Pinned toolbar|review-toolbar|Keep the undo button visible/);
    assert.deepEqual(await other.prompts(), ['open the notes']);
    session.input.end();
    assert.equal(await session.done, 0, session.stderr());
  },
);
