import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { approvalFor, recordDesignDecision } from '../src/server/feedback/approvals';
import { type FeedbackData, feedbackStore } from '../src/server/feedback/store';
import type { DesignDecision } from '../src/shared/feedback';

const firstRevision = `sha256:${'a'.repeat(64)}`;
const secondRevision = `sha256:${'b'.repeat(64)}`;
const approved: DesignDecision = {
  documentId: 'a'.repeat(21),
  revision: firstRevision,
  question: {
    approve: 'yes',
    id: 'review',
    options: [
      { id: 'yes', label: 'Approve' },
      { id: 'revise', label: 'Request changes' },
    ],
    prompt: 'Approve this design?',
  },
  choice: 'yes',
  by: { id: 'reviewer' },
  at: 1,
};

test('approval follows the current document revision and question definition', () => {
  const data: FeedbackData = { version: 1, connections: [], tasks: [] };
  const { documentId, question } = approved;
  expect(approvalFor(data, documentId, question, firstRevision)).toEqual({
    currentRevision: firstRevision,
    state: 'pending',
  });

  expect(recordDesignDecision(data, approved)).toBe(true);
  expect(recordDesignDecision(data, { ...approved, at: 2 })).toBe(false);
  expect(approvalFor(data, documentId, question, firstRevision)).toEqual({
    currentRevision: firstRevision,
    decision: approved,
    state: 'approved',
  });
  expect(approvalFor(data, documentId, question, secondRevision)).toEqual({
    currentRevision: secondRevision,
    decision: approved,
    state: 'needs_review',
  });
  expect(
    approvalFor(data, documentId, { ...question, approve: 'revise' }, firstRevision).state,
  ).toBe('needs_review');
  expect(approvalFor(data, 'b'.repeat(21), question, firstRevision).state).toBe('pending');

  const changes = { ...approved, revision: secondRevision, choice: 'revise', at: 3 };
  expect(recordDesignDecision(data, changes)).toBe(true);
  expect(data.decisions).toEqual([approved, changes]);
  expect(approvalFor(data, documentId, question, secondRevision)).toEqual({
    currentRevision: secondRevision,
    decision: changes,
    state: 'changes_requested',
  });
});

test('the feedback store loads old data and persists approval history', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-approval-store-'));
  try {
    const store = feedbackStore(home, 'a'.repeat(32));
    const admit = () => {};
    const data = store.load();
    store.save(data, admit);
    expect(store.load().decisions).toBeUndefined();

    recordDesignDecision(data, approved);
    recordDesignDecision(data, { ...approved, revision: secondRevision, at: 2 });
    store.save(data, admit);
    expect(store.load()).toEqual(data);
    expect(() =>
      store.save({ ...data, decisions: [{ ...approved, choice: 'missing' }] }, admit),
    ).toThrow('feedback_store_corrupt');
    expect(store.load()).toEqual(data);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
