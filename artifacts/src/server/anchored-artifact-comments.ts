import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  type AgentThreadOp,
  type AnchorSpec,
  applyAgentThreadOp,
  applyThreadOp,
  type CommentsFile,
  isObject,
  mergeComments,
  openThread,
  parseComments,
  savedComments,
  type ThreadOp,
  unreadThreads,
} from '../shared/comments';
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

const COMMENTS_FILE = 'comments.json';
const MAX_COMMENTS_BYTES = 4 * 1024 * 1024;

type AnchoredHumanOp<A> = ThreadOp | (A & { op: 'create'; text: string });
type AnchoredAgentOp<A> =
  AgentThreadOp | { op: 'reopen'; threadId: string } | (A & { op: 'add'; text: string });

export function asAnchoredHumanOp<A>(
  value: unknown,
  anchors: AnchorSpec<A>,
): AnchoredHumanOp<A> | null {
  if (!isObject(value)) return null;
  if (value.op === 'create') {
    const anchor = anchors.read(value);
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

export function asAnchoredAgentOp<A>(
  value: unknown,
  anchors: AnchorSpec<A>,
): AnchoredAgentOp<A> | null {
  if (!isObject(value)) return null;
  if (value.op === 'add') {
    const anchor = anchors.read(value.anchor ?? value);
    return anchor && isText(value.text) && value.text.trim()
      ? { ...anchor, op: 'add', text: value.text }
      : null;
  }
  if (value.op === 'reopen')
    return isId(value.threadId) ? { op: 'reopen', threadId: value.threadId } : null;
  const op = asAgentOp(value);
  return op && op.op !== 'add' ? op : null;
}

interface AnchoredCommentOptions<A> {
  anchors: AnchorSpec<A>;
  assertAnchor: (dir: string, anchor: A) => void;
  changedComments: string;
  error: new (status: number, message: string) => Error;
  label: string;
  missingThread: string;
  type: 'slides' | 'storyboard';
}

function readComments(
  file: string,
  ErrorType: AnchoredCommentOptions<unknown>['error'],
  changed: string,
): Buffer | null {
  let handle: number;
  try {
    handle = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw new ErrorType(422, 'Unsafe comments.json path');
    throw error;
  }
  try {
    const info = fs.fstatSync(handle);
    if (!info.isFile()) throw new ErrorType(422, 'Unsafe comments.json path');
    if (info.size > MAX_COMMENTS_BYTES) throw new ErrorType(413, 'comments.json is too large');
    const data = Buffer.alloc(info.size + 1);
    let bytes = 0;
    while (bytes < data.length) {
      const count = fs.readSync(handle, data, bytes, data.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes !== info.size) throw new ErrorType(409, changed);
    return data.subarray(0, bytes);
  } finally {
    fs.closeSync(handle);
  }
}

function sameContents(current: Buffer | null, expected: Buffer | null) {
  return current === null || expected === null ? current === expected : current.equals(expected);
}

function createAnchoredStore<A>(dir: string, stateDir: string, options: AnchoredCommentOptions<A>) {
  const { anchors, changedComments, error: ErrorType, type } = options;
  const file = path.join(dir, COMMENTS_FILE);
  let expected: Buffer | null;
  const prepareWrite = () => {
    expected = readComments(file, ErrorType, changedComments);
    if (!expected) return;
    try {
      parseComments(expected.toString('utf8'));
    } catch {
      throw new ErrorType(409, 'comments.json contains an invalid edit. Repair it before saving.');
    }
  };
  const store = createStore<CommentsFile<A>, AnchoredHumanOp<A>, AnchoredAgentOp<A>>(
    file,
    {
      empty: () => ({ version: 1, threads: [] }),
      saved: (incoming) => savedComments(incoming, anchors),
      merge: (base, incoming, origin, now, newId, name) =>
        mergeComments(base, incoming, origin, now, newId, name, anchors),
      human: (comments, op, now, newId, who) => {
        if (op.op !== 'create') return applyThreadOp(comments, op, now, newId, who);
        const thread = openThread(anchors.read(op)!, 'human', op.text, now, newId, who);
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
        const thread = openThread(anchors.read(op)!, 'agent', op.text, now, newId, { name });
        return {
          file: { ...comments, threads: [...comments.threads, thread] },
          threadId: thread.id,
          messageId: thread.messages[0]!.id,
        };
      },
    },
    commentNames({
      agentFile: path.join(stateDir, 'agent'),
      artifact: { type, id: path.basename(dir) },
      projectDir: path.resolve(dir, '../../../..'),
    }),
    undefined,
    undefined,
    undefined,
    (next, admit) => {
      const data = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
      if (data.length > MAX_COMMENTS_BYTES) throw new ErrorType(413, 'comments.json is too large');
      admit?.(data.length - (expected?.length ?? 0));
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temp, data, { flag: 'wx', mode: 0o600 });
        if (!sameContents(readComments(file, ErrorType, changedComments), expected))
          throw new ErrorType(409, changedComments);
        if (expected === null) {
          try {
            fs.linkSync(temp, file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST')
              throw new ErrorType(409, changedComments);
            throw error;
          }
        } else fs.renameSync(temp, file);
      } finally {
        fs.rmSync(temp, { force: true });
      }
      expected = data;
    },
    true,
    () => readComments(file, ErrorType, changedComments)?.toString('utf8') ?? null,
    {
      root: stateDir,
      file: path.join(stateDir, type, path.basename(dir), 'comment-recovery.json'),
    },
  );
  const cursors = createCommentCursors(stateDir, type);
  const validateThread = (threadId: string) => {
    store.sync();
    if (!store.current().threads.some((thread) => thread.id === threadId))
      throw new ErrorType(404, options.missingThread);
  };
  return {
    current: store.current,
    sync(admit?: CommentAdmission) {
      if (admit) prepareWrite();
      return store.sync(admit);
    },
    warnings: store.warnings,
    recovery() {
      store.sync();
      return store.recovery();
    },
    restore(text: string, admit?: CommentAdmission) {
      prepareWrite();
      return store.restore(text, admit);
    },
    restoreRecovery(revision: string, admit?: CommentAdmission) {
      prepareWrite();
      return store.restoreRecovery(revision, admit);
    },

    apply(op: AnchoredHumanOp<A>, admit?: CommentAdmission) {
      if (op.op === 'create') options.assertAnchor(dir, anchors.read(op)!);
      else validateThread(op.threadId);
      prepareWrite();
      return store.apply(op, admit);
    },
    applyAgent(
      op: AnchoredAgentOp<A>,
      name?: string,
      admit?: CommentAdmission,
      messageId?: string,
    ) {
      if (op.op === 'add') options.assertAnchor(dir, anchors.read(op)!);
      else validateThread(op.threadId);
      prepareWrite();
      return store.applyAgent(op, name, admit, messageId);
    },
    list(agent: string, all: boolean, admit?: CommentAdmission) {
      store.sync();
      const comments = store.current();
      if (all)
        return comments.threads.filter((thread) =>
          thread.messages.some((message) => !message.deleted),
        );
      const id = path.basename(dir);
      const { threads, newest } = unreadThreads(comments, cursors.get(id, agent));
      if (newest) cursors.set(id, agent, newest, admit);
      return threads;
    },
  };
}

export function anchoredComments<A>(options: AnchoredCommentOptions<A>) {
  const registries = new WeakMap<
    ServerContext,
    Map<string, { directory: string; comments: ReturnType<typeof createAnchoredStore<A>> }>
  >();
  return (ctx: ServerContext, dir: string) => {
    const parent = fs.lstatSync(path.dirname(dir), { throwIfNoEntry: false });
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!parent || !stat) throw new options.error(404, `${options.label} not found`);
    if (!parent.isDirectory() || !stat.isDirectory())
      throw new options.error(422, `Unsafe ${options.label.toLowerCase()} directory`);
    let registry = registries.get(ctx);
    if (!registry) registries.set(ctx, (registry = new Map()));
    const directory = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    let entry = registry.get(dir);
    if (entry?.directory !== directory) {
      entry = { directory, comments: createAnchoredStore(dir, ctx.stateDir, options) };
      registry.set(dir, entry);
    }
    return entry.comments;
  };
}
