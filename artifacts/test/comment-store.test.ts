import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { asHumanOp, createCommentStore } from '../src/server/document-comments';

const names = (agent: string) => ({ human: () => ({ name: 'innei' }), agent: () => agent });

function savedFile() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-store-')), 'comments.json');
  const store = createCommentStore(file, names('Codex'));
  const { threads } = store.apply({ op: 'create', blockId: 'b1', quote: '', text: 'why?' });
  const thread = threads[0]!;
  const withReply = JSON.parse(fs.readFileSync(file, 'utf8'));
  withReply.threads[0].messages.push({ author: 'agent', text: 'because' });
  fs.writeFileSync(file, JSON.stringify(withReply));
  store.sync();
  store.apply({ op: 'reply', threadId: thread.id, text: 'gone soon' });
  const last = store.current().threads[0]!.messages.at(-1)!;
  store.apply({ op: 'delete', threadId: thread.id, messageId: last.id });
  return { file, before: store.current() };
}

test('a restarted server keeps every saved message as it was, names included', () => {
  const { file, before } = savedFile();
  const restarted = createCommentStore(file, names('Claude Code'));
  expect(restarted.current()).toEqual(before);
  expect(
    restarted.current().threads[0]!.messages.map((m) => [m.author, m.name, m.deleted ?? false]),
  ).toEqual([
    ['human', 'innei', false],
    ['agent', 'Codex', false],
    ['human', 'innei', true],
  ]);
});

test('an agent reply written while the server was down is still filled in', () => {
  const { file } = savedFile();
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.threads[0].messages.push({ author: 'agent', text: 'later' });
  fs.writeFileSync(file, JSON.stringify(raw));
  const message = createCommentStore(file, names('Claude Code'))
    .current()
    .threads[0]!.messages.at(-1)!;
  expect(message).toMatchObject({
    author: 'agent',
    name: 'Claude Code',
    text: 'later',
    id: expect.any(String),
  });
});

test('a comment on several blocks keeps its complete target after restarting', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-store-')), 'comments.json');
  const op = asHumanOp({
    op: 'create',
    blockId: 'b1',
    blockIds: ['b1', 'b3'],
    quote: '',
    text: 'Discuss these together',
  });
  expect(op).not.toBeNull();
  createCommentStore(file).apply(op!);
  const [thread] = createCommentStore(file).current().threads;
  expect(thread!.anchor).toEqual({ blockId: 'b1', blockIds: ['b1', 'b3'], quote: '' });
});

test('different multi-block targets do not merge when an agent writes id-less comments', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-store-')), 'comments.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      threads: [
        {
          anchor: { blockId: 'b1', blockIds: ['b1', 'b2'], quote: '' },
          messages: [{ text: 'Together' }],
        },
        {
          anchor: { blockId: 'b1', blockIds: ['b1', 'b3'], quote: '' },
          messages: [{ text: 'Together' }],
        },
      ],
    }),
  );
  const store = createCommentStore(file);
  expect(store.current().threads).toHaveLength(2);
  expect(createCommentStore(file).current().threads).toHaveLength(2);
});

test('cross-paragraph text anchors survive server validation and restarting', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-store-')), 'comments.json');
  const anchor = {
    blockId: 'b1',
    blockIds: ['b1', 'b2'],
    quote: 'rst\nUns',
    textRanges: [
      { blockId: 'b1', start: 2, quote: 'rst' },
      { blockId: 'b2', start: 0, quote: 'Uns' },
    ],
  };
  const op = asHumanOp({ op: 'create', ...anchor, text: 'Across paragraphs' });
  expect(op).not.toBeNull();
  createCommentStore(file).apply(op!);
  expect(createCommentStore(file).current().threads[0]!.anchor).toEqual(anchor);
});

test('comments on repeated text at different offsets are separate discussions', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-store-')), 'comments.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      threads: [0, 5].map((start) => ({
        anchor: {
          blockId: 'b1',
          blockIds: ['b1', 'b2'],
          quote: 'same\nend',
          textRanges: [
            { blockId: 'b1', quote: 'same', start },
            { blockId: 'b2', quote: 'end', start: 0 },
          ],
        },
        messages: [{ text: 'Discuss' }],
      })),
    }),
  );
  expect(createCommentStore(file).current().threads).toHaveLength(2);
});

test.each(
  [
    [
      { blockId: 'b1', start: -1, quote: 'rst' },
      { blockId: 'b2', start: 0, quote: 'Uns' },
    ],
    [
      { blockId: 'b1', start: 1.5, quote: 'rst' },
      { blockId: 'b2', start: 0, quote: 'Uns' },
    ],
    [
      { blockId: 'b1', start: 2, quote: 42 },
      { blockId: 'b2', start: 0, quote: 'Uns' },
    ],
    [{ blockId: 'b1', start: 2, quote: 'rst' }],
  ].map((textRanges) => ({ textRanges })),
)('rejects invalid text ranges rather than degrading to whole blocks: %j', ({ textRanges }) => {
  expect(
    asHumanOp({
      op: 'create',
      blockId: 'b1',
      blockIds: ['b1', 'b2'],
      quote: 'rst\nUns',
      textRanges,
      text: 'Comment',
    }),
  ).toBeNull();
});

test.each([[], ['other', 'b1'], ['b1', 'b1'], ['b1', 42], ['b1', '']])(
  'rejects a malformed multi-block target %j instead of silently commenting only the first block',
  (...blockIds) => {
    expect(
      asHumanOp({ op: 'create', blockId: 'b1', blockIds, quote: '', text: 'Comment' }),
    ).toBeNull();
  },
);

test('deferred normalization keeps readable stable IDs and retries only with admission', () => {
  const { file } = savedFile();
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.threads[0].messages.push({ author: 'agent', text: 'pending normalization' });
  const original = JSON.stringify(raw);
  fs.writeFileSync(file, original);
  const store = createCommentStore(file, names('Codex'), undefined, undefined, undefined, true);
  const view = structuredClone(store.current());
  expect(view.threads[0]!.messages.at(-1)).toMatchObject({
    text: 'pending normalization',
    id: expect.any(String),
  });
  expect(fs.readFileSync(file, 'utf8')).toBe(original);
  expect(store.sync()).toBe(false);
  expect(() =>
    store.sync(() => {
      throw new Error('quota');
    }),
  ).toThrow('quota');
  expect(store.current()).toEqual(view);
  expect(fs.readFileSync(file, 'utf8')).toBe(original);
  const deltas: number[] = [];
  expect(
    store.sync((delta) => {
      deltas.push(delta);
    }),
  ).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(view);
  expect(deltas).toEqual([fs.statSync(file).size - Buffer.byteLength(original)]);
  expect(
    store.sync(() => {
      throw new Error('already saved');
    }),
  ).toBe(false);
});

test('deferred normalization does not overwrite a later invalid external file', () => {
  const { file } = savedFile();
  fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))));
  const store = createCommentStore(file, names('Codex'), undefined, undefined, undefined, true);
  fs.writeFileSync(file, '{unfinished');
  expect(store.sync()).toBe(true);
  expect(store.warnings()).toHaveLength(1);
  expect(
    store.sync(() => {
      throw new Error('must not write');
    }),
  ).toBe(false);
  expect(fs.readFileSync(file, 'utf8')).toBe('{unfinished');
});

test('imports a backup from another contributor after an ordinary filesystem edit is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-comment-restore-'));
  try {
    const file = path.join(dir, 'comments.json');
    const store = createCommentStore(file, names('Codex'));
    const collaborator = createCommentStore(path.join(dir, 'collaborator.json'), {
      human: () => ({ name: 'Collaborator' }),
      agent: () => 'Agent',
    });
    const initial = store.apply({ op: 'create', blockId: 'b1', quote: '', text: 'Current note' });
    const backup = collaborator.apply({
      op: 'create',
      blockId: 'b2',
      quote: '',
      text: 'Restored note',
    });
    fs.unlinkSync(file);
    expect(store.sync()).toBe(false);
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, threads: [...initial.threads, ...backup.threads] }),
    );
    store.sync();
    expect(store.current().threads.flatMap((thread) => thread.messages)).toEqual(
      initial.threads[0]!.messages,
    );
    const text = JSON.stringify(backup);
    expect(store.restore(text).threads).toEqual([...initial.threads, ...backup.threads]);
    expect(store.restore(text).threads).toEqual([...initial.threads, ...backup.threads]);
    expect(createCommentStore(file).current()).toEqual(store.current());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retains unconfirmed workspace comments before normalization, even across a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-comment-recovery-'));
  try {
    const file = path.join(dir, 'comments.json');
    const recoveryFile = { file: path.join(dir, 'recovery.json'), root: dir };
    const open = () =>
      createCommentStore(file, names('Codex'), undefined, undefined, undefined, true, recoveryFile);
    const store = open();
    const initial = store.apply({ op: 'create', blockId: 'here', quote: '', text: 'In Hub' });
    const archive = createCommentStore(path.join(dir, 'backed-up.json'));
    const older = archive.apply({ op: 'create', blockId: 'there', quote: '', text: 'On a branch' });
    const raw = JSON.stringify({ version: 1, threads: [...initial.threads, ...older.threads] });
    fs.writeFileSync(file, raw);
    store.sync();
    expect(store.current()).toEqual(initial);
    expect(() =>
      store.sync(() => {
        throw new Error('quota');
      }),
    ).toThrow('quota');
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
    const beforeFlush = store.recovery();
    expect(beforeFlush?.backup).toEqual(older);
    expect(fs.existsSync(recoveryFile.file)).toBe(false);

    store.sync(() => undefined);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(initial);
    const reopened = open();
    expect(reopened.recovery()).toEqual(beforeFlush);
    const originalRevision = reopened.recovery()!.revision;

    const newer = archive.apply({
      op: 'create',
      blockId: 'another',
      quote: '',
      text: 'On another branch',
    });
    fs.writeFileSync(file, JSON.stringify(newer));
    expect(reopened.restoreRecovery(originalRevision, () => undefined)).toBe(false);
    expect(reopened.current()).toEqual(initial);
    expect(reopened.restoreRecovery(reopened.recovery()!.revision, () => undefined)).toBe(true);
    expect(open().current().threads).toEqual([...initial.threads, ...newer.threads]);
    expect(open().recovery()).toBeNull();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
