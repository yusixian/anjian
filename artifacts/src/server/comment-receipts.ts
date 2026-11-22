import fs from 'node:fs';
import path from 'node:path';

import {
  digest,
  readerKey,
  receiptChanges,
  threadEvents,
} from '../../../skills/artifacts/app/comment-receipt-events.cjs';
import {
  type CommentsFile,
  type Thread,
  type UnreadThread,
  unreadThreads,
} from '../shared/comments';
import type { CommentAdmission } from './document-comments';
import { writeJsonFiles } from './storage/json-files';

export type CommentReceipt = Record<string, string>;
type Receipts = Record<string, CommentReceipt>;
interface ReaderState {
  baseline: Receipts;
  read: Receipts;
}
type ReceiptBook = Record<string, ReaderState>;

export interface CommentReader {
  scope: string;
  session: string;
}

const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

function readBook(file: string): ReceiptBook {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ReceiptBook;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {};
}

function changes<A>(
  thread: Thread<A>,
  read: CommentReceipt | undefined,
): UnreadThread<A> | undefined {
  if (!read) return unreadThreads({ version: 1, threads: [thread] }, null).threads[0];
  const delta = receiptChanges(thread, read);
  return delta.changes.length ? { ...thread, ...delta } : undefined;
}

export function createCommentReceipts(stateDir: string, type: 'document' | 'artboard') {
  const fileFor = (artifact: string) =>
    path.join(stateDir, type, artifact, 'comment-receipts.json');
  const tokenFor = (
    artifact: string,
    reader: string,
    thread: string,
    key: string,
    version: string,
    baseline = false,
  ) => digest([stateDir, type, artifact, reader, thread, key, version, baseline]);
  return {
    forViewer<A>(artifact: string, file: CommentsFile<A>): CommentsFile<A> {
      let readers: Receipts[];
      try {
        readers = Object.values(readBook(fileFor(artifact))).flatMap((reader) =>
          reader?.read ? [reader.read] : [],
        );
      } catch {
        return file;
      }
      if (!readers.length) return file;
      const threads = file.threads.map((thread) => {
        const reads = readers
          .map((reader) => own(reader, thread.id))
          .filter((read) => read !== undefined);
        if (!reads.length) return thread;
        const ids = new Set(
          threadEvents(thread).flatMap((event) =>
            'id' in event &&
            !event.deleted &&
            reads.some((read) => own(read, event.key) === event.version)
              ? [event.id]
              : [],
          ),
        );
        return ids.size
          ? {
              ...thread,
              messages: thread.messages.map((message) =>
                ids.has(message.id) ? { ...message, agentRead: true as const } : message,
              ),
            }
          : thread;
      });
      return { ...file, threads };
    },
    snapshot<A>(artifact: string, reader: CommentReader, threads: Thread<A>[], all = false) {
      const key = readerKey(reader.scope, reader.session);
      const previous = own(readBook(fileFor(artifact)), key);
      const baseline: string[] = [];
      const entries = threads.flatMap((thread) => {
        const unread = changes(
          thread,
          previous
            ? {
                ...own(previous.baseline, thread.id),
                ...own(previous.read, thread.id),
              }
            : undefined,
        );
        const current = threadEvents(thread);
        if (!previous && !unread)
          baseline.push(
            ...current.map((event) =>
              tokenFor(artifact, key, thread.id, event.key, event.version, true),
            ),
          );
        if (!all && !unread) return [];
        return [
          {
            thread: unread ?? thread,
            unread: Boolean(unread),
            receipts: current.map((event) =>
              tokenFor(artifact, key, thread.id, event.key, event.version),
            ),
          },
        ];
      });
      return { entries, baseline: previous ? null : baseline };
    },
    confirm<A>(
      artifact: string,
      reader: CommentReader,
      threads: Thread<A>[],
      received: readonly string[],
      admit?: CommentAdmission,
      initialize = false,
    ) {
      const file = fileFor(artifact);
      const book = readBook(file);
      const key = readerKey(reader.scope, reader.session);
      const previous = own(book, key);
      const tokens = new Set(received);
      const reads = new Map(Object.entries(previous?.read ?? {}));
      const baseline = new Map(Object.entries(previous?.baseline ?? {}));
      let confirmed = 0;
      let modified = initialize && !previous;
      let readChanged = false;
      for (const thread of threads) {
        const read = { ...reads.get(thread.id) };
        const prior = { ...baseline.get(thread.id) };
        for (const event of threadEvents(thread)) {
          if (tokens.has(tokenFor(artifact, key, thread.id, event.key, event.version))) {
            confirmed++;
            if (own(read, event.key) === event.version) continue;
            read[event.key] = event.version;
            reads.set(thread.id, read);
            modified = readChanged = true;
          } else if (
            initialize &&
            !own(read, event.key) &&
            !own(prior, event.key) &&
            tokens.has(tokenFor(artifact, key, thread.id, event.key, event.version, true))
          ) {
            prior[event.key] = event.version;
            baseline.set(thread.id, prior);
            modified = true;
          }
        }
      }
      if (modified)
        writeJsonFiles(
          stateDir,
          [
            {
              file,
              value: {
                ...book,
                [key]: {
                  baseline: Object.fromEntries(baseline),
                  read: Object.fromEntries(reads),
                },
              },
            },
          ],
          admit,
        );
      return { confirmed, modified: readChanged };
    },
  };
}
