import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { feedbackSelection } from '../src/server/feedback/comments';
import { feedbackStore, hash } from '../src/server/feedback/store';
import {
  claim,
  claimAvailability,
  connect,
  fence,
  LEASE_MS,
  publicTask,
  requestRecovery,
  setEnabled,
  submit,
} from '../src/server/feedback/tasks';
import type { Thread } from '../src/shared/comments';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});
const project = 'a'.repeat(32);
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-tasks-'));
  homes.push(home);
  const store = feedbackStore(home, project);
  const data = store.load();
  const connection = connect(
    data,
    project,
    'device',
    {
      host: 'lody',
      session: 'session',
      displayName: 'Test',
      artifacts: ['document/demo'],
      requestId: 'connect-1',
    },
    1,
  );
  const threads: Thread<unknown>[] = [
    {
      id: 'thread',
      status: 'open',
      statusAt: 'now',
      anchor: { blockId: 'p' },
      messages: [{ id: 'm1', author: 'human', text: 'fix', at: 'now' }],
    },
  ];
  const task = submit(
    data,
    connection,
    'document/demo',
    'submit-1',
    feedbackSelection(threads),
    threads,
    'revision',
    2,
  );
  const input = {
    connectionId: connection.id,
    generation: connection.generation,
    claimant: 'session',
    requestId: 'claim-1',
    token: 'a'.repeat(64),
  };
  return { home, store, data, connection, task, threads, input };
}
test('persists explicit batches, rejects payload conflicts, and reloads after restart without consuming tasks', () => {
  const f = fixture();
  expect(
    submit(
      f.data,
      f.connection,
      f.task.artifact,
      'submit-1',
      feedbackSelection(f.threads),
      f.threads,
      'revision',
      3,
    ).id,
  ).toBe(f.task.id);
  expect(() =>
    submit(f.data, f.connection, f.task.artifact, 'submit-1', [], f.threads, 'revision', 3),
  ).toThrow('idempotency_conflict');
  f.store.save(f.data, () => {});
  expect(feedbackStore(f.home, project).load()).toEqual(f.data);
  expect(f.store.load()).toEqual(f.store.load());
  const old = feedbackSelection(f.threads);
  f.threads[0]!.messages[0]!.text = 'edited';
  expect(() =>
    submit(f.data, f.connection, f.task.artifact, 'submit-2', old, f.threads, 'revision', 3),
  ).toThrow('feedback_changed');
});
test('claim is idempotent, serializes one artifact, and expired work requires explicit fenced recovery', () => {
  const f = fixture();
  const first = {
    ...claim(f.data, f.task, 'device', f.input, 'revision', 10),
    token: f.input.token,
  };
  expect(claim(f.data, f.task, 'device', f.input, 'revision', 11)).toEqual(publicTask(f.task));
  expect(f.task.leaseUntil).toBe(10 + LEASE_MS);
  expect(() =>
    claim(f.data, f.task, 'device', { ...f.input, token: 'b'.repeat(64) }, 'revision', 11),
  ).toThrow('idempotency_conflict');
  const second = submit(
    f.data,
    f.connection,
    f.task.artifact,
    'submit-2',
    feedbackSelection(f.threads),
    f.threads,
    'revision',
    12,
  );
  expect(() =>
    claim(f.data, second, 'device', { ...f.input, requestId: 'claim-2' }, 'revision', 13),
  ).toThrow('artifact_busy');
  expect(() =>
    claim(
      f.data,
      f.task,
      'device',
      { ...f.input, requestId: 'claim-2' },
      'revision',
      LEASE_MS + 20,
    ),
  ).toThrow('task_not_claimable');
  setEnabled(f.data, f.connection, false, 15);
  expect(() =>
    claim(
      f.data,
      f.task,
      'device',
      { ...f.input, requestId: 'recover-paused', token: 'b'.repeat(64) },
      'revision',
      LEASE_MS + 20,
      true,
    ),
  ).toThrow('connection_unavailable');
  setEnabled(f.data, f.connection, true, 16);
  requestRecovery(f.task, LEASE_MS + 20);
  const next = {
    ...claim(
      f.data,
      f.task,
      'device',
      { ...f.input, recoveryRequestSeq: 1, requestId: 'recover-2', token: 'b'.repeat(64) },
      'revision',
      LEASE_MS + 20,
      true,
    ),
    token: 'b'.repeat(64),
  };
  expect(next.attempt).toBe(2);
  expect(() => fence(f.data, f.task, 'device', first, LEASE_MS + 21)).toThrow('stale_claim');
  expect(() => fence(f.data, f.task, 'other-device', next, LEASE_MS + 21)).toThrow(
    'connection_not_found',
  );
  fence(f.data, f.task, 'device', next, LEASE_MS + 21);
  expect(JSON.stringify(publicTask(f.task))).not.toContain(hash(next.token));
});
test('connection pause/resume preserves running claims; new feedback is a separate immutable batch', () => {
  const f = fixture();
  const first = {
    ...claim(f.data, f.task, 'device', f.input, 'revision', 10),
    token: f.input.token,
  };
  f.threads[0]!.messages.push({ id: 'm2', author: 'human', text: 'also', at: 'later' });
  const next = submit(
    f.data,
    f.connection,
    f.task.artifact,
    'submit-2',
    feedbackSelection(f.threads),
    f.threads,
    'revision',
    12,
  );
  expect(f.task.threads[0]!.messages).toHaveLength(1);
  expect(next.threads[0]!.messages).toHaveLength(2);
  setEnabled(f.data, f.connection, false, 20);
  setEnabled(f.data, f.connection, true, 21);
  fence(f.data, f.task, 'device', first, 22);
  expect(f.connection.generation).toBe(1);
  expect(f.task.state).toBe('running');
});
test('rejects corrupt and symlinked durable state and leaves prior data intact when quota denies a write', () => {
  const f = fixture();
  f.store.save(f.data, () => {});
  const file = path.join(f.home, 'feedback', `${project}.json`);
  const prior = fs.readFileSync(file, 'utf8');
  f.task.errorCode = 'new';
  expect(() =>
    f.store.save(f.data, () => {
      throw new Error('quota');
    }),
  ).toThrow('quota');
  expect(fs.readFileSync(file, 'utf8')).toBe(prior);
  fs.writeFileSync(file, '{');
  expect(() => f.store.load()).toThrow('feedback_store_corrupt');
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(f.home, 'target'), file);
  expect(() => f.store.load()).toThrow('unsafe_feedback_store');
});

test('queued retry is consumed by the first claim and cannot become a recovery authorization after failure', () => {
  const f = fixture();
  requestRecovery(f.task, 5);
  expect(claimAvailability(f.data, f.task, 5).claimable).toBe(true);
  claim(f.data, f.task, 'device', f.input, 'revision', 10);
  f.task.state = 'needs_attention';
  expect(f.task.recoveryConsumedSeq).toBe(1);
  expect(claimAvailability(f.data, f.task, 11)).toMatchObject({
    recoverable: false,
    blockedReason: 'recovery_not_requested',
  });
});
