import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ServerContext } from '../src/server/context';
import { asSlideAgentOp, asSlideHumanOp, slidesCommentsOf } from '../src/server/slides-comments';

let root: string;
let dir: string;
let commentsFile: string;
let ctx: ServerContext;

function writeDeck(ids: string[]) {
  fs.writeFileSync(path.join(dir, 'deck.json'), JSON.stringify({
    version: 1,
    title: 'Review',
    slides: ids.map((id) => ({ id, title: id, body: '', notes: '' })),
  }));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-slide-comments-'));
  dir = path.join(root, '.anjian', 'artifacts', 'slides', 'review');
  fs.mkdirSync(dir, { recursive: true });
  ctx = { stateDir: path.join(root, '.anjian', 'state') } as ServerContext;
  commentsFile = path.join(dir, 'comments.json');
  writeDeck(['opening', 'details']);
});

afterEach(() => fs.rmSync(root, { force: true, recursive: true }));

describe('slide comments', () => {
  it('keeps threads anchored through slide reorder and deletion', () => {
    const store = slidesCommentsOf(ctx, dir);
    const op = asSlideHumanOp({ op: 'create', slideId: 'details', text: 'Add context' })!;
    const threadId = store.apply(op).threads[0]!.id;
    writeDeck(['details', 'opening']);
    expect(store.list('agent', false)).toMatchObject([{ id: threadId, anchor: { slideId: 'details' } }]);
    expect(store.list('agent', false)).toEqual([]);
    expect(store.list('other agent', false)).toHaveLength(1);

    writeDeck(['opening']);
    expect(() => store.apply(op)).toThrow('The selected slide no longer exists');
    store.applyAgent({ op: 'reply', threadId, text: 'Added source' }, 'Reviewer');
    store.applyAgent({ op: 'resolve', threadId });
    store.applyAgent({ op: 'reopen', threadId });
    expect(store.list('agent', true)).toMatchObject([{
      anchor: { slideId: 'details' },
      status: 'open',
      statusBy: 'agent',
      messages: [{ text: 'Add context' }, { text: 'Added source', name: 'Reviewer' }],
    }]);
    expect(slidesCommentsOf({ ...ctx }, dir).current()).toEqual(store.current());
  });

  it('preserves the comment file after denied writes and malformed edits', () => {
    const store = slidesCommentsOf(ctx, dir);
    const op = asSlideAgentOp({ op: 'add', anchor: { slideId: 'opening' }, text: 'Check wording' })!;
    expect(asSlideAgentOp({ op: 'add', slideId: '../opening', text: 'Comment' })).toBeNull();
    expect(asSlideHumanOp({ op: 'create', slideId: 'opening', text: ' ' })).toBeNull();
    expect(() => store.applyAgent({ op: 'resolve', threadId: 'missing' })).toThrow(
      'Slide comment thread not found',
    );
    expect(() => store.applyAgent(op, undefined, () => {
      throw new Error('Quota exceeded');
    })).toThrow('Quota exceeded');
    expect(fs.existsSync(commentsFile)).toBe(false);
    fs.writeFileSync(commentsFile, '{');
    expect(store.sync()).toBe(true);
    expect(store.warnings()[0]).toContain('comments.json is not valid');
    expect(() => store.applyAgent(op)).toThrow('comments.json contains an invalid edit');
    expect(fs.readFileSync(commentsFile, 'utf8')).toBe('{');
  });

  it('preserves a comment file replaced by an external editor during admission', () => {
    const store = slidesCommentsOf(ctx, dir);
    const external = JSON.stringify({ threads: [] });
    expect(() => store.apply({ op: 'create', slideId: 'opening', text: 'Review' }, () => {
      fs.writeFileSync(commentsFile, external);
    })).toThrow('Slide comments changed on disk');
    expect(fs.readFileSync(commentsFile, 'utf8')).toBe(external);
  });

  it('rejects symlinks and oversized files', () => {
    const target = path.join(root, 'replacement.json');
    fs.writeFileSync(target, '{"threads":[]}');
    fs.symlinkSync(target, commentsFile);
    expect(() => slidesCommentsOf(ctx, dir)).toThrow('Unsafe comments.json path');
    fs.unlinkSync(commentsFile);
    fs.writeFileSync(commentsFile, '');
    fs.truncateSync(commentsFile, 4 * 1024 * 1024 + 1);
    expect(() => slidesCommentsOf(ctx, dir)).toThrow('comments.json is too large');
  });
});
