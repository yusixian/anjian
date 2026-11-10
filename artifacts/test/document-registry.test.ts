import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { createDocumentRegistry } from '../src/server/documents';
import type { ServerMessage } from '../src/shared/types';

test('a list that picks up an agent file write still pushes it to the page', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-registry-'));
  const file = path.join(root, 'document', 'relay', 'comments.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sent: ServerMessage[] = [];
  const registry = createDocumentRegistry({
    root,
    stateDir: path.join(root, '.state'),
    broadcast: (m) => sent.push(m),
    onWarningsChange: () => {},
  });
  registry.comments('relay');
  fs.writeFileSync(
    file,
    JSON.stringify({
      threads: [
        { anchor: { blockId: 'b1', quote: '' }, messages: [{ author: 'agent', text: 'q' }] },
      ],
    }),
  );
  registry.listComments('relay', 'Codex', true);
  registry.commentsChanged('relay');
  expect(sent.filter((m) => m.type === 'doc-comments')).toHaveLength(1);
});


test('maintenance refreshes admission after each document and resumes after a later rejection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-registry-quota-'));
  for (const id of ['first', 'second']) {
    fs.mkdirSync(path.join(root, 'document', id), { recursive: true });
    fs.writeFileSync(path.join(root, 'document', id, 'doc.xml'), '<doc><p>hello</p></doc>');
  }
  const registry = createDocumentRegistry({
    root, stateDir: path.join(root, '.state'), timing: { writeDelayMs: 60_000 },
    broadcast: () => {}, onWarningsChange: () => {},
  });
  const firstSnapshot = path.join(root, '.state/document/first/doc.loro');
  const secondSnapshot = path.join(root, '.state/document/second/doc.loro');
  try {
    const first = await registry.open('first');
    const second = await registry.open('second');
    const measured: boolean[] = [];
    await expect(registry.quiesce(async () => {
      measured.push(fs.existsSync(firstSnapshot));
      return () => { if (measured.length === 2) throw new Error('remaining quota'); };
    })).rejects.toThrow('Documents did not quiesce completely');
    expect(measured).toEqual([false, true]);
    expect(fs.existsSync(firstSnapshot)).toBe(true);
    expect(fs.existsSync(secondSnapshot)).toBe(false);
    expect(await registry.open('first')).toBe(first);
    expect(await registry.open('second')).toBe(second);
    const resume = await registry.quiesce(async () => () => {});
    expect(fs.existsSync(secondSnapshot)).toBe(true);
    resume();
  } finally {
    await registry.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('comment reads and watcher updates defer writes to an admitted queue', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-comment-queue-'));
  const file = path.join(root, 'document', 'draft', 'comments.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = (text: string) => JSON.stringify({ threads: [
    { anchor: { blockId: 'p', quote: '' }, messages: [{ author: 'agent', text }] },
  ] });
  fs.writeFileSync(file, raw('first'));
  let queued: ((admit: (delta: number) => void) => void) | undefined;
  const registry = createDocumentRegistry({
    root, stateDir: path.join(root, '.state'), broadcast: () => {}, onWarningsChange: () => {},
    enqueueCommentWrite: (_id, work) => { queued = work; },
  });
  try {
    expect(registry.comments('draft').threads[0]!.messages[0]!.text).toBe('first');
    expect(fs.readFileSync(file, 'utf8')).toBe(raw('first'));
    expect(() => queued!(() => { throw new Error('full'); })).toThrow('full');
    fs.writeFileSync(file, raw('latest'));
    registry.commentsChanged('draft');
    const latest = structuredClone(registry.comments('draft'));
    expect(latest.threads.some(t => t.messages.some(m => m.text === 'latest'))).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(raw('latest'));
    queued!(() => {});
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(latest);
    fs.writeFileSync(file, raw('after close'));
    registry.commentsChanged('draft');
    await registry.close();
    queued!(() => { throw new Error('closed callback'); });
    expect(fs.readFileSync(file, 'utf8')).toBe(raw('after close'));
  } finally { await registry.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
