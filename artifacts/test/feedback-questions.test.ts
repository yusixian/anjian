import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import {
  questionItems,
  replayQuestionSubmission,
  saveQuestionDraft,
  submitQuestion,
  withdrawQuestion,
} from '../src/server/feedback/questions';
import { feedbackStore, hash } from '../src/server/feedback/store';
import { claim, connect, fence } from '../src/server/feedback/tasks';
import type { DocumentQuestion } from '../src/shared/document-questions';

const artifact = 'document/demo';
const open: DocumentQuestion = { id: 'intent', prompt: 'What should change?' };
const choice: DocumentQuestion = {
  id: 'direction',
  prompt: 'Which direction?',
  options: [
    { id: 'a', label: 'First' },
    { id: 'b', label: 'Second' },
  ],
  recommended: 'b',
};
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function fixture() {
  const project = 'a'.repeat(32);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-questions-'));
  homes.push(home);
  const store = feedbackStore(home, project);
  const data = store.load();
  const connection = connect(
    data,
    project,
    'device',
    {
      host: 'lody',
      session: 'session',
      displayName: 'Test',
      artifacts: [artifact],
      requestId: 'connect',
    },
    1,
  );
  return { store, data, connection };
}

test('drafts persist, clear without reviving stale versions, and flag changed definitions', () => {
  const { store, data } = fixture();
  store.save(data, () => {});
  expect(store.load()).not.toHaveProperty('questionDrafts');
  const initial = questionItems(data, artifact, [open])[0]!;
  expect(() =>
    saveQuestionDraft(data, artifact, [open], { ...initial, answer: 'a'.repeat(4001) }),
  ).toThrow('invalid_question_answer');
  const draft = saveQuestionDraft(data, artifact, [open], {
    ...initial,
    answer: '  Keep the intro.  ',
  });
  expect(draft.answer).toBe('Keep the intro.');
  expect(draft.version).not.toBe(initial.version);
  expect(data.tasks).toEqual([]);
  store.save(data, () => {});
  const reloaded = store.load();
  expect(questionItems(reloaded, artifact, [open])).toEqual([draft]);
  expect(questionItems(reloaded, 'document/another', [open])[0]).not.toHaveProperty('answer');
  const revised = { ...open, prompt: 'What should stay?' };
  const changed = questionItems(reloaded, artifact, [revised])[0]!;
  expect(changed.previousDefinition).toEqual(open);
  expect(() =>
    saveQuestionDraft(reloaded, artifact, [revised], { ...draft, answer: 'Old' }),
  ).toThrow('feedback_changed');
  const cleared = saveQuestionDraft(reloaded, artifact, [revised], { ...changed, answer: '  ' });
  expect(cleared).not.toHaveProperty('answer');
  expect(cleared).not.toHaveProperty('previousDefinition');
  expect(cleared.version).not.toBe(questionItems(data, artifact, [revised])[0]!.version);
  expect(() =>
    saveQuestionDraft(reloaded, artifact, [revised], { ...changed, answer: 'Stale draft' }),
  ).toThrow('feedback_changed');
});

test('validates the selected option and makes one immutable submission for a question', () => {
  const { store, data, connection } = fixture();
  const initial = questionItems(data, artifact, [choice])[0]!;
  expect(initial).not.toHaveProperty('answer');
  expect(() =>
    saveQuestionDraft(data, artifact, [choice], { ...initial, answer: 'Second' }),
  ).toThrow('invalid_question_answer');
  expect(() =>
    submitQuestion(
      data,
      connection,
      artifact,
      'empty',
      { ...initial, answer: '' },
      [choice],
      'revision',
      2,
    ),
  ).toThrow('invalid_question_answer');
  const input = { ...initial, answer: 'b' };
  const task = submitQuestion(data, connection, artifact, 'submit', input, [choice], 'revision', 3);
  expect(task).toMatchObject({
    questionId: choice.id,
    questionContext: { definition: choice, answer: 'b' },
    threads: [],
  });
  store.save(data, () => {});
  const reloaded = store.load();
  expect(replayQuestionSubmission(reloaded, connection, artifact, 'submit', input)?.id).toBe(
    task.id,
  );
  expect(
    submitQuestion(reloaded, connection, artifact, 'submit', input, [], 'later-revision', 4).id,
  ).toBe(task.id);
  expect(() =>
    replayQuestionSubmission(reloaded, connection, artifact, 'submit', { ...input, answer: 'a' }),
  ).toThrow('idempotency_conflict');
  expect(() =>
    submitQuestion(reloaded, connection, artifact, 'duplicate', input, [choice], 'revision', 4),
  ).toThrow('question_already_submitted');
  expect(() =>
    saveQuestionDraft(reloaded, artifact, [choice], { ...initial, answer: 'a' }),
  ).toThrow('question_already_submitted');
  const updated = { ...choice, prompt: 'Choose again?' };
  expect(questionItems(reloaded, artifact, [updated])[0]).toMatchObject({
    answer: 'b',
    previousDefinition: choice,
    task: { id: task.id, state: 'queued', withdrawable: true },
  });
});

test('withdrawal fences a claimed task and preserves the answer for resubmission', () => {
  const { store, data, connection } = fixture();
  const initial = questionItems(data, artifact, [open])[0]!;
  const task = submitQuestion(
    data,
    connection,
    artifact,
    'first',
    { ...initial, answer: 'Proceed.' },
    [open],
    'revision',
    2,
  );
  const claimInput = {
    connectionId: connection.id,
    generation: connection.generation,
    claimant: 'session',
    requestId: 'claim',
    token: 'a'.repeat(64),
  };
  const credential = claim(data, task, 'device', claimInput, 'revision', 3, false);
  withdrawQuestion(task, 4);
  withdrawQuestion(task, 5);
  expect(task).toMatchObject({ state: 'cancelled', attempt: credential.attempt + 1, updatedAt: 4 });
  expect(() =>
    fence(data, task, 'device', { ...credential, token: claimInput.token }, 5),
  ).toThrow();
  store.save(data, () => {});
  const reloaded = store.load();
  const draft = questionItems(reloaded, artifact, [open])[0]!;
  expect(draft.answer).toBe('Proceed.');
  expect(draft).not.toHaveProperty('task');
  const next = submitQuestion(
    reloaded,
    connection,
    artifact,
    'second',
    { ...draft, answer: 'Proceed now.' },
    [open],
    'revision',
    6,
  );
  expect(next.id).not.toBe(task.id);
  next.state = 'awaiting_review';
  next.questionResult = { id: 'reply', payloadHash: hash('Done.'), reply: 'Done.' };
  store.save(reloaded, () => {});
  expect(questionItems(store.load(), artifact, [open])[0]!.task).toEqual({
    id: next.id,
    state: 'awaiting_review',
    withdrawable: false,
    reply: 'Done.',
  });
  expect(() => withdrawQuestion(next, 7)).toThrow('invalid_task_transition');
});

test('a replacement document can reuse a question ID without inheriting the prior draft or task', () => {
  const { store, data, connection } = fixture();
  const firstAddress = 'A'.repeat(21);
  const secondAddress = 'B'.repeat(21);
  const initial = questionItems(data, artifact, [open], firstAddress)[0]!;
  const firstInput = { ...initial, answer: 'Old document answer.' };
  const first = submitQuestion(
    data,
    connection,
    artifact,
    'first',
    firstInput,
    [open],
    'rev-a',
    2,
    firstAddress,
  );
  store.save(data, () => {});

  const reloaded = store.load();
  const replacement = questionItems(reloaded, artifact, [open], secondAddress)[0]!;
  expect(replacement).not.toHaveProperty('answer');
  expect(replacement).not.toHaveProperty('task');
  expect(replacement.version).not.toBe(initial.version);
  expect(() =>
    replayQuestionSubmission(reloaded, connection, artifact, 'first', firstInput, secondAddress),
  ).toThrow('idempotency_conflict');
  const second = submitQuestion(
    reloaded,
    connection,
    artifact,
    'second',
    { ...replacement, answer: 'New answer.' },
    [open],
    'rev-b',
    3,
    secondAddress,
  );
  store.save(reloaded, () => {});
  const persisted = store.load();
  expect(questionItems(persisted, artifact, [open], firstAddress)[0]).toMatchObject({
    answer: 'Old document answer.',
    task: { id: first.id },
  });
  expect(questionItems(persisted, artifact, [open], secondAddress)[0]).toMatchObject({
    answer: 'New answer.',
    task: { id: second.id },
  });
});
