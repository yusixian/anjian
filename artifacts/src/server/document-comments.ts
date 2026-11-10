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
  parseComments,
  type Person,
  savedComments,
} from '../shared/comments';
import type { CommentNames } from './comment-names';
import { writeJsonAtomic } from './state';

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
  applyAgent: (op: G, name?: string, admit?: CommentAdmission) => { file: F; threadId: string; messageId?: string };
  current: () => F;
  sync: () => boolean;
  warnings: () => string[];
}
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

const noNames: CommentNames = { human: () => undefined, agent: () => undefined };

export function createCommentStore(
  file: string,
  names = noNames,
  now = () => new Date().toISOString(),
  newId = () => nanoid(10),
  admit?: CommentAdmission,
): CommentStore {
  return createStore(file, documentRules, names, now, newId, admit);
}

export function createStore<F, H, G>(
  file: string,
  rules: StoreRules<F, H, G>,
  names = noNames,
  now = () => new Date().toISOString(),
  newId = () => nanoid(10),
  initialAdmission?: CommentAdmission,
  persist?: (next: F, admit?: CommentAdmission) => void,
): Store<F, H, G> {
  let current = rules.empty();
  let lastSeen: string | null = null;
  let warnings: string[] = [];
  let loaded = false;

  const write = (next: F, admit?: CommentAdmission) => {
    const text = `${JSON.stringify(next, null, 2)}\n`;
    if (persist) persist(next, admit);
    else {
      let previous = 0;
      try { previous = fs.statSync(file).size; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      admit?.(Buffer.byteLength(text) - previous);
      writeJsonAtomic(file, next);
    }
    current = next;
    lastSeen = text;
  };

  const sync = (admit?: CommentAdmission) => {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return false;
    }
    if (text === lastSeen) return false;
    let merged: { file: F; warnings: string[] };
    try {
      const incoming = parseComments(text);
      const base = loaded ? current : rules.saved(incoming);
      merged = rules.merge(base, incoming, 'agent', now(), newId, names.agent());
    } catch (err) {
      lastSeen = text;
      warnings = [
        `comments.json is not valid: ${(err as Error).message} (left as written; fix it)`,
      ];
      return true;
    }
    if (`${JSON.stringify(merged.file, null, 2)}\n` !== text) write(merged.file, admit);
    else { current = merged.file; lastSeen = text; }
    warnings = merged.warnings;
    return true;
  };

  sync(initialAdmission);
  loaded = true;
  return {
    current: () => current,
    warnings: () => warnings,
    sync,
    apply: (op, admit) => {
      sync(admit);
      const next = rules.human(current, op, now(), newId, names.human());
      write(next, admit);
      return current;
    },
    applyAgent: (op, name, admit) => {
      sync(admit);
      const result = rules.agent(current, op, now(), newId, name ?? names.agent());
      write(result.file, admit);
      return result;
    },
  };
}
