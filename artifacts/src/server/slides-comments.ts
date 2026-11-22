import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  type AgentThreadOp,
  applyAgentThreadOp,
  applyThreadOp,
  isObject,
  mergeComments,
  openThread,
  parseComments,
  savedComments,
  type ThreadOp,
  unreadThreads,
} from '../shared/comments';
import { type SlideAnchor, slideAnchors,type SlideComments } from '../shared/slides';
import { createCommentCursors } from './comment-cursors';
import { commentNames } from './comment-names';
import type { ServerContext } from './context';
import {
  asAgentOp,
  asHumanOp,
  type CommentAdmission,
  createStore,
  isId,
  isText,
} from './document-comments';
import { readSlideDeck, SlideDeckError } from './slides';

const COMMENTS_FILE = 'comments.json';
const MAX_COMMENTS_BYTES = 4 * 1024 * 1024;

type SlideHumanOp = ThreadOp | (SlideAnchor & { op: 'create'; text: string });
type SlideAgentOp =
  | AgentThreadOp
  | { op: 'reopen'; threadId: string }
  | (SlideAnchor & { op: 'add'; text: string });

export function asSlideHumanOp(value: unknown): SlideHumanOp | null {
  if (!isObject(value)) return null;
  if (value.op === 'create') {
    const anchor = slideAnchors.read(value);
    return anchor && isText(value.text) && value.text.trim()
      ? { ...anchor, op: 'create', text: value.text }
      : null;
  }
  const raw =
    value.op === 'status' && (value.status === 'open' || value.status === 'resolved')
      ? { ...value, op: value.status === 'open' ? 'reopen' : 'resolve' }
      : value;
  const op = asHumanOp(raw);
  return op && op.op !== 'create' ? op : null;
}

export function asSlideAgentOp(value: unknown): SlideAgentOp | null {
  if (!isObject(value)) return null;
  if (value.op === 'add') {
    const anchor = slideAnchors.read(value.anchor ?? value);
    return anchor && isText(value.text) && value.text.trim()
      ? { ...anchor, op: 'add', text: value.text }
      : null;
  }
  if (value.op === 'reopen')
    return isId(value.threadId) ? { op: 'reopen', threadId: value.threadId } : null;
  const op = asAgentOp(value);
  return op && op.op !== 'add' ? op : null;
}

function assertSlide(dir: string, slideId: string) {
  if (!readSlideDeck(dir).deck.slides.some((slide) => slide.id === slideId))
    throw new SlideDeckError(409, 'The selected slide no longer exists');
}

function readComments(file: string): Buffer | null {
  let handle: number;
  try {
    handle = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw new SlideDeckError(422, 'Unsafe comments.json path');
    throw error;
  }
  try {
    const info = fs.fstatSync(handle);
    if (!info.isFile()) throw new SlideDeckError(422, 'Unsafe comments.json path');
    if (info.size > MAX_COMMENTS_BYTES) throw new SlideDeckError(413, 'comments.json is too large');
    const data = Buffer.alloc(info.size + 1);
    let bytes = 0;
    while (bytes < data.length) {
      const count = fs.readSync(handle, data, bytes, data.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes !== info.size)
      throw new SlideDeckError(409, 'Slide comments changed on disk. Retry this action.');
    return data.subarray(0, bytes);
  } finally {
    fs.closeSync(handle);
  }
}

function sameContents(current: Buffer | null, expected: Buffer | null) {
  return current === null || expected === null ? current === expected : current.equals(expected);
}

function createSlideComments(dir: string, stateDir: string) {
  const file = path.join(dir, COMMENTS_FILE);
  let expected: Buffer | null;
  const prepareWrite = () => {
    expected = readComments(file);
    if (!expected) return;
    try {
      parseComments(expected.toString('utf8'));
    } catch {
      throw new SlideDeckError(
        409,
        'comments.json contains an invalid edit. Repair it before saving.',
      );
    }
  };
  const store = createStore<SlideComments, SlideHumanOp, SlideAgentOp>(
    file,
    {
      empty: () => ({ version: 1, threads: [] }),
      saved: (incoming) => savedComments(incoming, slideAnchors),
      merge: (base, incoming, origin, now, newId, name) =>
        mergeComments(base, incoming, origin, now, newId, name, slideAnchors),
      human: (comments, op, now, newId, who) => {
        if (op.op !== 'create') return applyThreadOp(comments, op, now, newId, who);
        const thread = openThread({ slideId: op.slideId }, 'human', op.text, now, newId, who);
        return { ...comments, threads: [...comments.threads, thread] };
      },
      agent: (comments, op, now, newId, name) => {
        if (op.op === 'reopen') {
          return {
            file: {
              ...comments,
              threads: comments.threads.map((thread) =>
                thread.id === op.threadId
                  ? { ...thread, status: 'open', statusAt: now, statusBy: 'agent' }
                  : thread,
              ),
            },
            threadId: op.threadId,
          };
        }
        if (op.op !== 'add') return applyAgentThreadOp(comments, op, now, newId, name);
        const thread = openThread({ slideId: op.slideId }, 'agent', op.text, now, newId, { name });
        return {
          file: { ...comments, threads: [...comments.threads, thread] },
          threadId: thread.id,
          messageId: thread.messages[0]!.id,
        };
      },
    },
    commentNames({
      agentFile: path.join(stateDir, 'agent'),
      projectDir: path.resolve(dir, '../../../..'),
    }),
    undefined,
    undefined,
    undefined,
    (next, admit) => {
      const data = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
      if (data.length > MAX_COMMENTS_BYTES)
        throw new SlideDeckError(413, 'comments.json is too large');
      admit?.(data.length - (expected?.length ?? 0));
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temp, data, { flag: 'wx', mode: 0o600 });
        if (!sameContents(readComments(file), expected))
          throw new SlideDeckError(409, 'Slide comments changed on disk. Retry this action.');
        if (expected === null) {
          try {
            fs.linkSync(temp, file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST')
              throw new SlideDeckError(409, 'Slide comments changed on disk. Retry this action.');
            throw error;
          }
        } else fs.renameSync(temp, file);
      } finally {
        fs.rmSync(temp, { force: true });
      }
      expected = data;
    },
    true,
    () => readComments(file)?.toString('utf8') ?? null,
  );
  const cursors = createCommentCursors(stateDir, 'slides');
  const validateThread = (threadId: string) => {
    store.sync();
    if (!store.current().threads.some((thread) => thread.id === threadId))
      throw new SlideDeckError(404, 'Slide comment thread not found');
  };
  return {
    current: store.current,
    sync: store.sync,
    warnings: store.warnings,
    apply(op: SlideHumanOp, admit?: CommentAdmission) {
      if (op.op === 'create') assertSlide(dir, op.slideId);
      else validateThread(op.threadId);
      prepareWrite();
      return store.apply(op, admit);
    },
    applyAgent(op: SlideAgentOp, name?: string, admit?: CommentAdmission) {
      if (op.op === 'add') assertSlide(dir, op.slideId);
      else validateThread(op.threadId);
      prepareWrite();
      return store.applyAgent(op, name, admit);
    },
    list(agent: string, all: boolean, admit?: CommentAdmission) {
      store.sync();
      const comments = store.current();
      if (all)
        return comments.threads.filter((thread) => thread.messages.some((message) => !message.deleted));
      const id = path.basename(dir);
      const { threads, newest } = unreadThreads(comments, cursors.get(id, agent));
      if (newest) cursors.set(id, agent, newest, admit);
      return threads;
    },
  };
}

const registries = new WeakMap<
  ServerContext,
  Map<string, { directory: string; comments: ReturnType<typeof createSlideComments> }>
>();

export function slidesCommentsOf(ctx: ServerContext, dir: string) {
  const parent = fs.lstatSync(path.dirname(dir), { throwIfNoEntry: false });
  const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!parent || !stat) throw new SlideDeckError(404, 'Slide deck not found');
  if (!parent.isDirectory() || !stat.isDirectory())
    throw new SlideDeckError(422, 'Unsafe slide deck directory');
  let registry = registries.get(ctx);
  if (!registry) registries.set(ctx, (registry = new Map()));
  const directory = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  let entry = registry.get(dir);
  if (entry?.directory !== directory) {
    entry = { directory, comments: createSlideComments(dir, ctx.stateDir) };
    registry.set(dir, entry);
  }
  return entry.comments;
}
