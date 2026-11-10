import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { createSelectionStore } from '../src/server/selection';
import { RemoteTransferError } from '../src/server/remote-transfer';
import type { CommentAdmission } from '../src/server/document-comments';
import { tempRoot } from './helpers';

const selection = (quote: string) => ({ type: 'selection', artifact: 'document/doc', tab: 'tab', human: true, quote, blockIds: ['b'], heading: 'Heading' });

test('quota rejection clears obsolete selection and retry uses the latest tab state', () => {
  const { root } = tempRoot(); const pending = new Map<string, (admit: CommentAdmission) => void>();
  const store = createSelectionStore(root, () => true, (key, work) => pending.set(key, work));
  const file = path.join(root, 'document/doc/selection.json'); const socket = {};
  const flush = (admit: CommentAdmission = () => undefined) => pending.get('selection/document/doc')!(admit);
  store.accept(socket, selection('old')); flush();
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).quote).toBe('old');
  store.accept(socket, selection('larger new selection'));
  expect(() => flush(() => { throw new RemoteTransferError(413, 'storage_quota_exceeded', 'quota'); })).toThrow('quota');
  expect(fs.existsSync(file)).toBe(false);
  store.accept(socket, selection('latest selection')); flush();
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).quote).toBe('latest selection');
});

test('queued retries do not resurrect a disconnected or cleared selection', () => {
  const { root } = tempRoot(); let pending!: (admit: CommentAdmission) => void;
  const store = createSelectionStore(root, () => true, (_key, work) => { pending = work; });
  const file = path.join(root, 'document/doc/selection.json'); const socket = {};
  store.accept(socket, selection('pending')); store.drop(socket); pending(() => undefined);
  expect(fs.existsSync(file)).toBe(false);
  store.accept(socket, selection('pending again')); store.clearAll(); pending(() => undefined);
  expect(fs.existsSync(file)).toBe(false);
});
