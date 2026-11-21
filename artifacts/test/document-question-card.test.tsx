// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { DocumentQuestion } from '../src/shared/document-questions';
import type { FeedbackQuestionInput } from '../src/shared/feedback';
import { DocumentQuestionCard } from '../src/viewer/document/DocumentQuestionCard';
import { DocumentQuestions } from '../src/viewer/document/DocumentQuestions';
import { FeedbackProvider } from '../src/viewer/feedback/FeedbackProvider';
import { feedbackApi } from '../src/viewer/feedback/localApi';

vi.mock('@stylexjs/stylex', () => ({ create: (value: unknown) => value, props: () => ({}) }));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({ cssVar: {} }));
vi.mock('../src/viewer/tokens.stylex', () => ({ brand: {}, color: {} }));

const first: DocumentQuestion = {
  id: 'direction',
  prompt: 'Original direction?',
  options: [
    { id: 'one', label: 'Original choice' },
    { id: 'two', label: 'Another choice' },
  ],
};
const updated: DocumentQuestion = {
  ...first,
  prompt: 'New direction?',
  options: [{ id: 'one', label: 'Replacement choice' }, first.options![1]!],
};

const approvalQuestion: DocumentQuestion = {
  ...updated,
  approve: 'one',
  recommended: 'one',
};

let root: Root;
let visibleVersion: string;
const getViewVersion = () => visibleVersion;
const getAssetsRevision = () => 'loaded-assets';
let snapshot: FeedbackQuestionInput;
const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
  Promise.resolve(
    Response.json({
      items: [snapshot],
      connections: [{ id: 'agent', displayName: 'Agent', enabled: true, authorized: true }],
    }),
  ),
);
const render = (definition: DocumentQuestion, artifact: string | null = 'document/test') =>
  act(async () => {
    root.render(
      <FeedbackProvider createApi={feedbackApi}>
        <DocumentQuestions
          artifact={artifact}
          getAssetsRevision={getAssetsRevision}
          getViewVersion={getViewVersion}
        >
          <DocumentQuestionCard definition={definition} />
        </DocumentQuestions>
      </FeedbackProvider>,
    );
  });
const firstRadio = () => document.querySelector<HTMLInputElement>('input[type=radio]')!;
const submit = () => document.querySelectorAll<HTMLButtonElement>('section button')[1]!;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  visibleVersion = 'first-view';
  root = createRoot(document.body.appendChild(document.createElement('div')));
  snapshot = { id: updated.id, definition: updated, version: 'new', answer: 'one' };
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

test('a newer feedback snapshot cannot submit an answer against the older visible question', async () => {
  await render(first);
  expect(document.body.textContent).toContain(first.prompt);
  expect(firstRadio().disabled).toBe(true);
  expect(submit().disabled).toBe(true);
  await act(async () => submit().click());
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await render(updated);
  expect(firstRadio().disabled).toBe(false);
  expect(submit().disabled).toBe(false);
});

test('an earlier answer is labelled from its own question and does not select a reused option', async () => {
  snapshot.previousDefinition = first;
  await render(updated);
  expect(document.body.textContent).toContain('Original choice');
  expect(firstRadio().checked).toBe(false);
  expect(submit().disabled).toBe(true);
});

function approvalSnapshot(): FeedbackQuestionInput {
  return {
    id: approvalQuestion.id,
    definition: approvalQuestion,
    version: 'approval-version',
    approval: {
      state: 'pending',
      currentAssetsRevision: 'loaded-assets',
      currentRevision: 'document-revision',
    },
  };
}

test.each(['one', 'two'])('records the explicitly chosen approval option %s', async (choice) => {
  snapshot = approvalSnapshot();
  fetchMock.mockResolvedValueOnce(Response.json({ items: [snapshot], connections: [] }));
  fetchMock.mockResolvedValueOnce(
    Response.json({
      item: {
        ...snapshot,
        approval: {
          ...snapshot.approval,
          state: choice === approvalQuestion.approve ? 'approved' : 'changes_requested',
          decision: {
            at: 1700000000000,
            by: choice === 'one' ? { id: 'owner' } : { id: 'user-1', login: 'Reviewer' },
            choice,
            documentId: 'doc',
            question: approvalQuestion,
            revision: 'document-revision',
          },
        },
      },
    }),
  );
  await render(approvalQuestion);
  const button = document.querySelector<HTMLButtonElement>('section button')!;
  const radio = document.querySelector<HTMLInputElement>(`input[value="${choice}"]`)!;
  expect(document.querySelectorAll('section button')).toHaveLength(1);
  expect(firstRadio().checked).toBe(false);
  expect(button.disabled).toBe(true);
  await act(async () => radio.click());
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
    method: 'POST',
    body: JSON.stringify({
      id: approvalQuestion.id,
      action: 'decide',
      answer: choice,
      assetsRevision: 'loaded-assets',
      revision: 'document-revision',
      version: 'approval-version',
      viewVersion: 'first-view',
    }),
  });
  expect(radio.checked).toBe(false);
  expect(document.body.textContent).toContain(choice === 'one' ? 'Owner' : 'Reviewer');
});

test('an edit after a choice requires picking again without posting the stale approval', async () => {
  snapshot = approvalSnapshot();
  await render(approvalQuestion);
  const button = document.querySelector<HTMLButtonElement>('section button')!;
  await act(async () => firstRadio().click());
  visibleVersion = 'later-view';
  await act(async () => button.click());
  expect(fetchMock.mock.calls.map(([, options]) => options?.method)).toEqual([undefined, undefined]);
  expect(firstRadio().checked).toBe(false);
  expect(button.disabled).toBe(true);
});

test('an approval without feedback access displays no controls', async () => {
  snapshot = approvalSnapshot();
  await render(approvalQuestion, null);
  expect(document.body.textContent).toContain(approvalQuestion.prompt);
  expect(document.querySelector('section button, section input')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('an attachment change blocks approval until the reader reopens the document', async () => {
  snapshot = approvalSnapshot();
  await render(approvalQuestion);
  const button = document.querySelector<HTMLButtonElement>('section button')!;
  await act(async () => firstRadio().click());
  snapshot.approval!.currentAssetsRevision = 'changed-attachment';
  snapshot.approval!.currentRevision = 'changed-attachment-revision';
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(async () => button.click());
  expect(fetchMock.mock.calls.map(([, options]) => options?.method)).toEqual([undefined, undefined]);
  expect(firstRadio().checked).toBe(false);
  expect(firstRadio().disabled).toBe(true);
  expect(button.disabled).toBe(true);
  expect(document.body.textContent).toContain('Attachments changed. Reopen the document');
  expect([...document.querySelectorAll('section button')].map((entry) => entry.textContent))
    .toContain('Reopen document');
});

test('a text-only edit with the original assets can be reviewed after picking again', async () => {
  snapshot = approvalSnapshot();
  await render(approvalQuestion);
  const button = document.querySelector<HTMLButtonElement>('section button')!;
  await act(async () => firstRadio().click());
  visibleVersion = 'updated-visible-view';
  snapshot.approval!.currentRevision = 'text-edit-revision';
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(async () => button.click());
  expect(firstRadio().checked).toBe(false);
  await act(async () => firstRadio().click());
  expect(button.disabled).toBe(false);
});
