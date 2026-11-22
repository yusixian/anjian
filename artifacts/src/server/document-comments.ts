import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { nanoid } from 'nanoid';

import {
  type AgentOp,
  applyAgentOp,
  applyHumanOp,
  type Author,
  type CommentsFile,
  documentAnchors,
  emptyComments,
  type HumanOp,
  type IncomingComments,
  mergeComments,
  mergeRestoredComments,
  type Message,
  parseComments,
  type Person,
  savedComments,
} from '../shared/comments';
import type { CommentNames } from './comment-names';
import { writeJsonAtomic } from './state';
import { writeJsonFiles } from './storage/json-files';

const MAX_TEXT = 20000;

export const isText = (value: unknown, max = MAX_TEXT): value is string =>
  typeof value === 'string' && value.length <= max;
export const isId = (value: unknown): value is string => isText(value, 100) && value.length > 0;

export function asHumanOp(value: unknown): HumanOp | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  switch (v.op) {
    case 'create': {
      const anchor = documentAnchors.read(v);
      return anchor && isId(v.blockId) && isText(v.quote) && isText(v.text) && v.text.length > 0
        ? { op: 'create', ...anchor, text: v.text }
        : null;
    }
    case 'reply': {
      return isId(v.threadId) && isText(v.text) && v.text.length > 0
        ? { op: 'reply', threadId: v.threadId, text: v.text }
        : null;
    }
    case 'edit': {
      return isId(v.threadId) && isId(v.messageId) && isText(v.text) && v.text.length > 0
        ? { op: 'edit', threadId: v.threadId, messageId: v.messageId, text: v.text }
        : null;
    }
    case 'delete': {
      return isId(v.threadId) && isId(v.messageId)
        ? { op: 'delete', threadId: v.threadId, messageId: v.messageId }
        : null;
    }
    case 'resolve':
    case 'reopen': {
      return isId(v.threadId) ? { op: v.op, threadId: v.threadId } : null;
    }
    default: {
      return null;
    }
  }
}

export function asAgentOp(value: unknown): AgentOp | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  switch (v.op) {
    case 'add': {
      const anchor = documentAnchors.read(v);
      return anchor &&
        isId(v.blockId) &&
        (v.quote === undefined || isText(v.quote)) &&
        isText(v.text) &&
        v.text.length > 0
        ? {
            op: 'add',
            ...anchor,
            text: v.text,
          }
        : null;
    }
    case 'reply': {
      return isId(v.threadId) && isText(v.text) && v.text.length > 0
        ? { op: 'reply', threadId: v.threadId, text: v.text }
        : null;
    }
    case 'resolve': {
      return isId(v.threadId) ? { op: 'resolve', threadId: v.threadId } : null;
    }
    default: {
      return null;
    }
  }
}

export interface Store<F, H, G> {
  apply: (op: H, admit?: CommentAdmission) => F;
  applyAgent: (
    op: G,
    name?: string,
    admit?: CommentAdmission,
    messageId?: string,
  ) => { file: F; threadId: string; messageId?: string };
  current: () => F;
  hasRecovery: () => boolean;
  recovery: () => { backup: F; revision: string } | null;
  restore: (text: string, admit?: CommentAdmission) => F;
  restoreRecovery: (revision: string, admit?: CommentAdmission) => boolean;
  sync: (admit?: CommentAdmission) => boolean;
  warnings: () => string[];
}
export class InvalidCommentBackup extends Error {}

export type CommentAdmission = (deltaBytes: number) => void;

export type CommentStore = Store<CommentsFile, HumanOp, AgentOp>;

export interface StoreRules<F, H, G> {
  agent: (
    file: F,
    op: G,
    now: string,
    newId: () => string,
    name?: string,
  ) => { file: F; threadId: string; messageId?: string };
  empty: () => F;
  human: (file: F, op: H, now: string, newId: () => string, who?: Person) => F;
  merge: (
    base: F,
    incoming: IncomingComments,
    origin: Author,
    now: string,
    newId: () => string,
    name?: string,
  ) => { file: F; warnings: string[] };
  saved: (incoming: IncomingComments) => F;
}

const documentRules: StoreRules<CommentsFile, HumanOp, AgentOp> = {
  empty: emptyComments,
  saved: savedComments,
  merge: mergeComments,
  human: applyHumanOp,
  agent: applyAgentOp,
};

const validBackupTime = (value: unknown): value is string =>
  isText(value, 64) && Number.isFinite(Date.parse(value));

function validBackupMessage(message: Message) {
  return (
    isId(message.id) &&
    validBackupTime(message.at) &&
    isText(message.text) &&
    (message.name === undefined || isText(message.name, 200)) &&
    (message.avatar === undefined || isText(message.avatar, 2000)) &&
    (message.editedAt === undefined || validBackupTime(message.editedAt)) &&
    (message.deleted === undefined || (message.deleted === true && message.text === ''))
  );
}

function readCommentBackup<F extends CommentsFile<unknown>>(
  text: string,
  readSaved: (incoming: IncomingComments) => F,
): F {
  const invalid = new InvalidCommentBackup('Invalid saved comment backup');
  let incoming: IncomingComments;
  let backup: F;
  try {
    incoming = parseComments(text);
    backup = readSaved(incoming);
  } catch {
    throw invalid;
  }
  if (
    incoming.version !== 1 ||
    backup.threads.length !== incoming.threads.length ||
    new Set(backup.threads.map(({ id }) => id)).size !== backup.threads.length
  )
    throw invalid;
  for (const [index, thread] of backup.threads.entries()) {
    const messages = thread.messages;
    if (
      !isId(thread.id) ||
      !validBackupTime(thread.statusAt) ||
      messages.length !== (incoming.threads[index]?.messages?.length ?? 0) ||
      new Set(messages.map(({ id }) => id)).size !== messages.length ||
      messages.some((message) => !validBackupMessage(message))
    )
      throw invalid;
  }
  return backup;
}

interface CommentRecovery {
  file: string;
  root: string;
}

function rejectedHumanComments<F extends CommentsFile<unknown>>(incoming: F, visible: F): F {
  const byThread = new Map(visible.threads.map((thread) => [thread.id, thread]));
  const threads = incoming.threads.flatMap((thread) => {
    if (!isId(thread.id) || !validBackupTime(thread.statusAt)) return [];
    const current = new Map(byThread.get(thread.id)?.messages.map((m) => [m.id, m]));
    const messages = thread.messages.filter((message) => {
      if (message.author !== 'human' || !validBackupMessage(message)) return false;
      const saved = current.get(message.id);
      if (!saved) return true;
      return (
        saved.author === 'human' &&
        saved.at === message.at &&
        !saved.deleted &&
        (message.deleted ||
          Date.parse(message.editedAt ?? message.at) > Date.parse(saved.editedAt ?? saved.at))
      );
    });
    return messages.length ? [{ ...thread, messages }] : [];
  });
  return { ...incoming, threads };
}

const noNames: CommentNames = { human: () => undefined, agent: () => undefined };

export function createCommentStore(
  file: string,
  names = noNames,
  now = () => new Date().toISOString(),
  newId = () => nanoid(10),
  admit?: CommentAdmission,
  deferNormalization = false,
  recoveryFile?: CommentRecovery,
): CommentStore {
  return createStore(
    file,
    documentRules,
    names,
    now,
    newId,
    admit,
    undefined,
    deferNormalization,
    undefined,
    recoveryFile,
  );
}

export function createStore<F extends CommentsFile<unknown>, H, G>(
  file: string,
  rules: StoreRules<F, H, G>,
  names = noNames,
  now = () => new Date().toISOString(),
  newId = () => nanoid(10),
  initialAdmission?: CommentAdmission,
  persist?: (next: F, admit?: CommentAdmission) => void,
  deferNormalization = false,
  read?: () => string | null,
  recoveryFile?: CommentRecovery,
): Store<F, H, G> {
  let current = rules.empty();
  let lastSeen: string | null = null;
  let warnings: string[] = [];
  let loaded = false;
  let normalizationPending = false;
  let rejected: F | undefined;

  const backupOnDisk = () => {
    if (!recoveryFile) return null;
    let fd: number;
    try {
      fd = fs.openSync(
        recoveryFile.file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      if (!fs.fstatSync(fd).isFile()) throw new Error('Unsafe comment recovery file');
      const text = fs.readFileSync(fd, 'utf8');
      return readCommentBackup(text, rules.saved);
    } finally {
      fs.closeSync(fd);
    }
  };

  const recovery = () => {
    const prior = backupOnDisk();
    if (!rejected) return prior;
    return prior
      ? readCommentBackup(JSON.stringify(mergeRestoredComments(prior, rejected)), rules.saved)
      : rejected;
  };

  const pendingRecovery = () => {
    const backup = recovery();
    return backup
      ? { backup, revision: createHash('sha256').update(JSON.stringify(backup)).digest('hex') }
      : null;
  };

  const preserveRejected = (admit?: CommentAdmission) => {
    if (!recoveryFile || !rejected) return;
    const backup = recovery();
    writeJsonFiles(recoveryFile.root, [{ file: recoveryFile.file, value: backup }], admit);
    rejected = undefined;
  };

  const write = (next: F, admit?: CommentAdmission, preserveRecovery = true) => {
    if (preserveRecovery) preserveRejected(admit);
    const text = `${JSON.stringify(next, null, 2)}\n`;
    if (persist) persist(next, admit);
    else {
      let previous = 0;
      try {
        previous = fs.statSync(file).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      admit?.(Buffer.byteLength(text) - previous);
      writeJsonAtomic(file, next);
    }
    current = next;
    lastSeen = text;
    normalizationPending = false;
  };

  const sync = (admit?: CommentAdmission) => {
    let text: string | null;
    if (read) text = read();
    else {
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        return false;
      }
    }
    if (text === null) return false;
    if (text === lastSeen) {
      if (!normalizationPending || !admit) return false;
      write(current, admit);
      return true;
    }
    let merged: { file: F; warnings: string[] };
    try {
      const incoming = parseComments(text);
      const base = loaded ? current : rules.saved(incoming);
      merged = rules.merge(base, incoming, 'agent', now(), newId, names.agent());
      if (recoveryFile && loaded && merged.warnings.length) {
        const deferred = rejectedHumanComments(rules.saved(incoming), merged.file);
        if (deferred.threads.length) {
          const validated = readCommentBackup(JSON.stringify(deferred), rules.saved);
          rejected = rejected
            ? { ...rejected, ...mergeRestoredComments(rejected, validated) }
            : validated;
        }
      }
    } catch (err) {
      lastSeen = text;
      normalizationPending = false;
      warnings = [
        `comments.json is not valid: ${(err as Error).message} (left as written; fix it)`,
      ];
      return true;
    }
    const needsWrite = `${JSON.stringify(merged.file, null, 2)}\n` !== text;
    if (needsWrite && (!deferNormalization || admit)) write(merged.file, admit);
    else {
      // Reads expose merged comments without using normalization to bypass quota.
      // Retain generated IDs so a later admitted save publishes the same threads.
      current = merged.file;
      lastSeen = text;
      normalizationPending = needsWrite;
    }
    warnings = merged.warnings;
    return true;
  };

  const mergeBackup = (backup: F, admit?: CommentAdmission) => {
    const merged = { ...current, ...mergeRestoredComments(current, backup) };
    if (JSON.stringify(merged) !== JSON.stringify(current)) write(merged, admit);
    return current;
  };

  sync(initialAdmission);
  loaded = true;
  return {
    current: () => current,
    warnings: () => warnings,
    sync,
    restore: (text, admit) => {
      const backup = readCommentBackup(text, rules.saved);
      sync(admit);
      return mergeBackup(backup, admit);
    },
    hasRecovery: () => Boolean(recoveryFile && (rejected || fs.existsSync(recoveryFile.file))),
    recovery: pendingRecovery,
    restoreRecovery: (revision, admit) => {
      if (!recoveryFile) return false;
      sync();
      const offered = pendingRecovery();
      if (!offered || offered.revision !== revision) return false;
      write({ ...current, ...mergeRestoredComments(current, offered.backup) }, admit, false);
      rejected = undefined;
      fs.rmSync(recoveryFile.file, { force: true });
      return true;
    },
    apply: (op, admit) => {
      sync(admit);
      const next = rules.human(current, op, now(), newId, names.human());
      write(next, admit);
      return current;
    },
    applyAgent: (op, name, admit, messageId) => {
      sync(admit);
      const result = rules.agent(
        current,
        op,
        now(),
        messageId ? () => messageId : newId,
        name ?? names.agent(),
      );
      write(result.file, admit);
      return result;
    },
  };
}
