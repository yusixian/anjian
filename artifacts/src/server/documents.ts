import { cumulativeStorageAdmission } from './storage/quota';
import fs from 'node:fs';
import path from 'node:path';

import {
  type AgentOp,
  type CommentsFile,
  type HumanOp,
  type Thread,
  unreadThreads,
  waitingOn,
} from '../shared/comments';
import type { ServerMessage } from '../shared/types';
import { createCommentCursors } from './comment-cursors';
import type { CommentNames } from './comment-names';
import { boxDrawingDiagrams } from './document-codec';
import { type CommentAdmission, type CommentStore, createCommentStore } from './document-comments';
import {
  createDocumentSession,
  type DocumentOutcome,
  type DocumentSession,
} from './document-session';

export interface DocumentTiming {
  writeDelayMs?: number;
}

export interface DocumentRegistry {
  applyAgentCommentOp: (
    id: string,
    op: AgentOp,
    agent?: string,
    admit?: CommentAdmission,
  ) => { threadId: string; messageId?: string };
  applyCommentOp: (id: string, op: HumanOp, admit?: CommentAdmission) => CommentsFile;
  close: () => Promise<void>;
  quiesce: (prepare?: () => Promise<CommentAdmission>) => Promise<() => void>;
  comments: (id: string) => CommentsFile;
  commentWarnings: (id: string) => string[];
  commentsChanged: (id: string) => void;
  fileChanged: (id: string) => void;
  listComments: (id: string, agent: string, all: boolean, admit?: CommentAdmission) => AgentThread[];
  open: (id: string) => Promise<DocumentSession | null>;
  warnings: (id: string) => string[];
}

export type AgentThread = Thread & {
  waitingOn: ReturnType<typeof waitingOn>;
  changes?: string[];
  messageIds?: string[];
};

const forAgent = <T extends Thread>(thread: T) => ({
  ...thread,
  waitingOn: waitingOn(thread),
  messages: thread.messages.map(({ avatar: _avatar, ...message }) => message),
});

interface RegistryOptions {
  broadcast: (message: ServerMessage) => void;
  log?: (line: string) => void;
  names?: CommentNames;
  onWarningsChange: (id: string) => void;
  root: string;
  stateDir: string;
  timing?: DocumentTiming;
  enqueueWrite?: (id: string, work: (admit: CommentAdmission) => void) => void;
}

const diagramWarnings = (session: DocumentSession) =>
  boxDrawingDiagrams(session.state()).map(
    (id) =>
      `block ${id} draws a diagram with box-drawing characters; this document is rendered, not Markdown, so draw it as <mermaid>`,
  );

function outcomeWarnings(outcome: DocumentOutcome): string[] {
  if (outcome.kind === 'rejected')
    return [`agent edit rejected: ${outcome.message} (doc.xml is left as written; fix it)`];
  if (outcome.kind === 'failed') return [`agent edit failed: ${outcome.message}`];
  return [];
}

export function createDocumentRegistry(options: RegistryOptions): DocumentRegistry {
  let closing = false;
  let quiescing = false;
  let closePromise: Promise<void> | null = null;
  const sessions = new Map<string, Promise<DocumentSession | null>>();
  const incompleteSetups = new Map<string, DocumentSession>();
  const warnings = new Map<string, string[]>();
  const docFile = (id: string) => path.join(options.root, 'document', id, 'doc.xml');
  const commentStores = new Map<string, CommentStore>();
  const cursors = createCommentCursors(options.stateDir);
  const commentStore = (id: string, admit?: CommentAdmission) => {
    let store = commentStores.get(id);
    if (!store) {
      store = createCommentStore(
        path.join(options.root, 'document', id, 'comments.json'),
        options.names,
        undefined, undefined, admit,
      );
      commentStores.set(id, store);
    }
    return store;
  };
  const pushComments = (id: string) =>
    options.broadcast({
      type: 'doc-comments',
      artifact: `document/${id}`,
      comments: commentStore(id).current(),
    });
  const syncComments = (id: string, admit?: CommentAdmission) => {
    const store = commentStore(id, admit);
    const before = JSON.stringify(store.warnings());
    if (!store.sync(admit)) return;
    pushComments(id);
    if (JSON.stringify(store.warnings()) !== before) options.onWarningsChange(id);
  };

  const create = async (id: string) => {
    if (!fs.existsSync(docFile(id))) return null;
    const session = await createDocumentSession({
      file: docFile(id),
      snapshotFile: path.join(options.stateDir, 'document', id, 'doc.loro'),
      stateRoot: options.stateDir,
      ...options.timing,
      enqueueWrite: options.enqueueWrite ? work => options.enqueueWrite!(id, work) : undefined,
      log: options.log,
    });
    try {
      const artifact = `document/${id}`;
      const setWarnings = (next: string[]) => {
        if (JSON.stringify(next) === JSON.stringify(warnings.get(id) ?? [])) return;
        warnings.set(id, next);
        options.onWarningsChange(id);
      };
      const currentWarnings = () => {
        if (session.streaming()) return [];
        const outcome = session.outcome();
        return outcome.kind === 'rejected'
          ? outcomeWarnings(outcome)
          : [...outcomeWarnings(outcome), ...diagramWarnings(session)];
      };
      setWarnings(currentWarnings());
      session.subscribe((event) => {
        if (event.type === 'update') {
          options.broadcast({
            type: 'doc-update',
            artifact,
            bytes: Buffer.from(event.bytes).toString('base64'),
          });
        } else if (event.type === 'saved') {
          setWarnings(currentWarnings());
        } else {
          options.broadcast({
            type: 'doc-status',
            artifact,
            streaming: event.streaming,
            outcome: event.outcome,
            agentActiveAt: event.agentActiveAt,
            now: Date.now(),
          });
          setWarnings(currentWarnings());
        }
      });
      return session;
    } catch (error) {
      warnings.delete(id);
      try { await session.close(); }
      catch { incompleteSetups.set(id, session); }
      throw error;
    }
  };

  const open = (id: string) => {
    if (closing || incompleteSetups.has(id)) return Promise.resolve(null);
    let session = sessions.get(id);
    if (quiescing && !session) return Promise.resolve(null);
    if (!session) {
      session = create(id).catch((err) => {
        try { options.log?.(`document ${id} could not open: ${(err as Error).message}`); }
        catch { /* Diagnostic logging cannot orphan the session. */ }
        return null;
      });
      sessions.set(id, session);
      void session.then((s) => {
        if (!s && sessions.get(id) === session) sessions.delete(id);
      }, () => { /* Retain a rejected open so close reports incomplete drain. */ });
    }
    return session;
  };

  return {
    open,
    fileChanged: (id) => {
      if (quiescing) return;
      const known = sessions.has(id);
      void open(id).then((session) => {
        if (!session || !known) return;
        fs.readFile(docFile(id), 'utf8', (err, text) => {
          if (!err && !closing && !quiescing) session.onFileText(text);
        });
      });
    },
    comments: (id) => commentStore(id).current(),
    commentWarnings: (id) => commentStore(id).warnings(),
    commentsChanged: syncComments,
    applyCommentOp: (id, op, admit) => {
      const file = commentStore(id, admit).apply(op, admit);
      pushComments(id);
      return file;
    },
    applyAgentCommentOp: (id, op, agent, admit) => {
      const { threadId, messageId } = commentStore(id, admit).applyAgent(op, agent, admit);
      pushComments(id);
      return { threadId, ...(messageId ? { messageId } : {}) };
    },
    listComments: (id, agent, all, admit) => {
      syncComments(id, admit);
      const file = commentStore(id).current();
      if (all) return file.threads.filter((t) => !t.messages.every((m) => m.deleted)).map(forAgent);
      const { threads, newest } = unreadThreads(file, cursors.get(id, agent));
      if (newest) cursors.set(id, agent, newest, admit);
      return threads.map(forAgent);
    },
    warnings: (id) => [...(warnings.get(id) ?? []), ...commentStore(id).warnings()],
    quiesce: async prepare => {
      if (closing || quiescing) throw new Error('Documents are already closing or paused');
      quiescing = true;
      const resumes: Array<() => void> = [];
      const releaseAll = (): unknown[] => {
        const failures: unknown[] = [];
        try {
          for (const resume of resumes) {
            try { resume(); } catch (error) { failures.push(error); }
          }
        } finally { quiescing = false; }
        return failures;
      };
      try {
        const opened = await Promise.allSettled([...sessions.values()]);
        const failures: unknown[] = opened.filter((result) => result.status === 'rejected').map((result) => result.reason);
        const active = opened.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
        active.push(...incompleteSetups.values());
        if (prepare) {
          // Each preceding flush changes usage; scan again before the next session.
          for (const session of active) {
            try { resumes.push(await session.quiesce(cumulativeStorageAdmission(await prepare()))); }
            catch (error) { failures.push(error); break; }
          }
        } else {
          const drained = await Promise.allSettled(active.map((session) => session.quiesce()));
          for (const result of drained) {
            if (result.status === 'fulfilled') resumes.push(result.value);
            else failures.push(result.reason);
          }
        }
        if (failures.length) throw new AggregateError(failures, 'Documents did not quiesce completely');
        let resumed = false;
        return () => {
          if (resumed) return;
          resumed = true;
          const failures = releaseAll();
          if (failures.length) throw new AggregateError(failures, 'Documents did not resume completely');
        };
      } catch (error) {
        const failures = releaseAll();
        if (failures.length) throw new AggregateError([error, ...failures], 'Documents did not quiesce or resume completely');
        throw error;
      }
    },
    close: () => {
      closing = true;
      if (closePromise) return closePromise;
      closePromise = (async () => {
        const pending = [...sessions.entries()];
        const opened = await Promise.allSettled(pending.map(([, session]) => session));
        const failures: unknown[] = [];
        const entries = opened.flatMap((result, index) => {
          if (result.status === 'rejected') { failures.push(result.reason); return []; }
          const [id, session] = pending[index]!;
          return [{ id, pending: session, session: result.value }];
        });
        const results = await Promise.allSettled(entries.map(({ session }) => session?.close()));
        for (const [index, result] of results.entries()) {
          const { id, pending } = entries[index]!;
          if (result.status === 'rejected') failures.push(result.reason);
          else if (sessions.get(id) === pending) sessions.delete(id);
        }
        const cleanup = [...incompleteSetups.entries()];
        const cleanupResults = await Promise.allSettled(cleanup.map(([, session]) => session.close()));
        for (const [index, result] of cleanupResults.entries()) {
          const [id, session] = cleanup[index]!;
          if (result.status === 'rejected') failures.push(result.reason);
          else if (incompleteSetups.get(id) === session) incompleteSetups.delete(id);
        }
        if (failures.length) throw new AggregateError(failures, 'Documents did not close completely');
      })().finally(() => { closePromise = null; });
      return closePromise;
    },
  };
}
