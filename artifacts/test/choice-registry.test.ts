import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { expect, test, vi } from 'vitest';

import { asBoardHumanOp, createBoardCommentRegistry } from '../src/server/board-comments';

const { createCommentWatch, formatRoundSummary } = createRequire(import.meta.url)(
  '../../skills/artifacts/app/comment-watch.cjs',
) as {
  createCommentWatch: (
    project: string,
    host: string,
    session: string,
  ) => (artifacts: Set<string>) => Record<string, unknown>[];
  formatRoundSummary: (event: Record<string, unknown>) => string;
};

const box = (x: number, y: number) => ({ page: 'p', x, y, w: 400, h: 300 });

function project(
  extraNotes: Record<string, unknown> = {},
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-choices-')),
) {
  const dir = path.join(root, 'artboard', 'pick');
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  const boards = {
    'q1-a': { file: 'pages/q1-a.html', ...box(0, 0) },
    'q1-b': { file: 'pages/q1-b.html', ...box(480, 0) },
    'q2-a': { file: 'pages/q2-a.html', ...box(0, 600) },
    'q2-b': { file: 'pages/q2-b.html', ...box(480, 600) },
    'plain': { file: 'pages/plain.html', ...box(0, 1200) },
  };
  fs.writeFileSync(
    path.join(dir, 'canvas.json'),
    JSON.stringify({
      version: 1,
      title: 'Pick',
      pages: [{ id: 'p', name: 'P' }],
      boards,
      groups: {
        q1: { title: 'One', boards: ['q1-a', 'q1-b'], choose: true, recommend: 'q1-b' },
        q2: { title: 'Two', boards: ['q2-a', 'q2-b'], choose: true },
        plain: { boards: ['plain'] },
      },
      notes: {
        r1: { page: 'p', kind: 'title', x: 0, y: -400, text: 'Round 1' },
        ...extraNotes,
      },
    }),
  );
  for (const board of Object.keys(boards))
    fs.writeFileSync(
      path.join(dir, 'pages', `${board}.html`),
      `<html><body>${board}</body></html>`,
    );
  const stateDir = path.join(root, '.state');
  const sent: unknown[] = [];
  const registry = createBoardCommentRegistry({
    root,
    stateDir,
    broadcast: (message) => sent.push(message),
  });
  return { dir, registry, stateDir, sent };
}

const human = (anchor: Record<string, unknown>, text = 'x') =>
  asBoardHumanOp({ op: 'create', anchor: { page: 'p', x: 0, y: 0, ...anchor }, text })!;

test('a human choice must name a board of a choice group', () => {
  const { registry } = project();
  expect(() => registry.apply('pick', human({ group: 'plain', choice: 'plain' }))).toThrow(
    /choice group/,
  );
  expect(() => registry.apply('pick', human({ group: 'q1', choice: 'q2-a' }))).toThrow(
    /not a board of q1/,
  );
  registry.apply('pick', human({ group: 'q1', choice: 'q1-a' }));
  expect(registry.groups('pick').find((g) => g.id === 'q1')).toMatchObject({
    kind: 'choose',
    round: 'r1',
    choice: 'q1-a',
    byRecommendation: false,
  });
});

test('an unpicked group reports its recommendation, or no choice without one', () => {
  const { registry } = project();
  const groups = registry.groups('pick');
  expect(groups.find((g) => g.id === 'q1')).toMatchObject({
    choice: 'q1-b',
    byRecommendation: true,
  });
  expect(groups.find((g) => g.id === 'q2')).toMatchObject({
    choice: null,
    byRecommendation: false,
  });
});

test('a submitted round refuses human choices but takes the agent recording terminal answers', () => {
  const { registry, stateDir } = project();
  registry.apply('pick', human({ round: 'r1', submit: true }));
  expect(() => registry.apply('pick', human({ group: 'q1', choice: 'q1-a' }))).toThrow(/submitted/);
  registry.agentChoose('pick', 'q1', 'q1-a', 'Claude');
  expect(registry.groups('pick').find((g) => g.id === 'q1')).toMatchObject({ choice: 'q1-a' });
  const file = JSON.parse(
    fs.readFileSync(path.join(stateDir, 'artboard', 'pick', 'rounds.json'), 'utf8'),
  );
  expect(file.rounds).toEqual([
    expect.objectContaining({
      id: 'r1',
      page: 'p',
      state: 'submitted',
      groups: ['q1', 'q2'],
      boards: ['q1-a', 'q1-b', 'q2-a', 'q2-b'],
    }),
  ]);
});

test('a closed round refuses both choices and submits', () => {
  const { registry } = project({
    r2: { page: 'p', kind: 'title', x: 0, y: 800, text: 'Round 2' },
  });
  expect(registry.rounds('pick')).toEqual([expect.objectContaining({ id: 'r1', state: 'closed' })]);
  expect(() => registry.apply('pick', human({ round: 'r1', submit: false }))).toThrow(/closed/);
  expect(() => registry.apply('pick', human({ group: 'q1', choice: 'q1-a' }))).toThrow(/closed/);
});

test('choice records stay out of comment lists, and comments in an open round are drafts', () => {
  const { registry } = project();
  registry.apply('pick', human({ group: 'q1', choice: 'q1-a' }));
  registry.apply('pick', human({ board: 'q1-a' }, 'title too long'));
  registry.apply('pick', human({ board: 'plain' }, 'unrelated'));
  const all = registry.list('pick', 'Claude', true);
  expect(all.map((t) => [t.messages[0]!.text, t.draft])).toEqual([
    ['title too long', true],
    ['unrelated', false],
  ]);
  registry.apply('pick', human({ round: 'r1', submit: true }));
  expect(registry.list('pick', 'Claude', true).map((t) => t.draft)).toEqual([false, false]);
});

test('choice records carry no board hashes, so editing a board never resets a choice', () => {
  const { registry } = project();
  const { comments } = registry.apply('pick', human({ group: 'q1', choice: 'q1-a' }));
  expect(comments.threads[0]!.anchor.hashes).toBeUndefined();
});

test('pushes tell the viewer whether a watcher is listening, and a heartbeat change pushes again', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-choices-listen-'));
  const dir = path.join(root, 'artboard', 'pick');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'canvas.json'),
    JSON.stringify({ version: 1, pages: [{ id: 'p', name: 'P' }], boards: {} }),
  );
  const stateDir = path.join(root, '.state');
  const messages: Record<string, unknown>[] = [];
  const registry = createBoardCommentRegistry({
    root,
    stateDir,
    broadcast: (message) => messages.push(message as unknown as Record<string, unknown>),
  });
  registry.apply('pick', human({ board: 'x' }, 'hello'));
  expect(messages.at(-1)).toMatchObject({ type: 'board-comments', listening: false });
  expect(registry.listening('pick')).toBe(false);
  const watch = path.join(stateDir, 'claude-comment-watch');
  fs.mkdirSync(watch, { recursive: true });
  const session = '00000000-0000-4000-8000-000000000000';
  fs.writeFileSync(
    path.join(watch, `${session}.json`),
    JSON.stringify({ artifacts: ['artboard/pick'] }),
  );
  fs.writeFileSync(path.join(watch, `${session}.alive`), String(Date.now()));
  const before = messages.length;
  registry.refreshListening();
  expect(messages.length).toBe(before + 1);
  expect(messages.at(-1)).toMatchObject({ listening: true });
  registry.refreshListening();
  expect(messages.length).toBe(before + 1);
  expect(registry.apply('pick', human({ board: 'x' }, 'again'))).toMatchObject({ listening: true });
});

test('a canvas.json mid-rewrite keeps the last rounds.json', () => {
  const { registry, dir, stateDir } = project();
  registry.apply('pick', human({ round: 'r1', submit: true }));
  const file = path.join(stateDir, 'artboard', 'pick', 'rounds.json');
  const before = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(path.join(dir, 'canvas.json'), '{"version": 1, "pages": [');
  registry.boardsChanged('pick');
  expect(fs.readFileSync(file, 'utf8')).toBe(before);
});

test('choice records are never stale', () => {
  const { registry } = project();
  registry.apply('pick', human({ group: 'q1', choice: 'q1-a' }));
  registry.apply('pick', human({ round: 'r1', submit: true }));
  expect(registry.stale('pick')).toEqual([]);
});

test('a human cannot delete, reopen or resolve a choice record', () => {
  const { registry } = project();
  const { comments } = registry.apply('pick', human({ group: 'q1', choice: 'q1-a' }));
  const thread = comments.threads[0]!;
  const ops = [
    { op: 'delete', threadId: thread.id, messageId: thread.messages[0]!.id },
    { op: 'reopen', threadId: thread.id },
  ];
  for (const op of ops)
    expect(() => registry.apply('pick', asBoardHumanOp(op)!)).toThrow(/choice record/);
});

test('choice admission covers both comment and round bytes before either file is created', () => {
  const { dir, registry, stateDir, sent } = project();
  const comments = path.join(dir, 'comments.json');
  const rounds = path.join(stateDir, 'artboard/pick/rounds.json');
  expect(() =>
    registry.agentChoose('pick', 'q1', 'q1-a', undefined, () => {
      throw new Error('quota exceeded');
    }),
  ).toThrow('quota');
  expect(fs.existsSync(comments)).toBe(false);
  expect(fs.existsSync(rounds)).toBe(false);
  expect(sent).toHaveLength(0);
  let charged = 0;
  registry.agentChoose('pick', 'q1', 'q1-a', undefined, (delta) => {
    charged += delta;
  });
  expect(charged).toBe(fs.statSync(comments).size + fs.statSync(rounds).size);
  expect(sent).toHaveLength(1);
});

test('round installation failure rolls back comment files and memory before broadcasting', () => {
  const { dir, registry, stateDir, sent } = project();
  registry.agentChoose('pick', 'q1', 'q1-a');
  const comments = path.join(dir, 'comments.json');
  const rounds = path.join(stateDir, 'artboard/pick/rounds.json');
  const before = [fs.readFileSync(comments, 'utf8'), fs.readFileSync(rounds, 'utf8')];
  const messages = sent.length;
  const rename = fs.renameSync;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to) === rounds && String(from).endsWith('.tmp'))
      throw new Error('round write failed');
    return rename(from, to);
  });
  try {
    expect(() => registry.agentChoose('pick', 'q1', 'q1-b')).toThrow('round write failed');
  } finally {
    spy.mockRestore();
  }
  expect([fs.readFileSync(comments, 'utf8'), fs.readFileSync(rounds, 'utf8')]).toEqual(before);
  expect(registry.groups('pick').find((group) => group.id === 'q1')).toMatchObject({
    choice: 'q1-a',
  });
  expect(sent).toHaveLength(messages);
  registry.agentChoose('pick', 'q1', 'q1-b');
  expect(registry.groups('pick').find((group) => group.id === 'q1')).toMatchObject({
    choice: 'q1-b',
  });
});

test('a submission records only its round choices and latest live human comments', () => {
  const { registry, stateDir } = project({
    r2: { page: 'p', kind: 'title', x: 0, y: 300, text: 'Round 2' },
  });
  const file = path.join(stateDir, 'artboard', 'pick', 'rounds.json');
  const records = () => JSON.parse(fs.readFileSync(file, 'utf8')).rounds;

  registry.apply('pick', human({ board: 'q1-a' }, 'first round comment'));
  registry.apply('pick', human({ board: 'plain' }, 'unrelated comment'));
  const { comments } = registry.apply(
    'pick',
    human({ board: 'q2-b', nodes: [{ board: 'q2-b', path: '#title' }] }, 'first comment'),
  );
  const threadId = comments.threads.at(-1)!.id;
  const reply = (text: string) =>
    registry.apply('pick', asBoardHumanOp({ op: 'reply', threadId, text })!);
  reply('latest comment');
  const deleted = reply('deleted comment')
    .comments.threads.find((thread) => thread.id === threadId)!
    .messages.at(-1)!.id;
  registry.apply('pick', asBoardHumanOp({ op: 'delete', threadId, messageId: deleted })!);
  registry.applyAgent('pick', { op: 'reply', threadId, text: 'agent response' });
  registry.applyAgent('pick', {
    op: 'add',
    anchor: { page: 'p', board: 'q2-a', x: 0, y: 0 },
    text: 'agent-only thread',
  });
  registry.agentChoose('pick', 'q2', 'q2-b');
  registry.agentSubmit('pick', 'r2', true);

  const summary = {
    choices: [{ group: 'q2', label: 'Two', answer: 'q2-b' }],
    threads: [{ id: threadId, anchor: 'q2-b · #title', text: 'latest comment' }],
  };
  expect(records()).toEqual([
    expect.objectContaining({ id: 'r1', state: 'closed' }),
    expect.objectContaining({ id: 'r2', state: 'submitted', summary }),
  ]);
  expect(records()[0]).not.toHaveProperty('summary');
  expect(registry.rounds('pick')[1]).not.toHaveProperty('summary');

  reply('after submission');
  registry.agentChoose('pick', 'q2', 'q2-a');
  registry.sync('pick');
  registry.boardsChanged('pick');
  expect(records()[1].summary).toEqual(summary);

  registry.agentSubmit('pick', 'r2', false);
  expect(records()[1]).not.toHaveProperty('summary');
  registry.agentSubmit('pick', 'r2', true);
  expect(records()[1].summary).toEqual({
    choices: [{ group: 'q2', label: 'Two', answer: 'q2-a' }],
    threads: [{ id: threadId, anchor: 'q2-b · #title', text: 'after submission' }],
  });
});

test('a round summary fits the notification byte limit with long Unicode comments', () => {
  const { registry, stateDir } = project();
  for (let index = 0; index < 18; index++)
    registry.apply('pick', human({ board: 'q1-a' }, '🎨'.repeat(300)));

  registry.apply('pick', human({ round: 'r1', submit: true }));
  const { rounds } = JSON.parse(
    fs.readFileSync(path.join(stateDir, 'artboard', 'pick', 'rounds.json'), 'utf8'),
  );
  const { summary } = rounds[0];
  expect(summary.choices).toEqual([
    { group: 'q1', label: 'One', answer: 'q1-b', byRecommendation: true },
  ]);
  expect(summary.truncated).toBe(true);
  expect(summary.threads.length).toBeGreaterThan(0);
  expect(summary.threads.length).toBeLessThan(16);
  expect(summary.threads[0].text).toBe('🎨'.repeat(239) + '…');
  expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(3072);
});

test('a real choice submission reaches the subscribed poll without acknowledging comments', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-round-poll-'));
  try {
    const { registry, stateDir } = project({}, path.join(directory, '.anjian/artifacts'));
    registry.sync('pick');
    const subscribed = createCommentWatch(directory, 'Codex', 'codex:layout-review');
    const other = createCommentWatch(directory, 'Codex', 'codex:another-review');
    expect(subscribed(new Set(['artboard/pick']))).toEqual([]);
    expect(other(new Set(['artboard/another']))).toEqual([]);
    registry.apply('pick', human({ board: 'q1-a' }, 'Keep the short heading'));
    registry.apply('pick', human({ group: 'q1', choice: 'q1-a' }));
    registry.apply('pick', human({ round: 'r1', submit: true }));

    const events = subscribed(new Set(['artboard/pick']));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'anjian-choices', round: 'r1' });
    expect(formatRoundSummary(events[0]!)).toContain('Keep the short heading');
    expect(formatRoundSummary(events[0]!)).toContain('q1-a');
    expect(other(new Set(['artboard/another']))).toEqual([]);
    expect(fs.existsSync(path.join(stateDir, 'artboard', 'pick', 'comment-receipts.json'))).toBe(
      false,
    );
    expect(subscribed(new Set(['artboard/pick']))).toEqual([]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
