import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const packageJsonPath = resolve(repoRoot, 'package.json');
const extensionPath = resolve(repoRoot, '.pi/extensions/anjian.ts');
const piToolsPath = resolve(repoRoot, 'skills/using-anjian/references/pi-tools.md');

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, 'utf8'));
}

async function loadExtension(onMessage = () => {}) {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const pi = {
    registerCommand(name, command) {
      commands.set(name, command);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    sendMessage: onMessage,
    appendEntry() {},
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
  };
  const mod = await import(
    pathToFileURL(extensionPath).href + `?cachebust=${Date.now()}-${Math.random()}`
  );
  mod.default(pi);
  return { handlers, commands, tools };
}

function firstHandler(handlers, event) {
  const eventHandlers = handlers.get(event) ?? [];
  assert.equal(eventHandlers.length, 1, `expected one ${event} handler`);
  return eventHandlers[0];
}

function textOf(message) {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

test('package.json declares a pi package with skills and extension resources', async () => {
  const pkg = await readPackageJson();

  assert.equal(pkg.name, 'anjian-workflow');
  assert.ok(pkg.keywords.includes('pi-package'));
  assert.deepEqual(pkg.pi.skills, ['./skills']);
  assert.deepEqual(pkg.pi.extensions, ['./.pi/extensions/anjian.ts']);
});

test('extension leaves package skill discovery to Pi and registers lifecycle hooks', async () => {
  const { handlers, commands, tools } = await loadExtension();
  assert.ok(commands.has('anjian-open'));
  assert.ok(tools.has('anjian_open'));

  assert.equal(
    (handlers.get('resources_discover') ?? []).length,
    0,
    'extension must not bypass package skill filters',
  );
  for (const event of [
    'session_start',
    'session_shutdown',
    'session_tree',
    'message_end',
    'session_compact',
    'context',
    'agent_end',
  ]) {
    assert.equal((handlers.get(event) ?? []).length, 1, `missing ${event} handler`);
  }
  assert.equal((handlers.get('session_before_compact') ?? []).length, 0);
});

test('startup context injects the bootstrap as one user message until agent_end', async () => {
  const { handlers } = await loadExtension();
  const sessionStart = firstHandler(handlers, 'session_start');
  const context = firstHandler(handlers, 'context');
  const agentEnd = firstHandler(handlers, 'agent_end');

  await sessionStart(
    { type: 'session_start', reason: 'startup' },
    {
      sessionManager: { getSessionId: () => 'fixture', getBranch: () => [] },
    },
  );
  await firstHandler(handlers, 'session_shutdown')();

  const originalMessages = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Let us make a react todo list' }],
      timestamp: 1,
    },
  ];
  const result = await context({ type: 'context', messages: originalMessages }, {});

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.match(textOf(result.messages[0]), /You have Anjian/);
  assert.match(textOf(result.messages[0]), /Pi tool mapping/);
  assert.equal(result.messages[1], originalMessages[0]);

  const repeatedProviderRequest = await context(
    { type: 'context', messages: originalMessages },
    {},
  );
  assert.equal(repeatedProviderRequest.messages.length, 2);
  assert.match(textOf(repeatedProviderRequest.messages[0]), /You have Anjian/);

  const alreadyInjected = await context({ type: 'context', messages: result.messages }, {});
  assert.equal(alreadyInjected, undefined, 'bootstrap should not duplicate when already present');

  await agentEnd({ type: 'agent_end', messages: [] }, {});
  const afterEnd = await context({ type: 'context', messages: originalMessages }, {});
  assert.equal(afterEnd, undefined, 'startup bootstrap should clear after agent_end');
});

test('session_compact injects bootstrap after compaction summaries, not before compaction', async () => {
  const { handlers } = await loadExtension();
  const sessionCompact = firstHandler(handlers, 'session_compact');
  const context = firstHandler(handlers, 'context');

  await sessionCompact({ type: 'session_compact', compactionEntry: {}, fromExtension: false }, {});

  const summary = {
    role: 'compactionSummary',
    summary: 'Prior work summary',
    tokensBefore: 123,
    timestamp: 1,
  };
  const user = { role: 'user', content: [{ type: 'text', text: 'Continue' }], timestamp: 2 };
  const result = await context({ type: 'context', messages: [summary, user] }, {});

  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0], summary);
  assert.equal(result.messages[1].role, 'user');
  assert.match(textOf(result.messages[1]), /You have Anjian/);
  assert.equal(result.messages[2], user);
});

test('pi tools reference documents pi-specific mappings', async () => {
  assert.equal(existsSync(piToolsPath), true, 'pi-tools.md should exist');
  const text = await readFile(piToolsPath, 'utf8');

  // Assert against the mapping-table rows only. The surrounding prose mentions
  // these same tokens, so matching the whole file would still pass if the table
  // were deleted — the exact regression this test exists to catch.
  const rows = text.split('\n').filter((line) => line.startsWith('|'));
  assert.ok(
    rows.some((row) => /subagent/i.test(row)),
    'mapping table documents subagent dispatch',
  );
  assert.ok(
    rows.some((row) => /todo|task/i.test(row)),
    'mapping table documents task tracking',
  );
});

test('removes a branch subscription and acknowledges only its own persisted notice', async (t) => {
  const project = await mkdtemp(resolve(tmpdir(), 'anjian-pi-branch-'));
  t.after(() => rm(project, { force: true, recursive: true }));
  let branch = [
    {
      type: 'custom',
      customType: 'anjian-opened-artifact',
      data: { project, artifact: 'document/plan' },
    },
  ];
  const ctx = {
    sessionManager: { getSessionId: () => 'branch-session', getBranch: () => branch },
    isIdle: () => true,
    model: {},
  };
  const messages = [];
  const { handlers } = await loadExtension((message) =>
    messages.push({ role: 'custom', ...message }),
  );
  t.after(() => firstHandler(handlers, 'session_shutdown')());
  await firstHandler(handlers, 'session_start')({}, ctx);
  const heartbeat = resolve(
    project,
    '.anjian/artifacts/.state/pi-comment-watch/opened/document/plan/branch-session.alive',
  );
  assert.ok(existsSync(heartbeat));
  branch = [];
  await firstHandler(handlers, 'session_tree')({}, ctx);
  assert.equal(existsSync(heartbeat), false);
  const artifact = resolve(project, '.anjian/artifacts/document/plan');
  await mkdir(artifact, { recursive: true });
  async function feedback(id) {
    await writeFile(
      resolve(artifact, 'comments.json'),
      JSON.stringify({
        threads: [
          {
            id: 'thread',
            status: 'open',
            messages: [{ id, author: 'human', at: '2026-11-22T00:00:00Z' }],
          },
        ],
      }),
    );
  }
  await feedback('first');
  branch = [
    {
      type: 'custom',
      customType: 'anjian-opened-artifact',
      data: { project, artifact: 'document/plan' },
    },
  ];
  await firstHandler(handlers, 'session_tree')({}, ctx);
  assert.ok(existsSync(heartbeat));
  const waitFor = async (length) => {
    for (let i = 0; i < 60 && messages.length < length; i++) await delay(30);
    assert.equal(messages.length, length);
  };
  await waitFor(1);
  const ack = firstHandler(handlers, 'message_end');
  await ack({ message: { ...messages[0], details: { id: 'unrelated' } } });
  await feedback('second');
  await delay(1100);
  assert.equal(messages.length, 1);
  await ack({ message: messages[0] });
  await waitFor(2);
  await ack({ message: messages[1] });
});

test('Pi receipts leave inherited host subscriptions alone while ordinary explicit receipts still register', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'anjian-pi-launcher-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  for (const file of ['anjian.cjs', 'comment-subscriptions.cjs'])
    await copyFile(resolve(repoRoot, 'skills/artifacts/app', file), resolve(root, file));
  await writeFile(resolve(root, 'cli.cjs'), '');
  const codex = '12345678-1111-4444-a111-abcdefabcdef';
  const subscribed = resolve(root, '.anjian/artifacts/.state/codex-comment-watch', `${codex}.json`);
  const env = { ...process.env, ANJIAN_ARTIFACTS_OWNER: '2', CODEX_THREAD_ID: codex };
  delete env.CLAUDE_CODE_SESSION_ID;
  const read = (session) =>
    spawnSync(
      process.execPath,
      [
        resolve(root, 'anjian.cjs'),
        'comment',
        'list',
        '--session',
        session,
        '--artifact',
        'document/plan',
        '--project-dir',
        root,
      ],
      { cwd: root, env, encoding: 'utf8' },
    );
  assert.equal(read('pi:fixture').status, 0);
  assert.equal(existsSync(subscribed), false);
  assert.equal(read('custom-reader').status, 0);
  assert.deepEqual(JSON.parse(await readFile(subscribed, 'utf8')).artifacts, ['document/plan']);
});
