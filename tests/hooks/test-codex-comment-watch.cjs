'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const repo = path.resolve(__dirname, '../..');
const adapter = path.join(repo, 'skills/artifacts/app/codex-comment-watch.cjs');
const id = '01a18caa-a157-7071-ac28-96aa9066af5f';
const inherited = '01a18ca7-51af-77f0-8c4d-0c4bd2e2fcaf';
const at = (n) => `2026-10-30T10:00:${String(n).padStart(2, '0')}.000Z`;

async function until(check, explanation, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(25);
  }
  assert.fail(explanation);
}

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-codex-watch-')));
  const project = path.join(root, "project with ' quote");
  const data = path.join(root, 'plugin-data');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(project);
  fs.mkdirSync(data);
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(project, '.git'));
  const log = path.join(root, 'queue.jsonl');
  const fail = path.join(root, 'fail');
  const fake = path.join(bin, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  // Substitute only the external CLI transport; the watcher, hooks and filesystem are real.
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');if(fs.existsSync(${JSON.stringify(fail)})){process.stderr.write('transport unavailable');process.exit(1);}if(fs.existsSync(${JSON.stringify(fail)}+'.slow')){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,4000);}console.log('Queued message test-receipt');\n`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PLUGIN_ROOT: repo,
    PLUGIN_DATA: data,
    ANJIAN_RUNTIME_DIR: path.join(root, 'runtime'),
    ANJIAN_SERVER_HOME: path.join(root, 'server'),
    CODEX_THREAD_ID: inherited,
    ANJIAN_CODEX_REMOTE: 'unix:///tmp/anjian-test.sock',
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };
  const input = {
    session_id: id,
    cwd: project,
    hook_event_name: 'SessionStart',
    source: 'startup',
  };
  const children = [];
  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  for (const name of fs.readdirSync(path.dirname(adapter)))
    if (/\.(?:cjs|json)$/.test(name))
      fs.copyFileSync(path.join(path.dirname(adapter), name), path.join(app, name));
  fs.writeFileSync(
    path.join(app, 'cli.cjs'),
    `
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (args.includes('--fail-start')) process.exit(1);
process.send?.({ type: 'artifact-opened', project: option('--project-dir'), artifact: option('--artifact') });
if (args.includes('--foreground')) setInterval(() => {}, 1000);
console.log(JSON.stringify({ type: 'server-started' }));
`,
  );
  const launcher = path.join(app, 'anjian.cjs');
  const open = (artifact, session = id, target = project, extra = [], overrides = {}) => {
    const result = spawnSync(
      process.execPath,
      [launcher, 'start', '--json', '--project-dir', target, '--artifact', artifact, ...extra],
      { env: { ...env, CODEX_THREAD_ID: session, ...overrides }, encoding: 'utf8' },
    );
    assert.equal(result.status, extra.includes('--fail-start') ? 1 : 0, result.stderr);
  };
  const read = () =>
    fs.existsSync(log)
      ? fs
          .readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  const write = (artifact, value, target = project) => {
    const file = path.join(target, '.anjian/artifacts', artifact, 'comments.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const comments = (n = 1) => ({
    version: 1,
    threads: [
      {
        id: 't1',
        status: 'open',
        statusBy: 'human',
        statusAt: at(1),
        anchor: { blockId: 'b1' },
        messages: [{ id: `m${n}`, author: 'human', at: at(n), text: 'Change it' }],
      },
    ],
  });
  const start = (overrides = {}, activate = true) => {
    if (activate)
      for (const artifact of ['document/plan', 'artboard/settings'])
        open(artifact, overrides.session_id ?? id);
    const child = spawn(process.execPath, [adapter, 'watch'], {
      cwd: project,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.on('data', () => {});
    child.stdout.on('data', () => {});
    child.stdin.end(JSON.stringify({ ...input, ...overrides }));
    children.push(child);
    return child;
  };
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const done = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await done;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    project,
    data,
    env,
    input,
    read,
    write,
    comments,
    start,
    fail,
    open,
    launcher,
    children,
  };
}

function hooks() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repo, '.codex-plugin/plugin.json'), 'utf8'),
  );
  if (typeof manifest.hooks !== 'string') return {};
  return JSON.parse(fs.readFileSync(path.resolve(repo, manifest.hooks), 'utf8')).hooks;
}

test('a new comment is queued to the hook session rather than an inherited parent thread', async (t) => {
  const f = fixture(t);
  f.start();
  f.write('document/plan', f.comments());
  await until(() => f.read().length > 0, 'comment never reached codex queue');
  const args = f.read()[0];
  assert.equal(args[0], 'queue');
  assert.equal(args[args.indexOf('--thread') + 1], id);
  assert.ok(args.includes('--resume'));
  assert.equal(args[args.indexOf('--remote') + 1], f.env.ANJIAN_CODEX_REMOTE);
  const message = args[args.indexOf('--message') + 1];
  assert.ok(message.includes('document/plan'));
  assert.ok(message.includes('comment list --json'));
  assert.ok(!message.includes('Change it'));
  assert.ok(
    !fs.existsSync(
      path.join(f.project, '.anjian/artifacts/.state/document/plan/comment-cursors.json'),
    ),
  );
  await delay(1200);
  assert.equal(f.read().length, 1);
});

test('two lifecycle invocations keep a single watcher for the same session', async (t) => {
  const f = fixture(t);
  f.start();
  f.start({ source: 'compact' });
  await delay(250);
  f.write('artboard/settings', f.comments());
  await until(() => f.read().length > 0, 'comment never reached the active watcher');
  await delay(1200);
  assert.equal(f.read().length, 1);
});

test('transport failure retries the pending comment without requiring another human edit', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.fail, 'offline');
  f.start();
  f.write('document/plan', f.comments());
  await until(() => f.read().length > 0, 'no first delivery attempt');
  fs.unlinkSync(f.fail);
  await until(() => f.read().length >= 2, 'failed comment was lost instead of retried');
  const delivered = f.read().length;
  await delay(1200);
  assert.equal(f.read().length, delivered);
});

test('comments wake only the session that opened that artifact through the launcher', async (t) => {
  const f = fixture(t);
  f.start({}, false);
  f.write('document/plan', f.comments());
  f.open('document/plan', inherited);
  await delay(1200);
  assert.equal(f.read().length, 0);
  f.open('document/plan');
  await until(() => f.read().length === 1, 'opening the artifact did not activate its watcher');
  f.write('artboard/unrelated', f.comments());
  await delay(1200);
  assert.equal(f.read().length, 1);
});

test('an explicit successful worktree open queues only its exact artifact to the active session', async (t) => {
  const f = fixture(t);
  const worktree = path.join(f.root, 'linked worktree');
  for (const args of [
    ['init', '-q'],
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-qm',
      'base',
    ],
    ['worktree', 'add', '-q', '--detach', worktree],
  ]) {
    const result = spawnSync('git', args, { cwd: f.project, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const bareStart = spawnSync(process.execPath, [f.launcher, 'start', '--project-dir', worktree], {
    env: { ...f.env, CODEX_THREAD_ID: id },
  });
  assert.equal(bareStart.status, 0);
  f.open('document/other-session', inherited, worktree);
  f.open('document/failed', id, worktree, ['--fail-start']);
  const rounds = (target, state) => {
    const file = path.join(target, '.anjian/artifacts/.state/artboard/settings/rounds.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ rounds: [{ id: 'r1', state }] }));
  };
  for (const target of [f.project, worktree]) {
    f.open('artboard/settings', id, target);
    f.write('artboard/settings', { version: 1, threads: [] }, target);
    rounds(target, 'open');
  }
  f.open('document/plan');
  f.write('document/other-session', f.comments(), worktree);
  f.write('document/failed', f.comments(), worktree);
  f.write('document/unrelated', f.comments(), worktree);
  const foreground = spawn(
    process.execPath,
    [f.launcher, 'start', '--project-dir', worktree, '--artifact', 'document/plan', '--foreground'],
    { env: { ...f.env, CODEX_THREAD_ID: id }, stdio: 'ignore' },
  );
  f.children.push(foreground);
  const worktreeBeat = path.join(
    worktree,
    '.anjian/artifacts/.state/codex-comment-watch/opened/document/plan',
    `${id}.alive`,
  );
  f.start({}, false);
  await until(
    () => fs.existsSync(worktreeBeat),
    'foreground start never subscribed before exiting',
  );
  assert.equal(foreground.exitCode, null);
  const broadBeat = path.join(
    worktree,
    '.anjian/artifacts/.state/codex-comment-watch',
    `${id}.alive`,
  );
  assert.equal(fs.existsSync(broadBeat), false, 'external wildcard must not appear active');
  f.write('document/plan', f.comments());
  f.write('document/plan', f.comments(), worktree);
  await until(() => f.read().length === 2, 'same-name artifacts were not delivered separately');
  await delay(1200);
  const comments = f.read();
  assert.equal(comments.length, 2);
  for (const target of [f.project, worktree]) rounds(target, 'submitted');
  await until(() => f.read().length === 4, 'same-name rounds were not delivered separately');
  const queued = f.read();
  for (const args of queued) assert.equal(args[args.indexOf('--thread') + 1], id);
  const messages = (commands) => commands.map((args) => args[args.indexOf('--message') + 1]);
  for (const batch of [comments, queued.slice(2)]) {
    assert.ok(messages(batch).some((message) => message.includes('linked worktree')));
    assert.ok(messages(batch).some((message) => message.includes('project with')));
  }
  assert.ok(messages(queued.slice(2)).every((message) => message.includes('round r1')));
});

test('hosts without PLUGIN_DATA keep worker ownership separate from launcher subscriptions', async (t) => {
  const f = fixture(t);
  delete f.env.PLUGIN_DATA;
  delete f.env.CLAUDE_PLUGIN_DATA;
  const child = f.start({}, false);
  await delay(250);
  f.open('document/plan');
  f.write('document/plan', f.comments());
  await until(() => f.read().length > 0, 'launcher registration stopped its own watcher');
  assert.equal(child.exitCode, null);
});

test('an unavailable external comment never blocks local delivery and can resume later', async (t) => {
  const f = fixture(t);
  const external = path.join(f.root, 'external');
  fs.mkdirSync(external);
  f.start({}, false);
  f.open('document/external', id, external);
  f.open('document/plan');
  fs.writeFileSync(f.fail, 'offline');
  f.write('document/external', f.comments(), external);
  await until(() => f.read().length === 1, 'no first external delivery attempt');
  fs.unlinkSync(path.join(external, '.anjian/artifacts/document/external/comments.json'));
  f.write('document/plan', f.comments());
  fs.unlinkSync(f.fail);
  await until(() => f.read().length === 2, 'unavailable external comment blocked local notice');
  const messageAt = (index) => {
    const args = f.read()[index];
    return args[args.indexOf('--message') + 1];
  };
  assert.match(messageAt(1), /--artifact document\/plan/);
  f.write('document/external', f.comments(), external);
  await until(() => f.read().length === 3, 'external comment did not resume');
  assert.match(messageAt(2), /--artifact document\/external/);
});

test('an explicit open with a different Hub home still reaches the session watcher', async (t) => {
  const f = fixture(t);
  f.env.ANJIAN_RUNTIME_DIR = path.relative(os.homedir(), f.env.ANJIAN_RUNTIME_DIR);
  f.start({}, false);
  f.open('document/plan', id, f.project, [], {
    ANJIAN_SERVER_HOME: path.join(f.root, 'other-hub'),
  });
  f.write('document/plan', f.comments());
  await until(() => f.read().length === 1, 'different Hub home hid the subscription');
});

test('nested hosts can run commands without subscribing a session', () => {
  const { register } = require(path.join(path.dirname(adapter), 'comment-subscriptions.cjs'));
  const env = { CODEX_THREAD_ID: id, CLAUDE_CODE_SESSION_ID: inherited };
  assert.doesNotThrow(() => register(['stop'], env));
  assert.doesNotThrow(() => register(['start'], env));
});

test('an ambiguous launcher does not wake the inherited Codex session', async (t) => {
  const f = fixture(t);
  f.start({}, false);
  f.open('document/plan', id, f.project, [], { CLAUDE_CODE_SESSION_ID: inherited });
  f.write('document/plan', f.comments());
  await delay(1400);
  assert.equal(f.read().length, 0);
  f.open('document/plan', id, f.project, [], {
    CLAUDE_CODE_SESSION_ID: inherited,
    ANJIAN_COMMENT_HOST: 'codex',
  });
  await until(() => f.read().length === 1, 'explicit host did not activate the watcher');
});

test('a comment resolved during an outage is not delivered when transport recovers', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.fail, 'offline');
  f.start();
  const comments = f.comments();
  f.write('document/plan', comments);
  await until(() => f.read().length > 0, 'no first delivery attempt');
  Object.assign(comments.threads[0], { status: 'resolved', statusBy: 'human', statusAt: at(2) });
  f.write('document/plan', comments);
  fs.unlinkSync(f.fail);
  await delay(2400);
  assert.equal(f.read().length, 1);
});

test('SessionEnd stops delivery and leaves other sessions alone', async (t) => {
  const f = fixture(t);
  const first = f.start();
  const other = f.start({ session_id: inherited });
  await delay(250);
  const end = spawnSync(process.execPath, [adapter, 'stop'], {
    env: f.env,
    input: JSON.stringify({ ...f.input, hook_event_name: 'SessionEnd' }),
    encoding: 'utf8',
  });
  assert.equal(end.status, 0);
  await until(
    () => first.exitCode !== null || first.signalCode !== null,
    'ended session kept watching',
  );
  assert.equal(other.exitCode, null);
  f.write('document/plan', f.comments());
  await until(() => f.read().length > 0, 'other session stopped too');
  assert.ok(f.read().every((args) => args[args.indexOf('--thread') + 1] === inherited));
});

test('an invalid session identifier does not fall back to an inherited thread', async (t) => {
  const f = fixture(t);
  const child = f.start({ session_id: '' });
  await until(() => child.exitCode !== null, 'invalid input left a watcher running');
  f.write('document/plan', f.comments());
  await delay(1100);
  assert.equal(f.read().length, 0);
});

test('the shipped lifecycle hooks invoke the portable watcher and stop it on session end', async (t) => {
  const f = fixture(t);
  const config = hooks();
  f.open('document/plan');
  const entry = config.SessionStart?.[0]?.hooks?.[0];
  assert.ok(entry, 'the Codex plugin has no startup hook');
  assert.equal(entry.async, true);
  const child = spawn(entry.command, {
    cwd: f.project,
    env: f.env,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});
  child.stdin.end(JSON.stringify(f.input));
  t.after(() => child.kill());
  f.write('document/plan', f.comments());
  await until(() => f.read().length > 0, 'the manifest command did not deliver comments');
  const end = config.SessionEnd?.[0]?.hooks?.[0];
  assert.ok(end, 'the Codex plugin has no cleanup hook');
  const result = spawnSync(end.command, {
    env: f.env,
    shell: true,
    input: JSON.stringify({ ...f.input, hook_event_name: 'SessionEnd' }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  await until(
    () => child.exitCode !== null,
    'the manifest cleanup command did not stop the watcher',
  );
});

test('each submitted round is queued even when two rounds change in the same poll', async (t) => {
  const f = fixture(t);
  const rounds = (state) => {
    const file = path.join(f.project, '.anjian/artifacts/.state/artboard/settings/rounds.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        rounds: [
          { id: 'r1', state },
          { id: 'r2', state },
        ],
      }),
    );
  };
  f.write('artboard/settings', { version: 1, threads: [] });
  rounds('open');
  f.start();
  const alive = path.join(f.project, '.anjian/artifacts/.state/codex-comment-watch', `${id}.alive`);
  await until(() => fs.existsSync(alive), 'codex watcher never wrote a heartbeat');
  rounds('submitted');
  await until(() => f.read().length === 2, 'both submitted rounds must reach codex queue');
  const messages = f.read().map((args) => args[args.indexOf('--message') + 1]);
  assert.match(messages[0], /round r1 on artboard\/settings were submitted/);
  assert.match(messages[1], /round r2 on artboard\/settings were submitted/);
});

test('the heartbeat keeps beating while a queue call is in flight', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(`${f.fail}.slow`, '');
  f.start();
  const alive = path.join(f.project, '.anjian/artifacts/.state/codex-comment-watch', `${id}.alive`);
  await until(() => fs.existsSync(alive), 'codex watcher never wrote a heartbeat');
  f.write('document/plan', f.comments());
  await until(() => f.read().length > 0, 'comment never reached codex queue');
  const during = Number(fs.readFileSync(alive, 'utf8'));
  await delay(2500);
  assert.ok(Number(fs.readFileSync(alive, 'utf8')) > during, 'heartbeat stopped while queueing');
});
