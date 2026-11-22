import { createHash, randomUUID } from 'node:crypto';
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
import {
  emptyWhiteboardScene,
  MAX_WHITEBOARD_SCENE_BYTES,
  parseWhiteboardScene,
  WHITEBOARD_SCENE_FILE,
  type WhiteboardAnchor,
  whiteboardAnchors,
  type WhiteboardComments,
  type WhiteboardScene,
} from '../shared/whiteboard';
import { createCommentCursors } from './comment-cursors';
import { commentNames } from './comment-names';
import type { ServerContext } from './context';
import {
  asAgentOp,
  asHumanOp,
  type CommentAdmission,
  createStore,
  isText,
} from './document-comments';

const COMMENTS_FILE = 'comments.json';

export class WhiteboardError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function checkDirectory(dir: string) {
  for (const target of [path.dirname(dir), dir]) {
    try {
      if (!fs.lstatSync(target).isDirectory())
        throw new WhiteboardError(422, 'Unsafe whiteboard directory');
    } catch (error) {
      if (missing(error)) throw new WhiteboardError(404, 'Whiteboard not found');
      throw error;
    }
  }
}

function checkedFile(file: string) {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile()) throw new WhiteboardError(422, `Unsafe ${path.basename(file)} path`);
    if (info.size > MAX_WHITEBOARD_SCENE_BYTES)
      throw new WhiteboardError(413, `${path.basename(file)} is too large`);
    return info;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function readBoundedFile(file: string): Buffer | null {
  const info = checkedFile(file);
  if (!info) return null;
  const name = path.basename(file);
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    if (missing(error)) return null;
    if ((error as NodeJS.ErrnoException).code === 'ELOOP')
      throw new WhiteboardError(422, `Unsafe ${name} path`);
    throw error;
  }
  try {
    const current = fs.fstatSync(fd);
    if (!current.isFile()) throw new WhiteboardError(422, `Unsafe ${name} path`);
    if (current.size > MAX_WHITEBOARD_SCENE_BYTES)
      throw new WhiteboardError(413, `${name} is too large`);
    const buffer = Buffer.alloc(current.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const read = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (!read) break;
      total += read;
    }
    if (total !== current.size)
      throw new WhiteboardError(409, 'Whiteboard changed while being read. Retry shortly.');
    return buffer.subarray(0, total);
  } finally {
    fs.closeSync(fd);
  }
}

const revisionOf = (contents: Buffer | string) =>
  createHash('sha256').update(contents).digest('hex');

export function readWhiteboardScene(dir: string) {
  checkDirectory(dir);
  const contents = readBoundedFile(path.join(dir, WHITEBOARD_SCENE_FILE));
  if (!contents) return { scene: emptyWhiteboardScene(), revision: 'empty', bytes: 0 };
  let scene: WhiteboardScene | null = null;
  try {
    scene = parseWhiteboardScene(JSON.parse(contents.toString('utf8')));
  } catch {
    // Keep a malformed agent edit on disk and refuse to overwrite it.
  }
  if (!scene)
    throw new WhiteboardError(422, `${WHITEBOARD_SCENE_FILE} is not a valid Excalidraw scene`);
  return {
    scene,
    revision: revisionOf(contents),
    bytes: contents.length,
  };
}

export function whiteboardTitle(scene: WhiteboardScene, dir: string) {
  const name = scene.appState?.name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : path.basename(dir);
}

function writeFile(file: string, data: string, beforeCommit?: () => void) {
  const staged = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(staged, data, { flag: 'wx', mode: 0o600 });
    beforeCommit?.();
    fs.renameSync(staged, file);
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

export function writeWhiteboardScene(
  dir: string,
  scene: WhiteboardScene,
  expectedRevision: string,
  admit?: CommentAdmission,
) {
  const checkRevision = () => {
    let current;
    try {
      current = readWhiteboardScene(dir);
    } catch (error) {
      if (error instanceof WhiteboardError && error.status === 422)
        throw new WhiteboardError(409, error.message);
      throw error;
    }
    if (current.revision !== expectedRevision)
      throw new WhiteboardError(409, 'Whiteboard changed on disk. Reload before saving edits.');
    return current.bytes;
  };
  const previous = checkRevision();
  const data = `${JSON.stringify(scene)}\n`;
  const bytes = Buffer.byteLength(data);
  if (bytes > MAX_WHITEBOARD_SCENE_BYTES)
    throw new WhiteboardError(413, `${WHITEBOARD_SCENE_FILE} is too large`);
  admit?.(bytes - previous);
  writeFile(path.join(dir, WHITEBOARD_SCENE_FILE), data, checkRevision);
  return { scene, revision: revisionOf(data), bytes };
}

type CreateComment = WhiteboardAnchor & { op: 'create'; text: string };
type AddComment = WhiteboardAnchor & { op: 'add'; text: string };

export type WhiteboardHumanOp = ThreadOp | CreateComment;
export type WhiteboardAgentOp = AgentThreadOp | AddComment;

export function asWhiteboardHumanOp(value: unknown): WhiteboardHumanOp | null {
  if (!isObject(value)) return null;
  if (value.op === 'create') {
    const anchor = whiteboardAnchors.read(value);
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

export function asWhiteboardAgentOp(value: unknown): WhiteboardAgentOp | null {
  if (!isObject(value)) return null;
  if (value.op !== 'add') {
    const op = asAgentOp(value);
    return op && op.op !== 'add' ? op : null;
  }
  const anchor = whiteboardAnchors.read(value.anchor ?? value);
  return anchor && isText(value.text) && value.text.trim()
    ? { ...anchor, op: 'add', text: value.text }
    : null;
}

export function assertWhiteboardElements(dir: string, anchor: WhiteboardAnchor) {
  const live = new Set(
    readWhiteboardScene(dir)
      .scene.elements.filter((element) => element.isDeleted !== true)
      .map((element) => element.id),
  );
  if (anchor.elementIds.some((id) => !live.has(id)))
    throw new WhiteboardError(409, 'Some selected whiteboard elements no longer exist.');
}

function createWhiteboardComments(dir: string, stateDir: string) {
  const file = path.join(dir, COMMENTS_FILE);
  let revision: string | null;
  const editableRevision = () => {
    const contents = readBoundedFile(file);
    if (contents === null) return null;
    try {
      parseComments(contents.toString('utf8'));
    } catch {
      throw new WhiteboardError(
        409,
        `${COMMENTS_FILE} contains an invalid edit. Repair it before saving.`,
      );
    }
    return revisionOf(contents);
  };
  const store = createStore<WhiteboardComments, WhiteboardHumanOp, WhiteboardAgentOp>(
    file,
    {
      empty: () => ({ version: 1, threads: [] }),
      saved: (incoming) => savedComments(incoming, whiteboardAnchors),
      merge: (base, incoming, origin, now, newId, name) =>
        mergeComments(base, incoming, origin, now, newId, name, whiteboardAnchors),
      human: (comments, op, now, newId, who) => {
        if (op.op !== 'create') return applyThreadOp(comments, op, now, newId, who);
        const thread = openThread({ elementIds: op.elementIds }, 'human', op.text, now, newId, who);
        return { ...comments, threads: [...comments.threads, thread] };
      },
      agent: (comments, op, now, newId, name) => {
        if (op.op !== 'add') return applyAgentThreadOp(comments, op, now, newId, name);
        const thread = openThread({ elementIds: op.elementIds }, 'agent', op.text, now, newId, {
          name,
        });
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
      const data = `${JSON.stringify(next, null, 2)}\n`;
      const size = Buffer.byteLength(data);
      if (size > MAX_WHITEBOARD_SCENE_BYTES)
        throw new WhiteboardError(413, 'comments.json is too large');
      admit?.(size - (checkedFile(file)?.size ?? 0));
      writeFile(file, data, () => {
        if (editableRevision() !== revision)
          throw new WhiteboardError(409, 'Whiteboard comments changed on disk. Retry this action.');
      });
      revision = revisionOf(data);
    },
    true,
  );
  const cursors = createCommentCursors(stateDir, 'whiteboard');
  return {
    current: store.current,
    sync: () => store.sync(),
    warnings: store.warnings,
    apply(op: WhiteboardHumanOp, admit?: CommentAdmission) {
      revision = editableRevision();
      return store.apply(op, admit);
    },
    applyAgent(op: WhiteboardAgentOp, name?: string, admit?: CommentAdmission) {
      revision = editableRevision();
      return store.applyAgent(op, name, admit);
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

const registries = new WeakMap<
  ServerContext,
  Map<
    string,
    {
      directory: string;
      comments: ReturnType<typeof createWhiteboardComments>;
    }
  >
>();

export function whiteboardCommentsOf(ctx: ServerContext, dir: string) {
  checkDirectory(dir);
  checkedFile(path.join(dir, COMMENTS_FILE));
  let registry = registries.get(ctx);
  if (!registry) registries.set(ctx, (registry = new Map()));
  const stat = fs.statSync(dir);
  const directory = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  let entry = registry.get(dir);
  if (entry?.directory !== directory) {
    entry = { directory, comments: createWhiteboardComments(dir, ctx.stateDir) };
    registry.set(dir, entry);
  }
  return entry.comments;
}
