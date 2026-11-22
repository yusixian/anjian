import { TREE_NAME } from '@haklex/rich-collab-loro';
import { LoroDoc, LoroText, type PeerID } from 'loro-crdt';
import { expect, test } from 'vitest';

import { documentChanges } from '../src/server/document-changes';

function setup(peer: PeerID = '1') {
  const doc = new LoroDoc();
  doc.setPeerId(peer);
  doc.setChangeMergeInterval(20);
  const tree = doc.getTree(TREE_NAME);
  const root = tree.createNode();
  const block = root.createNode();
  block.data.set('$', { blockId: 'paragraph-one' });
  doc.commit({ timestamp: 100, message: 'session start' });
  return { doc, tree, root, block };
}

const snapshot = (doc: LoroDoc) => doc.export({ mode: 'snapshot' });

async function latest(doc: LoroDoc) {
  const result = await documentChanges(snapshot(doc), { versions: true });
  if (!('latest' in result) || !result.latest) throw new Error('Expected a version list');
  return result.latest;
}

test('queries an exact interval inside a merged human change and retains evidence after an agent edit', async () => {
  const { doc, block } = setup();
  try {
    const first = await latest(doc);
    block.data.set('text', 'first human edit');
    doc.commit({ timestamp: 200, message: 'human' });
    const middle = await latest(doc);
    const firstHumanCounter = doc.frontiers()[0]!.counter;
    block.data.set('text', 'second human edit');
    doc.commit({ timestamp: 201, message: 'human' });
    const afterHuman = await latest(doc);
    expect(doc.getChangeAt(doc.frontiers()[0]!).counter).toBe(firstHumanCounter);
    block.data.set('text', 'agent rewrite');
    doc.commit({ timestamp: 400, message: 'agent: edit' });
    const last = await latest(doc);

    expect(await documentChanges(snapshot(doc), { from: middle })).toMatchObject({
      from: middle,
      to: last,
      empty: false,
      changes: [
        {
          author: { source: 'human', peer: '1' },
          blocks: [
            {
              treeId: block.id,
              blockId: 'paragraph-one',
              operations: [{ id: `${firstHumanCounter + 1}@1`, type: 'insert' }],
            },
          ],
          unlocated: [],
        },
      ],
    });
    const beforeMiddle = await documentChanges(snapshot(doc), { from: first, to: middle });
    expect(beforeMiddle).toMatchObject({
      changes: [{ blocks: [{ operations: [{ id: `${firstHumanCounter}@1` }] }] }],
    });
    expect(await documentChanges(snapshot(doc), { from: afterHuman })).toMatchObject({
      empty: true,
      changes: [],
    });
    expect(await documentChanges(snapshot(doc), { from: middle, to: middle })).toMatchObject({
      empty: true,
      changes: [],
    });
    await expect(documentChanges(snapshot(doc), { from: last, to: middle })).rejects.toMatchObject({
      status: 409,
      code: 'unordered_document_versions',
    });
  } finally {
    doc.free();
  }
});

test('locates a human-created block deleted within the same merged change and preserves unlocated evidence', async () => {
  const { doc, tree, root } = setup();
  try {
    const from = await latest(doc);
    const temporary = root.createNode();
    temporary.data.set('$', { blockId: 'temporarily-added' });
    const nested = temporary.createNode();
    const text = nested.data.setContainer('text', new LoroText());
    text.insert(0, 'review evidence');
    doc.commit({ timestamp: 200, message: 'human' });
    tree.delete(temporary.id);
    doc.getMap('other').set('mark', true);
    doc.commit({ timestamp: 201, message: 'human' });
    expect(await documentChanges(snapshot(doc), { from })).toMatchObject({
      empty: false,
      changes: [
        {
          blocks: [
            {
              treeId: temporary.id,
              blockId: 'temporarily-added',
              operations: expect.arrayContaining([
                expect.objectContaining({ type: 'create' }),
                expect.objectContaining({ container: text.id, type: 'insert' }),
                expect.objectContaining({ type: 'delete' }),
              ]),
            },
          ],
          unlocated: [expect.objectContaining({ container: 'cid:root-other:Map', type: 'insert' })],
        },
      ],
    });
  } finally {
    doc.free();
  }
});

test('rejects foreign and malformed versions and preserves the shallow history floor', async () => {
  const { doc, block } = setup();
  const foreign = setup('2').doc;
  try {
    const first = await latest(doc);
    block.data.set('text', 'first edit');
    doc.commit({ timestamp: 200, message: 'human' });
    const retained = await latest(doc);
    const boundary = doc.frontiers();
    block.data.set('text', 'second edit');
    doc.commit({ timestamp: 230, message: 'human' });
    const shallow = doc.export({ mode: 'shallow-snapshot', frontiers: boundary });

    expect(await documentChanges(shallow, { versions: true })).toMatchObject({ shallow: true });
    expect(await documentChanges(shallow, { from: retained })).toMatchObject({ empty: false });
    await expect(documentChanges(shallow, { from: first })).rejects.toMatchObject({ status: 409 });
    await expect(
      documentChanges(snapshot(doc), { from: await latest(foreign) }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(documentChanges(snapshot(doc), { from: 'garbage' })).rejects.toMatchObject({
      status: 400,
    });
  } finally {
    foreign.free();
    doc.free();
  }
});

test('keeps concurrent human operations from both peers and locates moves under both affected blocks', async () => {
  const { doc, root, block } = setup();
  const destination = root.createNode();
  const child = block.createNode();
  doc.commit({ timestamp: 101, message: 'session start' });
  const other = doc.fork();
  try {
    const from = await latest(doc);
    other.setPeerId('2');
    other
      .getTree(TREE_NAME)
      .getNodeByID(destination.id)!
      .data.set('$', { blockId: 'paragraph-two' });
    other.commit({ timestamp: 200, message: 'human' });
    const concurrent = await latest(other);
    child.move(destination);
    doc.commit({ timestamp: 201, message: 'human' });
    const local = await latest(doc);
    doc.import(snapshot(other));

    const result = await documentChanges(snapshot(doc), { from });
    expect(result).toMatchObject({
      empty: false,
      changes: expect.arrayContaining([
        expect.objectContaining({
          author: { source: 'human', peer: '1' },
          blocks: expect.arrayContaining([
            expect.objectContaining({
              treeId: block.id,
              operations: [expect.objectContaining({ type: 'move' })],
            }),
            expect.objectContaining({ treeId: destination.id, blockId: 'paragraph-two' }),
          ]),
        }),
        expect.objectContaining({
          author: { source: 'human', peer: '2' },
          blocks: [expect.objectContaining({ treeId: destination.id, blockId: 'paragraph-two' })],
        }),
      ]),
    });
    await expect(
      documentChanges(snapshot(doc), { from: local, to: concurrent }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'unordered_document_versions',
    });
  } finally {
    other.free();
    doc.free();
  }
});
