import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { createCommentReceipts } from '../src/server/comment-receipts';
import { applyHumanOp, emptyComments } from '../src/shared/comments';

const { unreadReceiptCount } = createRequire(import.meta.url)(
  '../../skills/artifacts/app/comment-threads.cjs',
) as { unreadReceiptCount: (file: unknown, book: unknown, session: string) => number };

const stamp = '2026-11-22T10:00:00.000Z';
const owner = { scope: 'Codex', session: 'one' };
let sequence = 0;
const id = () => `id-${++sequence}`;
const homes: string[] = [];

function stateDir() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-comment-receipts-'));
  homes.push(home);
  return home;
}
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function comments() {
  return applyHumanOp(
    emptyComments(),
    { op: 'create', blockId: 'alpha', quote: '', text: 'First message' },
    stamp,
    id,
  );
}

test('confirming a snapshot preserves another reply in the same millisecond', () => {
  const receipts = createCommentReceipts(stateDir(), 'document');
  const original = comments();
  const [first] = receipts.snapshot('demo', owner, original.threads).entries;
  const later = applyHumanOp(
    original,
    { op: 'reply', threadId: first!.thread.id, text: 'Another message' },
    stamp,
    id,
  );
  receipts.confirm('demo', owner, later.threads, first!.receipts);
  const [next] = receipts.snapshot('demo', owner, later.threads).entries;
  expect(next).toMatchObject({
    unread: true,
    thread: { changes: ['new-message'], messageIds: [later.threads[0]!.messages[1]!.id] },
  });
  receipts.confirm('demo', owner, later.threads, next!.receipts);
  receipts.confirm('demo', owner, later.threads, first!.receipts);
  expect(receipts.snapshot('demo', owner, later.threads).entries).toEqual([]);
});

test('an edited message stays unread when confirmation arrives out of order', () => {
  const receipts = createCommentReceipts(stateDir(), 'artboard');
  const original = comments();
  const [first] = receipts.snapshot('demo', owner, original.threads).entries;
  receipts.confirm('demo', owner, original.threads, first!.receipts);
  expect(receipts.forViewer('demo', original).threads[0]!.messages[0]!.agentRead).toBe(true);
  expect(original.threads[0]!.messages[0]!.agentRead).toBeUndefined();
  const [read] = receipts.snapshot('demo', owner, original.threads, true).entries;
  expect(read?.unread).toBe(false);

  const updated = applyHumanOp(
    original,
    {
      op: 'edit',
      threadId: first!.thread.id,
      messageId: first!.thread.messages[0]!.id,
      text: 'Edited',
    },
    stamp,
    id,
  );
  receipts.confirm('demo', owner, updated.threads, read!.receipts);
  expect(receipts.forViewer('demo', updated).threads[0]!.messages[0]!.agentRead).toBeUndefined();
  expect(receipts.snapshot('demo', owner, updated.threads).entries[0]).toMatchObject({
    unread: true,
    thread: { changes: ['edited'] },
  });
});

test('full reads do not consume events and receipts cannot cross sessions, devices, projects or artifacts', () => {
  const home = stateDir();
  const file = comments();
  const receipts = createCommentReceipts(home, 'document');
  const reader = { scope: 'device:alpha', session: 'one' };
  const full = receipts.snapshot('demo', reader, file.threads, true).entries;
  expect(receipts.snapshot('demo', reader, file.threads).entries).toEqual(full);
  expect(fs.readdirSync(home)).toEqual([]);

  const [first] = full;
  const otherSession = { ...reader, session: 'two' };
  const otherDevice = { ...reader, scope: 'device:beta' };
  const otherProject = createCommentReceipts(stateDir(), 'document');
  const otherType = createCommentReceipts(home, 'artboard');
  expect(receipts.confirm('demo', reader, file.threads, first!.receipts).confirmed).toBeGreaterThan(
    0,
  );
  expect(receipts.snapshot('demo', reader, file.threads).entries).toEqual([]);
  for (const [book, artifact, identity] of [
    [receipts, 'demo', otherSession],
    [receipts, 'demo', otherDevice],
    [receipts, 'other', reader],
    [otherProject, 'demo', reader],
    [otherType, 'demo', reader],
  ] as const) {
    expect(book.confirm(artifact, identity, file.threads, first!.receipts)).toEqual({
      confirmed: 0,
      modified: false,
    });
    expect(book.snapshot(artifact, identity, file.threads).entries[0]?.unread).toBe(true);
  }
});

test('local watchers share receipt semantics with the server and preserve other sessions', () => {
  const home = stateDir();
  const receipts = createCommentReceipts(home, 'document');
  const file = comments();
  const reader = { scope: 'local', session: 'codex:first' };
  const [snapshot] = receipts.snapshot('demo', reader, file.threads).entries;
  receipts.confirm('demo', reader, file.threads, snapshot!.receipts);
  const book = JSON.parse(
    fs.readFileSync(path.join(home, 'document/demo/comment-receipts.json'), 'utf8'),
  );
  expect(unreadReceiptCount(file, book, reader.session)).toBe(0);
  expect(unreadReceiptCount(file, book, 'codex:second')).toBe(1);
  const later = applyHumanOp(
    file,
    { op: 'reply', threadId: file.threads[0]!.id, text: 'Additional feedback' },
    stamp,
    id,
  );
  expect(unreadReceiptCount(later, book, reader.session)).toBe(1);
});

test('initializing an empty or quiet list preserves later closed threads as unread', () => {
  const receipts = createCommentReceipts(stateDir(), 'document');
  const existing = comments();
  const quiet = applyHumanOp(
    existing,
    { op: 'resolve', threadId: existing.threads[0]!.id },
    stamp,
    id,
  );
  const quietThread = quiet.threads[0]!;
  expect(quietThread.status).toBe('resolved');
  const first = receipts.snapshot('existing', owner, quiet.threads);
  expect(first.entries).toEqual([]);
  expect(first.baseline).not.toEqual([]);
  receipts.confirm('existing', owner, quiet.threads, first.baseline!, undefined, true);
  expect(receipts.forViewer('existing', quiet).threads[0]!.messages[0]!.agentRead).toBeUndefined();

  const empty = receipts.snapshot('empty', owner, []);
  receipts.confirm('empty', owner, [], empty.baseline!, undefined, true);
  const extra = comments();
  const closed = applyHumanOp(extra, { op: 'resolve', threadId: extra.threads[0]!.id }, stamp, id);
  expect(receipts.snapshot('empty', owner, closed.threads).entries).toHaveLength(1);
  expect(
    receipts.snapshot('existing', owner, [...quiet.threads, ...closed.threads]).entries,
  ).toMatchObject([{ thread: { id: closed.threads[0]!.id, changes: ['new-thread', 'resolved'] } }]);
});
