import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { watchPiFeedback } from '../../.pi/artifact-feedback.ts';
import { listeningOn } from '../../artifacts/src/server/listening.ts';
import receiptEvents from '../../skills/artifacts/app/comment-receipt-events.cjs';

const { readerKey, threadEvents } = receiptEvents;
const document = 'document/brief';
const artboard = 'artboard/options';
const humanText = 'Private human comment with an access key';
const round = 'page:options';
const pollMs = 10;

function project(t) {
  const dir = mkdtempSync(join(tmpdir(), "anjian-pi-feedback's "));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}

function write(projectDir, relative, value) {
  const file = join(projectDir, '.anjian/artifacts', relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function comments(projectDir, artifact, text = humanText) {
  const thread = {
    id: 'thread',
    status: 'open',
    messages: [{ id: 'comment', author: 'human', text, at: '2026-01-01T00:00:00Z' }],
  };
  write(projectDir, join(artifact, 'comments.json'), { threads: [thread] });
  return thread;
}

function markRead(projectDir, artifact, session, thread) {
  const versions = Object.fromEntries(
    threadEvents(thread).map(({ key, version }) => [key, version]),
  );
  write(projectDir, join('.state', artifact, 'comment-receipts.json'), {
    [readerKey('local', `pi:${session}`)]: { read: { [thread.id]: versions } },
  });
}

function choices(projectDir, state, summary) {
  write(projectDir, join(artboard, 'comments.json'), { threads: [] });
  write(projectDir, join('.state', artboard, 'rounds.json'), {
    rounds: [{ id: round, state, summary }],
  });
}

async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await delay(pollMs);
  }
  assert.fail('Timed out waiting for Anjian feedback');
}

test('only wakes sessions with unread feedback on their subscribed artifact', async (t) => {
  const dir = project(t);
  const received = [];
  const session = randomUUID();
  const otherSession = randomUUID();
  const watcher = watchPiFeedback({
    session,
    pollMs,
    deliver: async (message) => received.push(message),
  });
  const other = watchPiFeedback({
    session: otherSession,
    pollMs,
    deliver: async (message) => received.push(message),
  });
  t.after(() => {
    watcher.close();
    other.close();
  });

  const thread = comments(dir, document);
  markRead(dir, document, otherSession, thread);
  comments(dir, artboard);
  watcher.subscribe(dir, document);
  watcher.subscribe(dir, document);
  other.subscribe(dir, document);

  await until(() => received.length > 0);
  await delay(pollMs * 3);
  assert.equal(received.length, 1);
  assert.match(received[0], /document\/brief/);
  assert.match(received[0], new RegExp('comment list --json .* --session pi:' + session + '$'));
  assert.ok(!received[0].includes('--peek'));
  assert.ok(!received[0].includes(humanText));
});

test('retries failed delivery and discards a failed event read before its retry', async (t) => {
  const dir = project(t);
  const session = randomUUID();
  const errors = [];
  const received = [];
  let attempts = 0;
  let updated;
  const watcher = watchPiFeedback({
    session,
    pollMs,
    onError: (error) => {
      errors.push(error);
      if (errors.length === 2) markRead(dir, document, session, updated);
    },
    deliver: async (message) => {
      attempts++;
      if (attempts === 1 || attempts === 3) throw new Error('Could not enqueue');
      received.push(message);
    },
  });
  t.after(() => watcher.close());
  watcher.subscribe(dir, document);
  comments(dir, document);
  await until(() => received.length === 1);
  assert.equal(attempts, 2);
  updated = comments(dir, document, 'Comment updated');
  await until(() => errors.length === 2);
  await delay(pollMs * 5);
  assert.equal(attempts, 3);
});

test('tracks submissions and withdrawals independently for each project', async (t) => {
  const dir = project(t);
  const otherDir = project(t);
  const messages = [];
  const unrelatedMessages = [];
  const session = randomUUID();
  const watcher = watchPiFeedback({
    session,
    pollMs,
    deliver: async (message) => messages.push(message),
  });
  t.after(() => watcher.close());
  const unrelated = watchPiFeedback({
    session: randomUUID(),
    pollMs,
    deliver: async (message) => unrelatedMessages.push(message),
  });
  t.after(() => unrelated.close());

  choices(dir, 'open');
  choices(otherDir, 'open');
  watcher.subscribe(dir, artboard);
  watcher.subscribe(otherDir, artboard);
  unrelated.subscribe(dir, document);
  const summary = {
    choices: [{ group: 'density', answer: 'Two columns' }],
    threads: [{ id: 'thread-a', anchor: 'compact', text: 'Keep the title visible' }],
  };
  choices(dir, 'submitted', summary);
  choices(otherDir, 'submitted');
  await until(() => messages.length === 2);
  choices(dir, 'open', summary);
  await until(() => messages.length === 3);
  choices(dir, 'submitted');
  await until(() => messages.length === 4);
  await delay(pollMs * 3);

  assert.equal(messages.length, 4);
  assert.ok(messages.every((message) => message.includes(round)));
  assert.match(messages[0], /was submitted/);
  assert.match(messages[1], /was submitted/);
  assert.match(messages[2], /was withdrawn/);
  assert.match(messages[3], /was submitted/);
  const matching = messages.filter((message) => message.includes('Two columns'));
  assert.equal(matching.length, 1, 'only the submission with a saved summary should include it');
  const [submitted] = matching;
  assert.match(submitted, /thread-a/);
  assert.match(submitted, /Keep the title visible/);
  for (const message of messages.filter((message) => message !== submitted)) {
    assert.doesNotMatch(message, /Two columns|thread-a|Keep the title visible/);
  }
  for (const message of messages) {
    assert.match(message, /Run: .*comment list --json/);
    assert.ok(message.includes(`--session pi:${session}`));
  }
  assert.deepEqual(unrelatedMessages, []);
});

test('closing stops delivery of remaining notices while one is in progress', async (t) => {
  const dir = project(t);
  const messages = [];
  const gate = Promise.withResolvers();
  const watcher = watchPiFeedback({
    session: randomUUID(),
    pollMs,
    deliver: async (message) => {
      messages.push(message);
      await gate.promise;
    },
  });
  t.after(() => watcher.close());
  comments(dir, document);
  comments(dir, artboard);
  watcher.subscribe(dir, document);
  watcher.subscribe(dir, artboard);
  await until(() => messages.length === 1);
  watcher.close();
  gate.resolve();
  await delay(pollMs * 3);
  assert.equal(messages.length, 1);
});

test('reports only explicitly opened artifacts as listening and clears presence at shutdown', (t) => {
  const first = project(t);
  const second = project(t);
  const state = (dir) => join(dir, '.anjian', 'artifacts', '.state');
  const watch = watchPiFeedback({ session: randomUUID(), deliver: async () => {}, pollMs });
  t.after(() => watch.close());
  watch.subscribe(first, document);
  watch.subscribe(second, artboard);
  assert.equal(listeningOn(state(first), document), true);
  assert.equal(listeningOn(state(second), artboard), true);
  assert.equal(listeningOn(state(first), artboard), false);
  watch.close();
  assert.equal(listeningOn(state(first), document), false);
  assert.equal(listeningOn(state(second), artboard), false);
});
