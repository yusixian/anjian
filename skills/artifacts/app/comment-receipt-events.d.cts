import type { ChangeKind, Thread } from '../../../artifacts/src/shared/comments';

export type ReceiptEvent =
  | {
      key: string;
      version: string;
      kind: 'new-thread' | 'new-message';
      id: string;
      deleted: boolean;
    }
  | { key: 'status'; version: string; kind: 'resolved' | 'reopened' };

export function digest(value: unknown): string;
export function threadEvents(thread: Thread<unknown>): ReceiptEvent[];
export function readerKey(scope: string, session: string): string;
export function receiptChanges(
  thread: Thread<unknown>,
  read: Record<string, string>,
): {
  changes: ChangeKind[];
  messageIds: string[];
};
