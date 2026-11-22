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
  isWhiteboardPageId,
  MAX_WHITEBOARD_SCENE_BYTES,
  MAX_WHITEBOARD_SOURCE_BYTES,
  parseWhiteboardPages,
  parseWhiteboardScene,
  WHITEBOARD_DEFAULT_PAGE,
  WHITEBOARD_PAGES_FILE,
  WHITEBOARD_SCENE_FILE,
  type WhiteboardAnchor,
  whiteboardAnchors,
  type WhiteboardComments,
  type WhiteboardPage,
  whiteboardPageFile,
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
const emptyMainData = `${JSON.stringify(emptyWhiteboardScene(), null, 2)}\n`;
const emptyMainDigest = revisionOf(emptyMainData);

function pageRevision(page: string, contents: Buffer | string) {
  if (page !== WHITEBOARD_DEFAULT_PAGE)
    return createHash('sha256').update(page).update('\0').update(contents).digest('hex');
  const digest = revisionOf(contents);
  // Adding the first extra page can materialize an implicit blank main page.
  return digest === emptyMainDigest ? 'empty' : digest;
}

const mainPage: WhiteboardPage = { id: WHITEBOARD_DEFAULT_PAGE, title: 'Main' };

function pageManifest(dir: string) {
  checkDirectory(dir);
  const contents = readBoundedFile(path.join(dir, WHITEBOARD_PAGES_FILE));
  if (!contents) return { pages: [], revision: null, bytes: 0 };
  let pages: WhiteboardPage[] | null = null;
  try {
    pages = parseWhiteboardPages(JSON.parse(contents.toString('utf8')));
  } catch {
    // An external editor may still be writing the manifest.
  }
  if (!pages) throw new WhiteboardError(422, `${WHITEBOARD_PAGES_FILE} is invalid`);
  return { pages, revision: revisionOf(contents), bytes: contents.length };
}

export const readWhiteboardPages = (dir: string): WhiteboardPage[] => [
  mainPage,
  ...pageManifest(dir).pages,
];

function ensureSourceLimit(dir: string, delta: number, manifest = pageManifest(dir)) {
  if (delta <= 0) return;
  const pagesDir = path.join(dir, 'pages');
  if (pathExists(pagesDir)) checkDirectory(pagesDir);
  const bytes = [mainPage, ...manifest.pages].reduce((total, page) => {
    const file = path.join(dir, whiteboardPageFile(page.id));
    return total + (checkedFile(file)?.size ?? 0);
  }, manifest.bytes);
  if (bytes + delta > MAX_WHITEBOARD_SOURCE_BYTES)
    throw new WhiteboardError(413, 'Whiteboard source is too large');
}

function sceneFile(dir: string, page: string) {
  checkDirectory(dir);
  if (page === WHITEBOARD_DEFAULT_PAGE) return path.join(dir, WHITEBOARD_SCENE_FILE);
  if (!isWhiteboardPageId(page) || !pageManifest(dir).pages.some((entry) => entry.id === page))
    throw new WhiteboardError(404, 'Whiteboard page not found');
  const file = path.join(dir, whiteboardPageFile(page));
  checkDirectory(path.dirname(file));
  return file;
}

export function readWhiteboardScene(dir: string, page = WHITEBOARD_DEFAULT_PAGE) {
  const file = sceneFile(dir, page);
  const contents = readBoundedFile(file);
  if (!contents) {
    if (page !== WHITEBOARD_DEFAULT_PAGE)
      throw new WhiteboardError(404, 'Whiteboard page has no scene');
    return { scene: emptyWhiteboardScene(), revision: 'empty', bytes: 0 };
  }
  let scene: WhiteboardScene | null = null;
  try {
    scene = parseWhiteboardScene(JSON.parse(contents.toString('utf8')));
  } catch {
    // Keep a malformed agent edit on disk and refuse to overwrite it.
  }
  if (!scene)
    throw new WhiteboardError(422, `${path.basename(file)} is not a valid Excalidraw scene`);
  return {
    scene,
    revision: pageRevision(page, contents),
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
  } catch (error) {
    fs.rmSync(staged, { force: true });
    throw error;
  }
}

export function writeWhiteboardScene(
  dir: string,
  scene: WhiteboardScene,
  expectedRevision: string,
  admit?: CommentAdmission,
  page = WHITEBOARD_DEFAULT_PAGE,
) {
  const checkRevision = () => {
    let current;
    try {
      current = readWhiteboardScene(dir, page);
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
    throw new WhiteboardError(413, 'Whiteboard scene is too large');
  const delta = bytes - previous;
  ensureSourceLimit(dir, delta);
  admit?.(delta);
  writeFile(sceneFile(dir, page), data, () => {
    checkRevision();
    ensureSourceLimit(dir, delta);
  });
  return { scene, revision: pageRevision(page, data), bytes };
}

function pathExists(file: string) {
  return fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
}

export function editWhiteboardPages(
  dir: string,
  title: string,
  pageId: string | undefined,
  admit?: CommentAdmission,
) {
  const current = pageManifest(dir);
  const manifest = path.join(dir, WHITEBOARD_PAGES_FILE);
  const pages = [...current.pages];
  let id: string;
  let selected: ReturnType<typeof readWhiteboardScene>;
  const fresh: Array<{ file: string; data: string }> = [];
  if (pageId !== undefined) {
    const index = pages.findIndex((entry) => entry.id === pageId);
    if (index < 0) throw new WhiteboardError(404, 'Whiteboard page not found');
    id = pageId;
    selected = readWhiteboardScene(dir, id);
    pages[index] = { id, title };
  } else {
    const pagesDir = path.join(dir, 'pages');
    if (pathExists(pagesDir)) checkDirectory(pagesDir);
    const base =
      title
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .slice(0, 40)
        .replaceAll(/^-+|-+$/g, '') || 'page';
    id = base;
    const occupied = new Set([WHITEBOARD_DEFAULT_PAGE, ...pages.map((entry) => entry.id)]);
    while (occupied.has(id) || pathExists(path.join(dir, whiteboardPageFile(id)))) {
      id = `${base}-${randomUUID().slice(0, 8)}`;
    }
    const freshFile = path.join(dir, whiteboardPageFile(id));
    const scene = emptyWhiteboardScene();
    const data = `${JSON.stringify(scene)}\n`;
    selected = { scene, revision: pageRevision(id, data), bytes: Buffer.byteLength(data) };
    const mainFile = path.join(dir, WHITEBOARD_SCENE_FILE);
    if (!checkedFile(mainFile)) fresh.push({ file: mainFile, data: emptyMainData });
    fresh.push({ file: freshFile, data });
    pages.push({ id, title });
  }
  const value = { version: 1, pages };
  if (!parseWhiteboardPages(value)) throw new WhiteboardError(400, 'Invalid whiteboard page list');
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const delta = fresh.reduce(
    (bytes, file) => bytes + Buffer.byteLength(file.data),
    Buffer.byteLength(data) - current.bytes,
  );
  ensureSourceLimit(dir, delta, current);
  admit?.(delta);
  const created: string[] = [];
  try {
    writeFile(manifest, data, () => {
      const beforeCommit = pageManifest(dir);
      if (beforeCommit.revision !== current.revision || fresh.some(({ file }) => pathExists(file)))
        throw new WhiteboardError(409, 'Whiteboard pages changed on disk. Retry this action.');
      ensureSourceLimit(dir, delta, beforeCommit);
      for (const { file, data: sceneData } of fresh) {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        checkDirectory(path.dirname(file));
        const staged = `${file}.${randomUUID()}.tmp`;
        try {
          fs.writeFileSync(staged, sceneData, { flag: 'wx', mode: 0o600 });
          fs.linkSync(staged, file);
          created.push(file);
        } finally {
          fs.rmSync(staged, { force: true });
        }
      }
    });
  } catch (error) {
    for (const file of created) fs.rmSync(file, { force: true });
    throw error;
  }
  return { page: id, pages: [mainPage, ...pages], ...selected };
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
    readWhiteboardScene(dir, anchor.page)
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
        const { elementIds, page } = op;
        const thread = openThread(
          { elementIds, ...(page ? { page } : {}) },
          'human',
          op.text,
          now,
          newId,
          who,
        );
        return { ...comments, threads: [...comments.threads, thread] };
      },
      agent: (comments, op, now, newId, name) => {
        if (op.op !== 'add') return applyAgentThreadOp(comments, op, now, newId, name);
        const { elementIds, page } = op;
        const thread = openThread(
          { elementIds, ...(page ? { page } : {}) },
          'agent',
          op.text,
          now,
          newId,
          {
            name,
          },
        );
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
