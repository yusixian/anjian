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

let root: Root;
let snapshot: FeedbackQuestionInput;
const fetchMock = vi.fn(() =>
  Promise.resolve(
    Response.json({
      items: [snapshot],
      connections: [{ id: 'agent', displayName: 'Agent', enabled: true, authorized: true }],
    }),
  ),
);
const render = (definition: DocumentQuestion) =>
  act(async () => {
    root.render(
      <FeedbackProvider createApi={feedbackApi}>
        <DocumentQuestions artifact="document/test">
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
